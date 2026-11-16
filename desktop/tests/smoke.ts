import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
const profile = await mkdtemp(path.join(tmpdir(), 'phase2-desktop-smoke-'));
const user = {
  id: '1',
  company_id: '1',
  company_code: 'tri',
  username: 'tester',
  real_name: '界面测试',
  role: 'boss',
  must_change_password: false,
};
const task = {
  id: '1',
  title: '界面测试蛋糕',
  content: '仅隔离测试数据',
  status: 'waiting_ship',
  priority: 'normal',
  task_type: 'order',
  department_id: '1',
  assignee_employee_id: '1',
  category_id: '1',
  department_name: '蛋糕部',
  assignee_name: '测试员工',
  category_name: '定制蛋糕',
  expected_delivery_at: '2026-09-22 15:30',
};
const server = createServer((req, res) => {
  const route = new URL(req.url ?? '/', 'http://localhost');
  let data: unknown = { items: [], total: 0, page: 1, page_size: 20 };
  if (route.pathname === '/api/auth/access-mode') data = { public_access: false };
  else if (route.pathname.startsWith('/api/auth/'))
    data = { access_token: 'smoke-access', refresh_token: 'smoke-refresh', user };
  else if (route.pathname === '/api/tasks')
    data = { items: [task], total: 1, page: 1, page_size: 20 };
  else if (route.pathname === '/api/ai/assistant/parse')
    data = {
      clarification: '',
      items: [
        {
          module: 'retail',
          source_text: '明天下午三点送蛋糕',
          warnings: [],
          value: { ...task, status: 'todo' },
        },
      ],
    };
  else if (route.pathname === '/api/departments')
    data = { items: [{ id: '1', name: '蛋糕部' }], total: 1, page: 1, page_size: 100 };
  else if (route.pathname === '/api/employees')
    data = {
      items: [{ id: '1', name: '测试员工', department_id: '1', status: 'active' }],
      total: 1,
      page: 1,
      page_size: 100,
    };
  else if (route.pathname === '/api/categories')
    data = { items: [{ id: '1', name: '定制蛋糕' }], total: 1, page: 1, page_size: 100 };
  // Intentionally no CORS headers: file:// renderer must use the trusted main-process proxy.
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
  page.setDefaultTimeout(12000);
  page.on('dialog', (dialog) => {
    console.log('dialog', dialog.message());
    void dialog.accept();
  });
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  console.log('window ready');
  assert.equal(await page.getByLabel('服务器地址').count(), 0);
  await page.getByLabel('账户', { exact: true }).fill('tester');
  await page.getByLabel('密码', { exact: true }).fill('test-only-password');
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  console.log('login clicked');
  await page.getByRole('menuitem', { name: '零售', exact: true }).click();
  await page.getByRole('menuitem', { name: '任务汇总', exact: true }).click();
  await page.getByText('界面测试蛋糕', { exact: true }).waitFor();
  console.log('tasks ready');
  await page.getByRole('button', { name: '手动新建' }).click();
  await page.getByLabel('任务标题').fill('新任务');
  await page.getByLabel('预计交付（精确到分钟）').fill('2026-09-23T15:30');
  assert.equal(await page.getByLabel('预计交付（精确到分钟）').inputValue(), '2026-09-23T15:30');
  await page.getByRole('button', { name: /^取\s*消$/ }).click();
  console.log('task form done');
  await page.getByRole('button', { name: 'AI 助手' }).click();
  await page.getByLabel('全局AI输入').fill('明天下午三点送蛋糕');
  await page.getByRole('button', { name: '识别并预填' }).click();
  await page.getByRole('button', { name: '打开零售订单填写页' }).waitFor();
  await page.getByRole('button', { name: /Close|关闭/ }).click();
  console.log('AI ready');
  await page.getByRole('menuitem', { name: '供应链', exact: true }).click();
  await page.getByRole('menuitem', { name: '打印模板' }).click();
  console.log('template navigation done');
  await page.getByRole('button', { name: '保存模板', exact: true }).waitFor();
  await page.screenshot({ path: path.join(profile, 'templates.png'), fullPage: true });
  user.id = '2';
  user.role = 'employee';
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByLabel('账户', { exact: true }).fill('employee');
  await page.getByLabel('密码', { exact: true }).fill('test-only-password');
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await page.getByRole('menuitem', { name: '零售', exact: true }).click();
  await page.getByRole('menuitem', { name: '任务汇总', exact: true }).click();
  await page.getByText('界面测试蛋糕', { exact: true }).waitFor();
  assert.equal(await page.getByRole('menuitem', { name: '送货单', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '手动新建' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /^编\s*辑$/ }).count(), 0);
  await page.getByRole('button', { name: /^详\s*情$/ }).click();
  await page.getByRole('dialog').getByText('仅隔离测试数据', { exact: true }).waitFor();
  console.log(
    'PASS: 无 CORS 许可的 file:// Electron 登录、任务列表、分钟时间、AI草稿、原版模板编辑器、员工权限与只读详情。',
  );
} finally {
  await app.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
