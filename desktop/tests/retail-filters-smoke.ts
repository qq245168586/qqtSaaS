import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { retailFilterPredicate } from '../../server/src/retail-filters';
import { z } from 'zod';

const profile = await mkdtemp(path.join(tmpdir(), 'qqt-retail-filters-'));
const tasks = [
  {
    id: '1',
    title: '抹茶巴斯克',
    order_taker_employee_id: '11',
    assignee_employee_id: '21',
    entry_progress: 'not_entered',
    order_amount: '100.00',
  },
  {
    id: '2',
    title: '薄荷蛋糕',
    order_taker_employee_id: '12',
    assignee_employee_id: '21',
    entry_progress: 'entered',
    order_amount: '200.00',
  },
].map((task) => ({
  ...task,
  content: '隔离测试',
  status: 'delivered',
  priority: 'normal',
  task_type: 'order',
  department_id: '1',
  expected_delivery_at: '2026-11-19 15:00',
}));
const employees = [
  { id: '11', name: '测试接单甲' },
  { id: '12', name: '测试接单乙' },
  { id: '21', name: '测试负责人' },
];
const memory = new DatabaseSync(':memory:');
memory.exec(
  'CREATE TABLE tasks(id TEXT, order_taker_employee_id TEXT, assignee_employee_id TEXT, entry_progress TEXT, order_amount NUMERIC)',
);
for (const task of tasks)
  memory
    .prepare('INSERT INTO tasks VALUES(?,?,?,?,?)')
    .run(
      task.id,
      task.order_taker_employee_id,
      task.assignee_employee_id,
      task.entry_progress,
      task.order_amount,
    );
