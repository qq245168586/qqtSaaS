import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { z } from 'zod';

const profile = await mkdtemp(path.join(tmpdir(), 'tmy-bom-eggs-'));
let parseCalls = 0;
const saveSchema = z.object({
  source_text: z.string(),
  items: z.array(
    z.object({
      product_name: z.string(),
      material_quantity: z.string(),
      bom_unit: z.string(),
      material_remark: z.string(),
    }),
  ),
});
const saves: z.infer<typeof saveSchema>[] = [];
const candidate = (id: string, name: string, unit: string) => ({
  product_id: id,
  product_code: `SP${id}`,
  product_name: name,
  product_spec: '',
  product_unit: unit,
  bom_unit: unit,
  confidence: 95,
  method: '测试匹配',
});
const raw = (name: string, amount: string, unit: string) => ({
  raw_line: `${name}${amount}${unit}`,
  parsed_name: name,
  parsed_spec: '',
  input_quantity: amount,
  input_unit: unit,
  material_remark: '',
  candidates: [candidate(name === '蛋黄' ? '3' : name === '蛋白' ? '4' : '5', name, unit)],
  selected: candidate(name === '蛋黄' ? '3' : name === '蛋白' ? '4' : '5', name, unit),
  match_status: 'matched',
});
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const chunks: Buffer[] = [];
  for await (const chunk of req)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const input: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  let data: unknown = { items: [], total: 0, page: 1, page_size: 100 };
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
  else if (url.pathname === '/api/bom/parse') {
    parseCalls++;
    assert(input && typeof input === 'object' && 'text' in input && typeof input.text === 'string');
    const grams = input.text.includes('克');
    data = {
      bom_number: `BOMTEST${parseCalls}`,
      company_code: 'tri',
      source_text: input.text,
      finished_product: {
        raw_name: '测试蛋糕',
        spec: '',
        yield_quantity: '1',
        yield_unit: '个',
        candidates: [candidate('1', '测试蛋糕', '个')],
      },
      materials: [
        raw('蛋黄', grams ? '90' : '3', grams ? 'g' : '个'),
        raw('蛋白', grams ? '96' : '5', grams ? 'g' : '个'),
        raw('面粉', '80', 'g'),
      ],
      unmatched_count: 0,
    };
  } else if (url.pathname === '/api/kingdee-products')
    data = {
      items: [
        {
          id: '2',
          product_code: 'SP2',
          product_name: '鸡蛋',
          product_spec: '',
          product_unit: '个',
          category_name: '原料',
          barcode: '',
          disabled: false,
          backflush_enabled: false,
          backflush_warehouse: '',
          backflush_position: '',
          cost_method: '移动平均法',
          kingdee_synced_at: null,
        },
      ],
      total: 1,
      page: 1,
      page_size: 200,
    };
  else if (url.pathname === '/api/boms' && req.method === 'POST') {
    saves.push(saveSchema.parse(input));
    data = { id: String(saves.length) };
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
  page.setDefaultTimeout(15000);
  await page.getByRole('menuitem', { name: 'BOM 管理', exact: true }).first().click();
  await page.getByRole('tab', { name: 'AI 生成 BOM', exact: true }).click();
  await page.getByLabel('原始配方', { exact: true }).fill('测试蛋糕\n蛋黄3个\n蛋白5个\n面粉80g');
  await page.getByRole('button', { name: 'AI 解析并匹配' }).click();
  await page.getByText('5 个', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存 BOM', exact: true }).click();
  await page.getByText('BOM已保存，可导出金蝶引入文件', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'BOM 汇总', exact: true, selected: true }).waitFor();
  assert.equal(saves[0]?.items.length, 2);
  assert.equal(saves[0]?.items[0]?.product_name, '鸡蛋');
  assert.equal(saves[0]?.items[0]?.material_quantity, '5');
  assert.equal(saves[0]?.items[1]?.material_quantity, '80');
  assert.match(saves[0]!.items[0]!.material_remark, /未使用蛋黄2颗份/u);
  await page.getByRole('tab', { name: 'AI 生成 BOM', exact: true }).click();
  await page.getByLabel('原始配方', { exact: true }).fill('测试蛋糕\n蛋黄90克\n蛋白96克\n面粉80克');
  await page.getByRole('button', { name: 'AI 解析并匹配' }).click();
  await page.getByText('6 个', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: '整蛋折算设置' }).count(), 0);
  assert.equal(parseCalls, 2, '自动估算不能重复调用AI');
  await page.getByRole('button', { name: '保存 BOM', exact: true }).click();
  await page.getByRole('tab', { name: 'BOM 汇总', exact: true, selected: true }).waitFor();
  assert.equal(saves.length, 2);
  assert.equal(saves[1]?.items.length, 2);
  assert.equal(saves[1]?.items[0]?.material_quantity, '6');
  assert.match(saves[1]!.items[0]!.material_remark, /损耗重量：蛋黄12g、蛋白102g/u);
  assert.match(saves[1]!.source_text, /蛋黄90克/u);
  console.log(
    '整蛋BOM端到端通过：按个合并、克数默认估算50g、不弹重量确认、复用AI结果、重新匹配鸡蛋、保存单行整蛋及损耗；仅使用隔离测试服务。',
  );
} catch (error) {
  console.error((await app.firstWindow()).url());
  console.error(await (await app.firstWindow()).locator('body').innerText());
  console.error(
    await (
      await app.firstWindow()
    )
      .locator('button')
      .evaluateAll((buttons) =>
        buttons.map((button) => ({ text: button.textContent, html: button.outerHTML })),
      ),
  );
  throw error;
} finally {
  await app.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
