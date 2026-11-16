import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createPrintTemplate } from '../electron/print-template-model';
const template = createPrintTemplate('1');
template.isDefault = true;
template.elements.customer.width = 40;
const customerName = '这是一个远远超过四十毫米模板空间的完整历史客户名称';
const productName = '这是一个远远超过产品模板空间的完整历史产品名称';
const personnelName = '这是一个远远超过署名模板空间的完整历史人员姓名';
const profile = await mkdtemp(path.join(tmpdir(), 'phase2-limits-'));
const pageData = (items: unknown[]) => ({ items, total: items.length, page: 1, page_size: 100 });
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let data: unknown = pageData([]);
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
    data = pageData([
      { id: '2', code: 'tmy', name: '天美意' },
      { id: '1', code: 'tri', name: '趣趣特' },
    ]);
  else if (url.pathname === '/api/print-templates')
    data = pageData([
      { id: '1', name: template.name, company_code: 'tmy', is_default: 1, config_json: template },
    ]);
  else if (url.pathname === '/api/customers')
    data = pageData([{ id: '1', name: customerName, address: '地址', phone: '13800138000' }]);
  else if (url.pathname === '/api/products')
    data = pageData([
      { id: '1', name: productName, unit: '个', spec: '规格', default_price: '2.00' },
    ]);
  else if (url.pathname === '/api/personnel') data = pageData([{ id: '1', name: personnelName }]);
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
  await page.locator('.workspace-module-switch').getByText('送货单', { exact: true }).click();
  await page.locator('.app-sidebar').getByRole('menuitem', { name: '送货单', exact: true }).click();
  await page.getByRole('button', { name: '新建送货单' }).click();
  assert.equal(await page.locator('.editor-modal.delivery-editor header h3').count(), 1);
  assert.equal(await page.getByLabel('送货单号', { exact: true }).getAttribute('readonly'), '');
  assert.equal(await page.locator('.editor-head > label').count(), 6);
  assert.equal(await page.locator('.editor-personnel > label').count(), 4);
  await page.getByText('打印后由客户签章', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存送货单', exact: true }).waitFor();
  const layout = await page.locator('.editor-head').evaluate((el) => getComputedStyle(el).display);
  assert.equal(layout, 'grid');
  assert.equal(
    await page
      .locator('.editor-lines th')
      .first()
      .evaluate((el) => getComputedStyle(el).borderRightColor),
    'rgb(20, 20, 20)',
  );
  await page.screenshot({ path: 'release/delivery-editor-restored.png', fullPage: true });
  const customer = page.getByLabel('客户名称', { exact: true });
  await customer.fill('短名');
  assert.equal(await customer.inputValue(), '短名');
  await customer.fill('长'.repeat(100));
  assert((await customer.inputValue()).length < 100);
  await customer.fill('原客户');
  await customer.fill(customerName);
  assert.equal(await customer.inputValue(), '原客户');
  const product = page.getByPlaceholder('产品名称', { exact: true });
  await product.fill('面包');
  await product.fill('长'.repeat(100));
  assert((await product.inputValue()).length < 100);
  await product.fill('这是一个远远');
  await page.locator('.pinyin-suggestions [role="option"]').first().click();
  assert.equal(await product.inputValue(), productName);
  assert.equal(await page.getByPlaceholder('规格', { exact: true }).inputValue(), '规格');
  assert.equal(await page.getByPlaceholder('单位', { exact: true }).inputValue(), '个');
  assert.equal(await page.getByPlaceholder('单价', { exact: true }).inputValue(), '2.00');
  await page.getByText(/商品资料已完整带入/).waitFor();
  await product.fill('面包');
  const person = page.getByLabel('制单人', { exact: true });
  await person.fill('张三');
  await person.fill(personnelName);
  assert.equal(await person.inputValue(), '张三');
  await page.getByPlaceholder('数量', { exact: true }).fill('0.5');
  await page.getByPlaceholder('单价', { exact: true }).fill('0.01');
  await page.getByRole('button', { name: '+ 增加一行产品' }).click();
  await page.getByPlaceholder('产品名称', { exact: true }).nth(1).fill('蛋糕');
  await page.getByPlaceholder('数量', { exact: true }).nth(1).fill('0.5');
  await page.getByPlaceholder('单价', { exact: true }).nth(1).fill('0.01');
  assert.equal(await page.locator('.delivery-total strong').innerText(), '¥ 0.02');
  console.log(
    'PASS template real-DOM limits: manual text truncates, selected products stay complete, and historical customer/personnel values reject atomically.',
  );
} finally {
  await app.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
