import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createPrintTemplate, type PrintTemplate } from '../electron/print-template-model';
const profile = await mkdtemp(path.join(tmpdir(), 'phase2-template-print-'));
const list = (items: unknown[]) => ({ items, total: items.length, page: 1, page_size: 100 });
const user = {
  id: '0',
  company_id: '2',
  company_code: 'tmy',
  username: 'public',
  real_name: '共享工作台',
  role: 'boss',
  must_change_password: false,
  public_access: true,
};
const note = {
  id: '1',
  company_code: 'tmy',
  company_name: '天美意',
  note_number: 'TMYTEST001',
  delivery_date: '2026-09-22',
  customer_name_snapshot: '测试客户',
  is_draft: false,
  total_amount: '2.00',
  items: [{ product_name: '蛋糕', unit: '个', quantity: '1', unit_price: '2.00' }],
};
const otherNote = {
  ...note,
  id: '2',
  company_code: 'tri',
  company_name: '趣趣特',
  note_number: 'TRITEST002',
};
let saved:
  | {
      id: string;
      name: string;
      is_default: number;
      config_json: PrintTemplate;
    }
  | undefined;
let printed = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let data: unknown = list([]);
  if (url.pathname === '/api/auth/access-mode') data = { public_access: true };
  else if (url.pathname === '/api/auth/enter') data = { access_token: 'test', user };
  else if (url.pathname === '/api/auth/me') data = user;
  else if (url.pathname === '/api/companies')
    data = list([{ id: '2', code: 'tmy', name: '天美意' }]);
  else if (url.pathname === '/api/delivery-notes') data = list([note, otherNote]);
  else if (url.pathname === '/api/delivery-notes/1') data = note;
  else if (url.pathname === '/api/delivery-notes/2') data = otherNote;
  else if (/^\/api\/delivery-notes\/[12]\/printed$/.test(url.pathname)) {
    printed++;
    data = {};
  } else if (url.pathname === '/api/print-templates') {
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        name: string;
        is_default: boolean;
        config_json: PrintTemplate;
      };
      saved = { ...body, id: '10', is_default: body.is_default ? 1 : 0 };
      data = saved;
    } else {
      const oldConfig = createPrintTemplate('20');
      oldConfig.table.columnWeights = [5, 10, 23, 4, 7, 9, 11, 15];
      data = list(
        saved
          ? [
              saved,
              {
                id: '20',
                name: '旧八列模板',
                is_default: 0,
                company_code: 'tri',
                config_json: { ...oldConfig, companyId: 'tri' },
              },
            ]
          : [],
      );
    }
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
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const state = globalThis as typeof globalThis & { printCalls: unknown[] };
    state.printCalls = [];
    window.webContents.getPrintersAsync = async () => [
      {
        name: 'test-printer',
        displayName: '模拟打印机',
        description: '测试',
        status: 0,
        isDefault: true,
        options: {},
      },
    ];
    window.webContents.print = (options, callback) => {
      state.printCalls.push(options);
      callback?.(true, '');
    };
  });
  page.setDefaultTimeout(15000);
  await page.getByRole('menuitem', { name: '打印模板', exact: true }).click();
  assert.equal(await page.getByLabel('单据公司', { exact: true }).count(), 0);
  await page.getByLabel('模板名称', { exact: true }).fill('云端默认模板验证');
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await page
    .getByText('已保存到云端，并设为全局默认，应用于两家公司送货单展示和打印。', { exact: true })
    .waitFor();
  assert.equal(saved?.is_default, 1);
  assert.equal(saved && 'company_code' in saved, false);
  assert.equal(saved && 'companyId' in saved.config_json, false);
  await page.getByRole('menuitem', { name: '送货单', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'TMYTEST001' }).getByRole('checkbox').check();
  await page.getByRole('row').filter({ hasText: 'TRITEST002' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: '合并打印（最多 2 单）' }).click();
  await page.getByRole('heading', { name: '打印设置', exact: true }).waitFor();
  assert.equal(await page.getByLabel('本次打印模板', { exact: true }).count(), 1);
  assert.equal(await page.getByLabel('本次打印模板', { exact: true }).inputValue(), '10');
  assert(
    (await page.locator('.browser-print-preview').innerText()).includes(
      '深圳市天美意餐饮管理有限公司',
    ),
  );
  assert(
    (await page.locator('.browser-print-preview').innerText()).includes(
      '深圳市趣趣特餐饮管理有限公司',
    ),
  );
  assert.equal(await page.locator('.print-preview-source .tpl-fit').count(), 0);
  assert.equal(await page.locator('.browser-print-preview .tpl-fit').count(), 2);
  assert.equal(await page.locator('.print-preview-source .delivery-paper').count(), 2);
  assert.equal(
    await page.locator('.preview-printer-settings select').nth(1).inputValue(),
    'test-printer',
  );
  await page.getByLabel('打印份数', { exact: true }).fill('2');
  await page.screenshot({ path: 'release/print-preview-restored.png', fullPage: true });
  const printButton = page.getByRole('button', { name: '打印（2 张）', exact: true });
  if (await printButton.isDisabled())
    throw new Error(
      'Custom preview disabled: ' + (await page.locator('.print-preview-body aside').innerText()),
    );
  await printButton.click();
  await page.getByText(/打印任务已提交到系统队列，已记录打印时间/).waitFor();
  const calls = await app.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          printCalls: { copies: number; pageSize: { width: number; height: number } }[];
        }
      ).printCalls,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].copies, 2);
  assert.equal(calls[0].pageSize.width, Math.round(saved!.config_json.paper.width * 1000));
  assert.equal(printed, 2);
  await page.getByLabel('本次打印模板', { exact: true }).selectOption('20');
  const legacyPapers = page.locator('.browser-print-preview .delivery-paper');
  for (let i = 0; i < 2; i++)
    assert.equal(await legacyPapers.nth(i).locator('.tpl-heading').count(), 8);
  await page.getByLabel('本次打印模板', { exact: true }).selectOption('');
  assert.equal(saved?.is_default, 1);
  await page.getByRole('button', { name: '打印（2 张）', exact: true }).click();
  await page.getByText(/打印任务已提交到系统队列，已记录打印时间/).waitFor();
  assert.equal(printed, 4);
  console.log(
    'PASS cloud template save/default, original split preview layout, unscaled actual print DOM, printer/copies IPC and built-in override without changing default. Native printer is mocked, no physical print.',
  );
} finally {
  await app.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
