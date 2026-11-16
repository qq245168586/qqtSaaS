import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'phase2-pinyin-'));
const list = (items: unknown[]) => ({ items, total: items.length, page: 1, page_size: 100 });
let productsFail = false;
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (productsFail && url.pathname === '/api/products') {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ code: 500, message: '模拟产品资料失败', data: null }));
    return;
  }

  let data: unknown = list([]);
  if (url.pathname === '/api/auth/access-mode') data = { public_access: true };
  else if (url.pathname === '/api/auth/enter')
    data = {
      access_token: 'public-test',
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
  else if (url.pathname === '/api/companies')
    data = list([{ id: '2', code: 'tmy', name: '天美意' }]);
  else if (url.pathname === '/api/customers')
    data = list([
      {
        id: '2',
        name: '御牛纪-海岸城店',
        code: null,
        company_code: 'tmy',
        address: '海岸城',
        phone: '13800138000',
      },
      {
        id: '1',
        name: '天美意客户',
        code: null,
        company_code: 'tmy',
        address: '深圳测试地址',
        phone: '13800138000',
      },
    ]);
  else if (url.pathname === '/api/products')
    data = list([
      {
        id: '1',
        name: '奶油蛋糕',
        company_code: 'tmy',
        spec: '六寸',
        unit: '个',
        default_price: '100.00',
      },
    ]);
  else if (url.pathname === '/api/personnel')
    data = list([{ id: '1', name: '张景美', company_code: 'tmy' }]);
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
  await page.getByRole('menuitem', { name: '送货单', exact: true }).click();
  await page.getByRole('button', { name: '新建送货单' }).click();
  const fields = [
    {
      input: page.getByLabel('客户名称', { exact: true }),
      name: '御牛纪-海岸城店',
      option: '御牛纪-海岸城店',
      queries: ['御牛纪', 'yuniuji', 'ynj'],
    },
    {
      input: page.getByLabel('客户名称', { exact: true }),
      name: '天美意客户',
      option: '天美意客户',
      queries: ['美意', 'tianmeiyi', 'TMY'],
    },
    {
      input: page.getByPlaceholder('产品名称', { exact: true }),
      name: '奶油蛋糕',
      option: '奶油蛋糕 · 六寸',
      queries: ['蛋糕', 'naiyoudangao', 'NYDG'],
    },
    {
      input: page.getByLabel('制单人', { exact: true }),
      name: '张景美',
      option: '张景美',
      queries: ['景美', 'zhangjingmei', 'ZJM'],
    },
  ];
  for (const field of fields) {
    for (const query of field.queries) {
      await field.input.fill(query);
      await page.getByRole('option', { name: field.option, exact: true }).waitFor();
      await field.input.press('ArrowDown');
      await field.input.press('Enter');
      assert.equal(await field.input.inputValue(), field.name);
    }
  }
  assert.equal(await page.getByLabel('客户电话', { exact: true }).inputValue(), '13800138000');
  assert.equal(await page.getByPlaceholder('规格', { exact: true }).inputValue(), '六寸');
  assert.equal(await page.getByPlaceholder('单价', { exact: true }).inputValue(), '100.00');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  productsFail = true;
  await page.getByRole('button', { name: '新建送货单' }).click();
  await page.getByText(/产品资料加载失败/).waitFor();
  await page.getByLabel('客户名称', { exact: true }).fill('ynj');
  await page.getByRole('option', { name: '御牛纪-海岸城店', exact: true }).waitFor();
  await page.getByLabel('客户名称', { exact: true }).fill('tmy');
  await page.getByRole('option', { name: '天美意客户', exact: true }).waitFor();
  await page.getByLabel('制单人', { exact: true }).fill('zjm');
  await page.getByRole('option', { name: '张景美', exact: true }).waitFor();
  productsFail = false;
  await page.getByRole('button', { name: '重新加载基础资料' }).click();
  await page.getByPlaceholder('产品名称', { exact: true }).fill('nydg');
  await page.getByRole('option', { name: '奶油蛋糕 · 六寸', exact: true }).waitFor();
  console.log(
    'PASS customer/product/personnel Chinese, full-pinyin and initials suggestion selection; original Chinese values and linked fields preserved.',
  );
} finally {
  await app.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
