import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const profile = await mkdtemp(path.join(tmpdir(), 'phase2-scheduling-'));
const writes: { path: string; body: Record<string, unknown> }[] = [];
const errors: string[] = [];
let row: Record<string, unknown> | null = null;
const employee = {
  id: '1',
  name: '测试员工',
  department_id: '1',
  department_name: '蛋糕部',
  status: 'active',
  left_on: null,
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let data: unknown = { items: [], total: 0, page: 1, page_size: 200 };
  const route = url.pathname;
  if (req.method === 'PUT' || req.method === 'DELETE' || route.endsWith('/departure')) {
    let text = '';
    for await (const chunk of req) text += String(chunk);
    const body: unknown = JSON.parse(text);
    assert(body && typeof body === 'object');
    const v = body as Record<string, unknown>;
    writes.push({ path: route, body: v });
    if (req.method === 'PUT') {
      row = {
        ...v,
        id: '1',
        employee_id: '1',
        work_date: route.split('/').at(-1),
        version: Number(v.version) + 1,
        standard_end: '18:00',
        end_next_day: false,
        deleted_at: null,
      };
      data = row;
    } else if (req.method === 'DELETE') {
      row = row ? { ...row, deleted_at: '2026-10-05', version: Number(v.version) + 1 } : null;
      data = null;
    } else data = { ...employee, status: 'left', left_on: v.left_on };
  } else if (route === '/api/auth/access-mode') data = { public_access: true };
  else if (route === '/api/auth/enter')
    data = {
      access_token: 'schedule-test',
      user: {
        id: '0',
        company_id: '2',
        company_code: 'tmy',
        username: 'public',
        real_name: '测试',
        role: 'boss',
        must_change_password: false,
        public_access: true,
      },
    };
  else if (route === '/api/employees')
    data = { items: [employee], total: 1, page: 1, page_size: 200 };
  else if (route === '/api/departments')
    data = { items: [{ id: '1', name: '蛋糕部' }], total: 1, page: 1, page_size: 200 };
  else if (route === '/api/employee-schedules')
    data = {
      today: '2026-10-05',
      month: url.searchParams.get('month'),
      days: 31,
      employees: [employee],
      items: row ? [row] : [],
      balances: [
        {
          employee_id: '1',
          opening_minutes: 60,
          overtime_minutes: 0,
          timeoff_minutes: 0,
          balance_minutes: 60,
          planned_net_minutes: -60,
        },
      ],
      rest_monthly_quota_days: 4,
      rest_balances: [
        {
          employee_id: '1',
          start_month: '2026-10',
          opening_days: 0,
          quota_days: 4,
          taken_days: row?.shift_kind === 'rest' && row.work_date === '2026-10-05' ? 1 : 0,
          current_unused_days: row?.shift_kind === 'rest' && row.work_date === '2026-10-05' ? 3 : 4,
          carry_remaining_days: 0,
          unused_days: row?.shift_kind === 'rest' && row.work_date === '2026-10-05' ? 3 : 4,
          planned_rest_days: row?.shift_kind === 'rest' && row.work_date === '2026-10-06' ? 1 : 0,
          planned_unused_days: row?.shift_kind === 'rest' ? 3 : 4,
          excess_rest_days: 0,
        },
      ],
    };
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
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  const primary = page.getByRole('menu', { name: '一级导航', exact: true });
  const secondary = page.locator('.workspace-subnav');
  await primary.getByRole('menuitem', { name: '员工管理', exact: true }).click();
  await page.getByRole('heading', { name: '员工管理', exact: true }).waitFor();
  assert.deepEqual(await secondary.getByRole('menuitem').allTextContents(), [
    '员工资料',
    '排班管理',
  ]);
  assert.equal(await page.getByRole('button', { name: '删除', exact: true }).count(), 0);
  await page.getByRole('button', { name: '离职', exact: true }).click();
  await page.getByRole('dialog').getByLabel('离职日期').fill('2026-10-10');
  await page.getByRole('dialog').getByRole('button', { name: '登记离职', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(writes[0].body.left_on, '2026-10-10');
  await secondary.getByRole('menuitem', { name: '排班管理', exact: true }).click();
  await page.getByRole('heading', { name: '排班管理', exact: true }).waitFor();
  await page.getByLabel('排班月份', { exact: true }).fill('2026-10');
  await page.getByText('截至服务器 2026-10-05', { exact: false }).waitFor();
  const restCard = page.locator('.ant-card').filter({ hasText: '例休与未休天数' });
  await restCard.getByRole('columnheader', { name: '本月未休', exact: true }).waitFor();
  assert.equal(await restCard.getByRole('cell', { name: '4天', exact: true }).count(), 4);
  const hourCard = page.locator('.ant-card').filter({ hasText: '加班与调休余额' });
  await hourCard.getByRole('columnheader', { name: '按计划执行后余额', exact: true }).waitFor();
  assert.equal(
    await hourCard.getByRole('row').nth(1).getByRole('cell').last().textContent(),
    '0小时',
  );
  const cells = page.locator('.schedule-cell');
  await cells.first().waitFor();
  await cells.nth(3).click();
  await page.getByRole('dialog').filter({ hasText: '2026-10-04' }).waitFor();
  await page.getByLabel('开始时间', { exact: true }).fill('09:00');
  await page.getByRole('dialog').getByRole('button', { name: '保存排班', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(writes[1].path, '/api/employee-schedules/1/2026-10-04');
  assert.equal(writes[1].body.version, 0);
  await cells.nth(3).filter({ hasText: '09:00–18:00' }).waitFor();
  await cells.nth(3).click();
  await page.getByLabel('加班（小时）', { exact: true }).fill('2');
  await page.getByRole('dialog').getByRole('button', { name: '保存排班', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(writes[2].body.version, 1);
  assert.equal(writes[2].body.overtime_minutes, 120);
  await cells.nth(3).filter({ hasText: '加班 2小时' }).waitFor();
  await cells.nth(3).click();
  await page.getByRole('dialog').getByRole('button', { name: '清除排班', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(writes[3].path, '/api/employee-schedules/1/2026-10-04');
  assert.equal(writes[3].body.version, 2);
  await cells.nth(3).filter({ hasText: '未排班' }).waitFor();
  await cells.nth(4).click();
  await page.getByLabel('开始时间', { exact: true }).fill('09:00');
  await page.getByText('正常结束：18:00', { exact: false }).waitFor();
  await page.getByLabel('加班（小时）', { exact: true }).fill('1.5');
  await page.getByLabel('调休（小时）', { exact: true }).fill('0.5');
  await page.getByRole('dialog').getByRole('button', { name: '保存排班', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(writes[4].body.overtime_minutes, 90);
  assert.equal(writes[4].body.timeoff_minutes, 30);
  assert.equal(writes[4].body.version, 0);
  await cells.nth(4).filter({ hasText: '09:00–18:00' }).waitFor();
  await cells.nth(5).click();
  await page.getByLabel('班次', { exact: true }).press('ArrowDown');
  await page.getByText('例休（1天，扣例休天数）', { exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '保存排班', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(writes[5].body.shift_kind, 'rest');
  assert.equal(writes[5].body.timeoff_minutes, 0);
  const restCells = restCard.getByRole('row').nth(1).getByRole('cell');
  assert.equal(await restCells.nth(6).textContent(), '4天');
  assert.equal(await restCells.nth(7).textContent(), '1天');
  assert.equal(await restCells.nth(8).textContent(), '3天');
  await page.screenshot({ path: '/tmp/tmy-employee-scheduling.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS staff navigation, departure date, historical create/edit/clear, start/end and exact-minute schedule request. No production data touched.',
  );
} finally {
  await app.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