let writes = 0;
const listQueries: string[] = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let data: unknown = { items: [], total: 0, page: 1, page_size: 100 };
  if (url.pathname === '/api/auth/access-mode') data = { public_access: true };
  if (url.pathname === '/api/auth/enter')
    data = {
      access_token: 'isolated',
      user: {
        id: '1',
        company_id: '1',
        company_code: 'tmy',
        username: 'test',
        real_name: '测试',
        role: 'boss',
        must_change_password: false,
        public_access: true,
      },
    };
  if (url.pathname === '/api/employees')
    data = { items: employees, total: 3, page: 1, page_size: 100 };
  if (url.pathname === '/api/todos/reminders')
    data = { overdue_count: 0, server_now: '2026-11-19 09:00:00' };
  if (url.pathname === '/api/tasks') {
    listQueries.push(url.search);
    const filter = retailFilterPredicate(url.searchParams.get('column_filters') ?? '');
    const ids = memory
      .prepare(`SELECT id FROM tasks t WHERE ${filter.sql}`)
      .all(...(filter.params as SQLInputValue[]))
      .map((r) => r.id);
    const selected = tasks.filter((task) => ids.includes(task.id));
    data = {
      items: selected,
      total: selected.length,
      total_amount: selected.reduce((sum, task) => sum + Number(task.order_amount), 0),
      page: 1,
      page_size: 20,
    };
  }
  if (req.method === 'PATCH' && url.pathname === '/api/tasks/1/entry-progress') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const value = z
      .object({ entry_progress: z.enum(['not_entered', 'entered']) })
      .parse(JSON.parse(Buffer.concat(chunks).toString()));
    tasks[0].entry_progress = value.entry_progress;
    memory.prepare('UPDATE tasks SET entry_progress=? WHERE id=?').run(value.entry_progress, '1');
    writes++;
    data = tasks[0];
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ code: 0, message: 'ok', data }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
await writeFile(
  path.join(profile, 'connection.json'),
  JSON.stringify(`http://127.0.0.1:${address.port}`),
);
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, TMY_PHASE2_TEST_DIR: profile },
});
try {
  const p = await app.firstWindow();
  p.setDefaultTimeout(15000);
  await p.getByRole('menuitem', { name: '零售', exact: true }).click();
  await p.getByRole('button', { name: '展开抹茶巴斯克订单详情' }).waitFor();
  const row = p
    .locator('.task-summary-table tbody tr')
    .filter({ has: p.getByRole('button', { name: '展开抹茶巴斯克订单详情' }) });
  assert.equal(
    await row
      .locator('.task-status-select i')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(207, 52, 52)',
  );
  await row.locator('.task-progress-select .ant-select-selector').click();
  await p.locator('.ant-select-dropdown:visible').getByTitle('已录入', { exact: true }).click();
  await p.waitForFunction(
    () =>
      document.querySelector('.task-entry-entered') &&
      document.querySelectorAll('.task-entry-entered').length === 2,
  );
  assert.equal(writes, 1);
  assert.equal(
    await row
      .locator('.task-status-select i')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(36, 93, 65)',
  );
  await p.getByRole('button', { name: '接单人过滤', exact: true }).click();
  const panel = p.getByLabel('接单人过滤条件');
  await panel.locator('.ant-select').nth(1).click();
  await p.locator('.ant-select-dropdown:visible').getByTitle('测试接单甲', { exact: true }).click();
  await panel.getByRole('button', { name: '应用过滤' }).click();
  await p.getByRole('button', { name: '展开薄荷蛋糕订单详情' }).waitFor({ state: 'hidden' });
  assert.match(await p.getByLabel('任务汇总统计').innerText(), /100\.00/);
  await p.getByRole('button', { name: '金额过滤', exact: true }).click();
  const amountPanel = p.getByLabel('金额过滤条件');
  await amountPanel.getByRole('spinbutton', { name: '金额下限' }).fill('50');
  await amountPanel.getByRole('spinbutton', { name: '金额上限' }).fill('150');
  await amountPanel.getByRole('button', { name: '与 · 添加条件' }).click();
  await amountPanel
    .locator('.retail-filter-rule-inputs')
    .nth(1)
    .locator('.ant-select-selector')
    .click();
  await p.locator('.ant-select-dropdown:visible').getByTitle('排除', { exact: true }).click();
  await amountPanel.getByRole('spinbutton', { name: '金额下限' }).nth(1).fill('100');
  await amountPanel.getByRole('spinbutton', { name: '金额上限' }).nth(1).fill('100');
  await amountPanel.getByRole('button', { name: '应用过滤' }).click();
  await p.getByRole('button', { name: '展开抹茶巴斯克订单详情' }).waitFor({ state: 'hidden' });
  await p.getByRole('button', { name: '重置筛选', exact: true }).click();
  await p.getByRole('button', { name: '展开抹茶巴斯克订单详情' }).waitFor();
  await p.getByRole('button', { name: '金蝶录入过滤', exact: true }).click();
  const entryPanel = p.getByLabel('金蝶录入过滤条件');
  await entryPanel.locator('.ant-select').nth(1).click();
  await p.locator('.ant-select-dropdown:visible').getByTitle('未录入', { exact: true }).click();
  await entryPanel.getByRole('button', { name: '应用过滤' }).click();
  await p.getByRole('button', { name: '展开抹茶巴斯克订单详情' }).waitFor({ state: 'hidden' });
  await p.getByRole('button', { name: '重置筛选', exact: true }).click();
  await p.getByRole('button', { name: '展开抹茶巴斯克订单详情' }).waitFor();
  await p.getByRole('button', { name: '负责人过滤', exact: true }).click();
  await p.getByLabel('负责人过滤条件').getByRole('button', { name: '清除此列' }).click();
  await p.getByRole('heading', { name: '任务汇总', exact: true }).click();
  await p.screenshot({ path: '/tmp/qqt-retail-filters.png' });
  assert.equal(writes, 1, '过滤不能修改订单');
  console.log(
    'PASS: column filters, AND/exclude range, totals, reset, entry status red/green; isolated data only',
  );
} catch (error) {
  const p = await app.firstWindow();
  console.error('Isolated filter requests:', listQueries);
  console.error('UI alerts:', await p.getByRole('alert').allTextContents());
  await p.screenshot({ path: '/tmp/qqt-retail-filter-failure.png' });
  throw error;
} finally {
  await app.close();
  server.close();
  memory.close();
  await rm(profile, { recursive: true, force: true });
}
