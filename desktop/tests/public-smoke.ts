import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
const profile = await mkdtemp(path.join(tmpdir(), 'phase2-public-smoke-'));
const companies = [
  { id: '1', code: 'tri', name: '趣趣特' },
  { id: '2', code: 'tmy', name: '天美意' },
];
const tasks = companies.map((c) => ({
  id: c.id,
  title: `${c.name}测试订单`,
  delivery_note_count: c.id === '1' ? 1 : 0,
  company_code: c.code,
  company_name: c.name,
  content: '共享工作台测试',
  status: 'waiting_ship',
  priority: 'normal',
  task_type: 'order',
  department_id: '1',
  assignee_employee_id: '1',
  expected_delivery_at: '2026-09-22 15:30',
}));
const notes = companies.map((c) => ({
  id: c.id,
  company_code: c.code,
  company_name: c.name,
  note_number: `${c.code.toUpperCase()}TEST001`,
  source_task_id: c.id === '1' ? '1' : null,
  delivery_date: '2026-09-22',
  customer_name_snapshot: `${c.name}测试客户`,
  is_draft: false,
  total_amount: '12.00',
  printed_at: c.id === '1' ? '2026-09-22 16:00:00' : null,
  items: [{ product_name: '蛋糕', unit: '个', quantity: '1', unit_price: '12.00' }],
}));
let imageDownloads = 0;
let enters = 0,
  refreshes = 0,
  deletedTasks = 0,
  expireNext = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/image.png') {
    imageDownloads++;
    res.setHeader('Content-Type', 'image/png');
    res.end(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/kcAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    return;
  }
  let data: unknown = { items: [], total: 0, page: 1, page_size: 100 };
  const page = (items: unknown[]) => ({ items, total: items.length, page: 1, page_size: 100 });
  if (url.pathname === '/api/auth/access-mode') data = { public_access: true };
  else if (url.pathname === '/api/auth/enter') {
    const chunks: Buffer[] = [];
    for await (const chunk of req)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { client: 'desktop' });
    enters++;
    data = {
      access_token: `public-${enters}`,
      user: {
        id: '0',
        company_id: '2',
        company_code: 'tmy',
        username: 'public',
        real_name: '共享工作台',
        role: 'boss',
        must_change_password: false,
        public_access: true,
      },
    };
  } else if (url.pathname === '/api/company-suggestions')
    data = {
      company_code: 'tri',
      company_match: {
        source: 'learned',
        reason: '历史人工选择匹配御牛纪',
        confidence: 1,
        keyword: '御牛纪',
        sample_count: 3,
        agreement: 1,
      },
    };
  else if (url.pathname === '/api/auth/refresh') {
    refreshes++;
    res.statusCode = 401;
  } else if (url.pathname === '/api/companies') data = page(companies);
  else if (req.method === 'DELETE' && /^\/api\/tasks\/\d+$/.test(url.pathname)) {
    const id = url.pathname.split('/').at(-1);
    const index = tasks.findIndex((task) => task.id === id);
    if (index >= 0) tasks.splice(index, 1);
    deletedTasks++;
    data = null;
  } else if (url.pathname === '/api/tasks') {
    if (expireNext) {
      expireNext = false;
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ code: 401, message: 'expired', data: null }));
      return;
    }
    data = page(tasks);
  } else if (url.pathname === '/api/tasks/1/images')
    data = page([
      { id: '9', url: `http://127.0.0.1:${address.port}/image.png?signature=${Date.now()}` },
    ]);
  else if (url.pathname === '/api/tasks/1/delivery-notes') data = page([notes[0]]);
  else if (url.pathname === '/api/tasks/1') data = tasks[0];
  else if (url.pathname === '/api/delivery-notes/personnel-suggestions')
    data = {
      defaults: {
        maker_name: '习惯制单员',
        warehouse_name: '习惯仓管员',
        sales_name: '习惯业务员',
        deliverer_name: '习惯送货员',
      },
      options: {
        maker_name: [
          {
            name: '习惯制单员',
            score: 8,
            usage_count: 8,
            customer_matches: 0,
            product_matches: 0,
            last_used_at: '2026-09-22 12:00:00',
          },
        ],
        warehouse_name: [
          {
            name: '习惯仓管员',
            score: 7,
            usage_count: 7,
            customer_matches: 0,
            product_matches: 0,
            last_used_at: '2026-09-22 12:00:00',
          },
        ],
        sales_name: [
          {
            name: '习惯业务员',
            score: 6,
            usage_count: 6,
            customer_matches: 0,
            product_matches: 0,
            last_used_at: '2026-09-22 12:00:00',
          },
        ],
        deliverer_name: [
          {
            name: '习惯送货员',
            score: 5,
            usage_count: 5,
            customer_matches: 0,
            product_matches: 0,
            last_used_at: '2026-09-22 12:00:00',
          },
        ],
      },
    };
  else if (url.pathname === '/api/delivery-notes') data = page(notes);
  else if (url.pathname === '/api/delivery-summary')
    data = {
      items: [
        {
          customer_name_snapshot: '汇总测试客户',
          category_name: '门店',
          note_count: '2',
          item_count: '3',
          quantity: '4.00',
          total_amount: '25.00',
          last_delivery_date: '2026-09-22',
        },
      ],
    };
  else if (/^\/api\/delivery-notes\/\d+$/.test(url.pathname))
    data = notes.find((note) => note.id === url.pathname.split('/').at(-1));
  else if (url.pathname === '/api/departments')
    data = page([{ id: '1', name: '共同部门', company_code: 'tri' }]);
  else if (url.pathname === '/api/employees')
    data = page([
      { id: '1', name: '共同员工', department_id: '1', status: 'active', company_code: 'tri' },
    ]);
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
await writeFile(path.join(profile, 'session.encrypted'), 'stale-test-refresh');
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, TMY_PHASE2_TEST_DIR: profile },
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.getByRole('menuitem', { name: '零售', exact: true }).click();
  await page.getByRole('menuitem', { name: '任务汇总', exact: true }).click();
  await page.getByText('趣趣特测试订单', { exact: true }).waitFor();
  await page.getByText('天美意测试订单', { exact: true }).waitFor();
  await page.evaluate(async () => {
    await window.desktop.image({ taskId: '1', id: '9' });
    await window.desktop.image({ taskId: '1', id: '9' });
  });
  assert.equal(imageDownloads, 1);
  assert.equal(await page.getByLabel('账户', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '进入工作台' }).count(), 0);
  for (const label of ['账号管理', '备份与恢复', '备份导出', '账户设置'])
    assert.equal(await page.getByRole('menuitem', { name: label, exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '退出登录' }).count(), 0);
  await assert.rejects(access(path.join(profile, 'session.encrypted')));
  assert.equal(
    await page.getByRole('button', { name: '已关联送货单（1）', exact: true }).count(),
    1,
  );
  await page
    .getByRole('row')
    .filter({ hasText: '天美意测试订单' })
    .getByRole('button', { name: /^删\s*除$/ })
    .click();
  const deleteDialog = page.getByRole('dialog').filter({ hasText: '删除此任务？' });
  await deleteDialog.getByRole('button', { name: /^确\s*定$/ }).click();
  await page.getByText('天美意测试订单', { exact: true }).waitFor({ state: 'detached' });
  assert.equal(deletedTasks, 1);
  await page.getByRole('button', { name: '已关联送货单（1）', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /TRITEST001/ })
    .click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: /^取\s*消$/ }).click();
  await page.getByRole('button', { name: '来源任务', exact: true }).click();
  await page.getByRole('dialog').getByText('趣趣特', { exact: true }).waitFor();
  await page.getByRole('button', { name: /^取\s*消$/ }).click();
  await page.getByRole('button', { name: '手动新建' }).click();
  await page.getByRole('dialog').getByText('天美意', { exact: true }).waitFor();
  await page.getByRole('dialog').getByLabel('任务标题').fill('御牛纪面包订单');
  await page.getByRole('dialog').getByText('历史人工选择匹配御牛纪', { exact: true }).waitFor();
  await page.getByRole('dialog').getByText('趣趣特', { exact: true }).waitFor();
  await page.getByRole('button', { name: /^取\s*消$/ }).click();
  await page
    .getByRole('row')
    .filter({ hasText: '趣趣特测试订单' })
    .getByRole('button', { name: /^编\s*辑$/ })
    .click();
  await page.getByRole('dialog').getByText('趣趣特', { exact: true }).waitFor();
  await page.getByRole('button', { name: /^取\s*消$/ }).click();
  expireNext = true;
  const before = enters;
  await page.getByRole('button', { name: /^刷\s*新$/ }).click();
  await page.waitForFunction(() => !document.querySelector('.ant-spin-spinning'));
  assert.equal(enters, before + 1);
  assert.equal(refreshes, 0);
  await page.getByRole('menuitem', { name: '供应链', exact: true }).click();
  await page.getByRole('menuitem', { name: '送货单', exact: true }).click();
  await page.getByText('TRITEST001', { exact: true }).waitFor();
  await page.getByText('TMYTEST001', { exact: true }).waitFor();
  await page.getByRole('button', { name: '新建送货单' }).click();
  const deliveryDialog = page.getByRole('dialog');
  await deliveryDialog.getByRole('columnheader', { name: '序号' }).waitFor();
  await page.waitForFunction(
    () =>
      (
        [...document.querySelectorAll('.editor-personnel label')]
          .find((label) => label.textContent?.includes('仓管'))
          ?.querySelector('input') as HTMLInputElement | null
      )?.value === '习惯仓管员',
  );
  assert.equal(await deliveryDialog.getByLabel('制单人').inputValue(), '习惯制单员');
  assert.equal(await deliveryDialog.getByLabel('仓管').inputValue(), '习惯仓管员');
  assert.equal(await deliveryDialog.getByLabel('业务').inputValue(), '习惯业务员');
  assert.equal(await deliveryDialog.getByLabel('送货人').inputValue(), '习惯送货员');
  for (const heading of ['产品名称', '规格', '单位', '数量', '单价', '金额', '备注', '操作'])
    assert.equal(await deliveryDialog.getByRole('columnheader', { name: heading }).count(), 1);
  await deliveryDialog.getByPlaceholder('数量').fill('2');
  await deliveryDialog.getByPlaceholder('单价').fill('12.5');
  await deliveryDialog
    .locator('.delivery-row-amount')
    .getByText('¥ 25.00', { exact: true })
    .waitFor();
  await deliveryDialog.getByRole('button', { name: '+ 增加一行产品' }).click();
  assert.equal(await deliveryDialog.getByRole('row').count(), 3);
  await page.getByRole('button', { name: /^取\s*消$/ }).click();
  await page.getByRole('menuitem', { name: '送货汇总', exact: true }).click();

  await page.getByText('汇总测试客户', { exact: true }).waitFor();
  for (const heading of ['客户', '分类', '单据数', '品项数', '数量', '总金额', '最后送货'])
    assert.equal(await page.getByRole('columnheader', { name: heading, exact: true }).count(), 1);
  assert.equal(await page.getByRole('columnheader', { name: 'id', exact: true }).count(), 0);
  await page.getByRole('menuitem', { name: '送货单', exact: true }).click();
  const printedRow = page.locator('.note-row').filter({ hasText: 'TRITEST001' });
  const unprintedRow = page.locator('.note-row').filter({ hasText: 'TMYTEST001' });
  await printedRow.waitFor();
  await unprintedRow.waitFor();
  assert.equal(await printedRow.locator('[aria-label="已打印"]').count(), 1);
  assert.equal(await unprintedRow.locator('[aria-label="未打印"]').count(), 1);
  await printedRow.locator('.note-print-select').click();
  await unprintedRow.locator('.note-print-select').click();
  await page.getByRole('button', { name: '一起打印（2）' }).click();
  const preview = page.locator('.print-preview-source');
  await preview.getByText('深圳市趣趣特餐饮管理有限公司', { exact: true }).waitFor();
  await preview.getByText('深圳市天美意餐饮管理有限公司', { exact: true }).waitFor();
  assert.equal(await preview.locator('.delivery-paper').count(), 2);
  console.log(
    'PASS: React 19删除确认与任务列表移除、公司建议自动匹配、双向关联跳转、图片原图只下载一次、汇总自动查询、公开自动进入、无旧refresh/登录/公司入口、跨公司列表与表单、送货明细表格与金额联动、中文送货汇总、令牌失效自动重入、双公司打印抬头。',
  );
} finally {
  await app.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
