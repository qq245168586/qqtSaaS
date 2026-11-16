import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { defaultReportFilters } from '../src/delivery-report';
import ExcelJS from 'exceljs';
const profile = await mkdtemp(path.join(tmpdir(), 'tmy-delivery-report-'));
const dates = defaultReportFilters();
const notes = Array.from({ length: 103 }, (_, i) => ({
  id: String(i + 1),
  company_code: i < 100 ? 'tmy' : 'tri',
  customer_id: i < 100 ? '11' : '12',
  customer_name_snapshot: i === 101 ? '其他客户' : '御牛纪',
  delivery_date: dates.start,
  note_number: `TEST${i + 1}`,
  is_draft: i === 102 ? 1 : 0,
  total_amount: i < 100 ? '1.50' : i === 100 ? '2.50' : '3.00',
  items: [
    {
      product_name: i < 100 ? '意面' : '蛋糕',
      spec: '',
      unit: '个',
      quantity: '1',
      unit_price: i < 100 ? '1.50' : i === 100 ? '2.50' : '3.00',
      amount: i < 100 ? '1.50' : i === 100 ? '2.50' : '3.00',
    },
  ],
}));
let secondPageRead = false;
let mutationCalls = 0;
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const page = Number(url.searchParams.get('page') ?? 1);
  const size = Number(url.searchParams.get('page_size') ?? 100);
  let data: unknown = { items: [], total: 0, page, page_size: size };
  if (url.pathname === '/api/auth/access-mode') data = { public_access: true };
  else if (url.pathname === '/api/auth/enter')
    data = {
      access_token: 'isolated-test-token',
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
  else if (url.pathname === '/api/health') data = { status: 'ok' };
  else if (url.pathname === '/api/delivery-notes') {
    if (url.searchParams.has('start_date') && page === 2) secondPageRead = true;
    data = {
      items: notes.slice((page - 1) * size, page * size),
      total: notes.length,
      page,
      page_size: size,
    };
  } else if (url.pathname === '/api/customers')
    data = {
      items: [
        { id: '11', company_code: 'tmy', name: '御牛纪' },
        { id: '12', company_code: 'tri', name: '御牛纪' },
      ],
      total: 2,
      page,
      page_size: size,
    };
  else if (req.method !== 'GET') mutationCalls++;
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
  await app.evaluate(({ ipcMain }) => {
    const captured = ipcMain as typeof ipcMain & {
      statementExports: { name: string; data: number[] }[];
    };
    captured.statementExports = [];
    ipcMain.removeHandler('file:save');
    ipcMain.handle('file:save', async (_, input: unknown) => {
      if (
        !input ||
        typeof input !== 'object' ||
        !('name' in input) ||
        typeof input.name !== 'string' ||
        !('data' in input) ||
        !(input.data instanceof Uint8Array)
      )
        throw new Error('Invalid export bytes');
      captured.statementExports.push({ name: input.name, data: Array.from(input.data) });
      return { ok: true, data: true };
    });
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.getByRole('menuitem', { name: '供应链', exact: true }).click();
  await page.getByRole('menuitem', { name: '送货汇总', exact: true }).click();
  await page.getByRole('button', { name: '导出对账 Excel（汇总＋明细）', exact: true }).waitFor();
  await page.getByText('155.50', { exact: true }).first().waitFor();
  assert(secondPageRead, '必须加载第二页，不能只导出当前页');
  await page.getByRole('combobox', { name: '对账客户', exact: true }).fill('御牛纪');
  await page.getByRole('combobox', { name: '对账客户', exact: true }).press('Enter');
  await page.getByText('152.50', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '导出对账 Excel（汇总＋明细）', exact: true }).click();
  await page.getByText('已导出 2 个公司对账文件（各含汇总、明细）', { exact: true }).waitFor();
  const exports = await app.evaluate(
    ({ ipcMain }) =>
      (ipcMain as typeof ipcMain & { statementExports: { name: string; data: number[] }[] })
        .statementExports,
  );
  assert.equal(exports.length, 2);
  for (const [index, file] of exports.entries()) {
    assert(file.name.endsWith('.xlsx'));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(file.data));
    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      ['汇总', '明细'],
    );
    const summary = workbook.getWorksheet('汇总')!;
    const detail = workbook.getWorksheet('明细')!;
    assert.equal(summary.getCell('D5').value, index === 0 ? 150 : 2.5);
    assert.equal(detail.rowCount, index === 0 ? 104 : 5, '两份公司文件完整保留全部101张客户单据');
    assert(!JSON.stringify(workbook.model).includes('其他客户'));
    assert(!JSON.stringify(workbook.model).includes('TEST103'));
  }
  await page.getByText('全部公司', { exact: true }).click();
  await page
    .locator('.ant-select-item-option-content')
    .filter({ hasText: /^趣趣特/ })
    .click();
  await page.getByText('2.50', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '导出对账 Excel（汇总＋明细）', exact: true }).click();
  let single: number[] | undefined;
  for (let attempt = 0; attempt < 30; attempt++) {
    const exports = await app.evaluate(
      ({ ipcMain }) =>
        (ipcMain as typeof ipcMain & { statementExports: { name: string; data: number[] }[] })
          .statementExports,
    );
    if (exports.length === 3) {
      single = exports[2].data;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(single);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(single));
  assert.equal(workbook.getWorksheet('明细')!.rowCount, 5);
  assert.equal(workbook.getWorksheet('明细')!.getCell('B4').value, 'TEST101');
  assert.equal(mutationCalls, 0, '对账功能不能修改源送货单或商品');
  console.log(
    '送货对账端到端通过：103条跨页读取、公司独立文件各含汇总明细、公司客户交集、Excel完整金额、排除草稿；使用隔离服务，无生产写入。',
  );
} catch (error) {
  console.error(await (await app.firstWindow()).locator('body').innerText());
  throw error;
} finally {
  await app.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
