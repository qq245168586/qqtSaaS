import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';

// All requests stay on this isolated fixture; no production records or printer jobs are touched.
const profile = await mkdtemp(path.join(tmpdir(), 'phase2-navigation-'));
const errors: string[] = [];
const revenueRequests: URLSearchParams[] = [];
const server = createServer((req, res) => {
  const route = new URL(req.url ?? '/', 'http://localhost').pathname;
  let data: unknown = { items: [], total: 0, page: 1, page_size: 200 };
  if (route === '/api/auth/access-mode') data = { public_access: true };
  if (route === '/api/auth/enter')
    data = {
      access_token: 'navigation-test',
      user: {
        id: '0',
        company_id: '2',
        company_code: 'tmy',
        username: 'public',
        real_name: '测试工作台',
        role: 'boss',
        must_change_password: false,
        public_access: true,
      },
    };
  if (route === '/api/tasks/revenue') {
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
    revenueRequests.push(query);
    const supply = query.get('source') === 'supply';
    const total = supply ? '50.20' : '150.30';
    const group = {
      name: '一乐食堂',
      task_count: supply ? 1 : 2,
      missing_amount_count: 0,
      total_amount: total,
    };
    data = {
      items: [
        {
          id: '2',
          source: 'supply',
          title: 'TEST002',
          customer_name: '一乐食堂',
          order_channel: '',
          amount: '50.20',
          revenue_date: '2026-09-30',
          date_basis: 'delivery',
        },
      ],
      total: supply ? 1 : 2,
      page: 1,
      page_size: 20,
      totals: { ...group, retail_amount: supply ? '0.00' : '100.10', supply_amount: '50.20' },
      by_customer: [group],
      by_channel: supply
        ? []
        : [{ ...group, name: '小红书', total_amount: '100.10', task_count: 1 }],
      by_month: [{ ...group, name: '2026-09' }],
      customers: ['一乐食堂'],
      channels: ['小红书'],
    };
  }
  if (route === '/api/tasks/order-channels')
    data = {
      default_channel: '电话',
      items: [
        { name: '电话', usage_count: 5, last_used_at: '2026-09-30' },
        ...['微信', '小程序', '小红书', '大众点评'].map((name) => ({
          name,
          usage_count: 0,
          last_used_at: '',
        })),
      ],
    };
  if (route === '/api/tasks')
    data = {
      items: [
        {
          id: '1',
          title: '零售蛋糕订单',
          order_channel: '小红书',
          status: 'todo',
          priority: 'normal',
          task_type: 'order',
          expected_delivery_at: '2026-09-30 12:30',
        },
      ],
      total: 1,
      page: 1,
      page_size: 200,
    };
  if (route === '/api/delivery-notes')
    data = {
      items: [
        {
          id: '2',
          note_number: 'TEST002',
          customer_name_snapshot: '一乐食堂',
          delivery_date: '2026-09-30',
          is_draft: false,
          items: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 200,
    };
  if (route === '/api/ai/config')
    data = {
      api_base_url: 'https://example.com/v1',
      model_name: 'test-model',
      api_key_configured: false,
      source: 'server',
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
  page.on('pageerror', (error) => errors.push(error.message));
  const primary = page.getByRole('menu', { name: '一级导航', exact: true });
  const secondary = page.locator('.workspace-subnav');
  await page.getByRole('heading', { name: '任务列表', exact: true }).waitFor();
  await page.getByText('一乐食堂 · 2026-09-30 送货', { exact: true }).waitFor();
  await page.getByText('零售蛋糕订单', { exact: true }).waitFor();
  assert.equal(await page.getByText('小红书', { exact: true }).count(), 1);
  assert.equal(
    await page.getByRole('row').filter({ hasText: '一乐食堂' }).locator('.ant-tag').count(),
    1,
  );
  await page.getByText('2026-09-30 09:00', { exact: true }).waitFor();
  assert.deepEqual(await secondary.getByRole('menuitem').allTextContents(), [
    '任务列表',
    '收入汇总',
    '订单概览',
  ]);
  await page.screenshot({ path: '/tmp/tmy-unified-task-list.png' });
  await secondary.getByRole('menuitem', { name: '收入汇总', exact: true }).click();
  await page.getByRole('heading', { name: '收入汇总', exact: true }).waitFor();
  await page.getByTestId('订单总额').filter({ hasText: '150.30' }).waitFor();
  await page.getByRole('combobox', { name: '收入来源', exact: true }).press('ArrowDown');
  await page.locator('.ant-select-item-option').filter({ hasText: '供应链' }).click();
  await page.getByTestId('订单总额').filter({ hasText: '50.20' }).waitFor();
  assert.equal(
    await page.getByRole('combobox', { name: '筛选渠道', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('combobox', { name: '统计期间', exact: true }).press('ArrowDown');
  await page.locator('.ant-select-item-option').filter({ hasText: '今年' }).click();
  await page.getByTestId('订单总额').filter({ hasText: '50.20' }).waitFor();
  assert.equal(revenueRequests.at(-1)?.get('start_date'), `${new Date().getFullYear()}-01-01`);
  assert.equal(revenueRequests.at(-1)?.get('end_date'), `${new Date().getFullYear()}-12-31`);
  await page.screenshot({ path: '/tmp/tmy-revenue-summary.png' });
  assert.deepEqual(await primary.getByRole('menuitem').allTextContents(), [
    '总览',
    '零售',
    '供应链',
    'BOM 管理',
    '成本核算',
    '员工管理',
    '合规管理',
    'Confluence',
    '设置',
  ]);
  await primary.getByRole('menuitem', { name: '零售', exact: true }).click();
  assert.deepEqual(await secondary.getByRole('menuitem').allTextContents(), [
    '任务汇总',
    '业务分类',
  ]);
  await secondary.getByRole('menuitem', { name: '任务汇总' }).click();
  await page.getByRole('heading', { name: '任务汇总', exact: true }).waitFor();
  await page.getByRole('button', { name: '开送货单', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '开送货单', exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole('columnheader', { name: '状态', exact: true }).count(), 0);
  assert.equal(await page.getByText('全部状态', { exact: true }).count(), 0);
  await page.getByRole('columnheader', { name: '下单渠道', exact: true }).waitFor();
  await page.getByRole('button', { name: '手动新建', exact: true }).click();
  const channel = page.getByRole('combobox', { name: '下单渠道', exact: true });
  await channel.waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLInputElement>('input[aria-label="下单渠道"]')?.value === '电话',
  );
  await channel.fill('展会');
  await page.getByRole('spinbutton', { name: '订单金额（元）', exact: true }).fill('128.50');
  await page.getByLabel('客户名称', { exact: true }).fill('零售客户');
  await page.screenshot({ path: '/tmp/tmy-retail-amount-form.png' });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await primary.getByRole('menuitem', { name: '供应链', exact: true }).click();
  assert.deepEqual(await secondary.getByRole('menuitem').allTextContents(), [
    '送货单',
    '送货汇总',
    '送货基础资料',
    '打印模板',
  ]);
  await secondary.getByRole('menuitem', { name: '送货汇总' }).click();
  await page.getByRole('heading', { name: '送货汇总', exact: true }).waitFor();
  await secondary.locator('.ant-menu-item-selected').filter({ hasText: '送货汇总' }).waitFor();
  await page.screenshot({ path: '/tmp/tmy-navigation-supply-chain.png' });
  await primary.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('heading', { name: 'AI 模型设置', exact: true }).waitFor();
  assert.deepEqual(await secondary.getByRole('menuitem').allTextContents(), [
    'AI 模型设置',
    '部门管理',
  ]);
  await primary.getByRole('menuitem', { name: 'BOM 管理', exact: true }).click();
  await page.getByRole('heading', { name: 'BOM 管理', exact: true }).waitFor();
  await primary.getByRole('menuitem', { name: '成本核算', exact: true }).click();
  await page.getByRole('heading', { name: '成本核算', exact: true }).waitFor();
  await primary.getByRole('menuitem', { name: '供应链', exact: true }).click();
  await page.getByRole('heading', { name: '送货汇总', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: '送货汇总', exact: true }).waitFor();
  await page.setViewportSize({ width: 1080, height: 760 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: primary modules including cost accounting, secondary pages, AI settings relocation, remembered module/page, reload and compact layout.',
  );
} finally {
  await app.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
