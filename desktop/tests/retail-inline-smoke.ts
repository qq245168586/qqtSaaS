import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { cellPatch, retailCellSchema } from '../../server/src/retail-cell';

const profile = await mkdtemp(path.join(tmpdir(), 'qqt-retail-inline-'));
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
  product_summary: '抹茶蛋糕',
  delivery_address: '测试地址',
  note: '',
  delivery_fee: '0.00',
  status: 'delivered',
  priority: 'normal',
  task_type: 'order',
  department_id: '1',
  expected_delivery_at: '2026-11-19 15:00',
}));
const employees = [
  { id: '11', name: '测试接单甲', department_id: '1' },
  { id: '12', name: '测试接单乙', department_id: '1' },
  { id: '21', name: '测试负责人', department_id: '1' },
];
let writes = 0,
  failNext = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let data: unknown = { items: [], total: 0, page: 1, page_size: 100 };
  let code = 0,
    message = 'ok';
  try {
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
      data = { items: employees, total: employees.length, page: 1, page_size: 100 };
    if (url.pathname === '/api/departments')
      data = { items: [{ id: '1', name: '测试部门' }], total: 1, page: 1, page_size: 100 };
    if (url.pathname === '/api/todos/reminders')
      data = { overdue_count: 0, server_now: '2026-11-27 09:00:00' };
    if (url.pathname === '/api/tasks')
      data = {
        items: tasks,
        total: tasks.length,
        total_amount: tasks.reduce((sum, t) => sum + Number(t.order_amount), 0),
        page: 1,
        page_size: 20,
      };
    if (url.pathname === '/api/tasks/1') data = tasks[0];
    if (req.method === 'PATCH' && url.pathname === '/api/tasks/1/cell') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      if (failNext) {
        failNext = false;
        throw new Error('模拟网络中断，请重试');
      }
      const input = retailCellSchema.parse(JSON.parse(Buffer.concat(chunks).toString()));
      const patch = cellPatch(input, tasks[0]);
      if ('detail' in patch) {
        patch.content = patch.detail;
        delete patch.detail;
      }
      if ('remark' in patch) {
        patch.note = patch.remark;
        delete patch.remark;
      }
      Object.assign(tasks[0], patch);
      writes++;
      data = tasks[0];
    }
  } catch (error) {
    res.statusCode = 503;
    code = 503;
    message = error instanceof Error ? error.message : 'failure';
    data = null;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ code, message, data }));
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
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.getByRole('menuitem', { name: '零售', exact: true }).click();
  await p.getByRole('button', { name: '抹茶巴斯克订单名称', exact: true }).click();
  assert.equal(await p.getByRole('dialog').count(), 0);
  await p.getByRole('textbox', { name: '抹茶巴斯克订单名称', exact: true }).fill('抹茶巴斯克已改');
  await p.getByRole('textbox', { name: '抹茶巴斯克订单名称', exact: true }).press('Enter');
  await p.getByRole('button', { name: '抹茶巴斯克已改订单名称', exact: true }).waitFor();
  assert.equal(writes, 1);
  await p.getByRole('button', { name: '抹茶巴斯克已改订单金额', exact: true }).click();
  const money = p.getByRole('textbox', { name: '抹茶巴斯克已改订单金额', exact: true });
  await money.fill('125.50');
  await money.press('Tab');
  await p.waitForFunction(() =>
    document.querySelector('[aria-label="任务汇总统计"]')?.textContent?.includes('325.50'),
  );
  assert.equal(writes, 2);
  assert.equal(
    await p
      .locator('.retail-plain-select')
      .first()
      .evaluate((e) => e === document.activeElement),
    true,
    'Tab moves to next editable cell',
  );
  await p.getByRole('button', { name: '撤销修改', exact: true }).click();
  await p.waitForFunction(() =>
    document.querySelector('[aria-label="任务汇总统计"]')?.textContent?.includes('300.00'),
  );
  assert.equal(writes, 3);
  assert.equal(tasks[0].title, '抹茶巴斯克已改');
  await p.getByRole('button', { name: '抹茶巴斯克已改订单名称', exact: true }).click();
  const title = p.getByRole('textbox', { name: '抹茶巴斯克已改订单名称', exact: true });
  await title.fill('不保存');
  await title.press('Escape');
  assert.equal(writes, 3);
  failNext = true;
  await p.getByRole('button', { name: '抹茶巴斯克已改订单名称', exact: true }).click();
  await title.fill('失败仍保留');
  await title.press('Enter');
  await p.getByRole('alert').filter({ hasText: '模拟网络中断' }).waitFor();
  assert.equal(await title.inputValue(), '失败仍保留');
  assert.equal(writes, 3);
  await p.getByRole('button', { name: '重试', exact: true }).click();
  await p.getByRole('button', { name: '失败仍保留订单名称', exact: true }).waitFor();
  assert.equal(writes, 4);
  await p.getByRole('button', { name: '展开运费', exact: true }).first().click();
  await p.getByRole('button', { name: '失败仍保留运费', exact: true }).click();
  const fee = p.getByRole('textbox', { name: '失败仍保留运费', exact: true });
  await fee.fill('5');
  await fee.press('Enter');
  await p.getByRole('button', { name: '失败仍保留运费', exact: true }).waitFor();
  assert.equal(tasks[0].delivery_fee, '5.00');
  assert.equal(tasks[0].order_amount, '100.00');
  await p.getByRole('button', { name: '失败仍保留运费', exact: true }).click();
  await fee.fill('');
  await fee.press('Enter');
  await p.getByRole('button', { name: '失败仍保留运费', exact: true }).waitFor();
  assert.equal(tasks[0].delivery_fee, '0.00');
  await p.getByRole('button', { name: '展开失败仍保留订单详情', exact: true }).click();
  await p.getByRole('button', { name: '失败仍保留配送地址', exact: true }).click();
  const addr = p.getByRole('textbox', { name: '失败仍保留配送地址', exact: true });
  await addr.fill('新测试地址');
  await addr.press('Enter');
  await p.getByRole('button', { name: '失败仍保留配送地址', exact: true }).waitFor();
  assert.equal(tasks[0].delivery_address, '新测试地址');
  const grips = p.getByRole('separator', { name: '调整列宽' });
  await grips.nth(3).focus();
  await grips.nth(3).press('ArrowRight');
  await p.getByRole('button', { name: '缩小表格', exact: true }).click();
  assert.equal(await p.getByLabel('表格缩放比例').innerText(), '90%');
  assert.equal(
    await p.evaluate(
      () => JSON.parse(localStorage.getItem('retail-sheet-layout') ?? '{}').widths[3],
    ),
    356,
  );
  const aligned = await p.locator('.task-summary-table').evaluate((root) => {
    const heads = [...root.querySelectorAll('thead th')];
    const cells = [...root.querySelector('tbody tr.task-row')!.querySelectorAll('td')];
    return heads.every(
      (head, i) =>
        Math.abs(head.getBoundingClientRect().x - cells[i].getBoundingClientRect().x) < 2,
    );
  });
  assert(aligned, 'Resizing and zoom preserve header/body alignment');
  await p.getByRole('button', { name: '全屏编辑', exact: true }).click();
  await p.locator('.retail-sheet.is-fullscreen').waitFor();
  await p.getByRole('button', { name: '退出全屏', exact: true }).click();
  await p.getByRole('button', { name: '手动新建', exact: true }).click();
  await p.locator('.retail-order-form').waitFor();
  assert.equal(await p.getByRole('dialog').count(), 0);
  await p
    .locator('.retail-order-form')
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await p.screenshot({ path: '/tmp/qqt-retail-inline.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: inline edits, Tab/Enter/Esc, undo, failed input retained and retry, freight, detail, resize, zoom, fullscreen and inline form; isolated data only',
  );
} catch (error) {
  const p = await app.firstWindow();
  console.error('Alerts:', await p.getByRole('alert').allTextContents());
  await p.screenshot({ path: '/tmp/qqt-retail-inline-failure.png' });
  throw error;
} finally {
  await app.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
