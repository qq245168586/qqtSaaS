import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
const profile = await mkdtemp(path.join(tmpdir(), 'qqt-voice-ui-'));
let uploads = 0,
  writes = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (
    req.method === 'POST' &&
    !url.pathname.startsWith('/api/ai/') &&
    url.pathname !== '/api/auth/enter'
  )
    writes++;
  let data: unknown = { items: [], total: 0, page: 1, page_size: 100 };
  if (url.pathname === '/api/auth/access-mode') data = { public_access: true };
  if (url.pathname === '/api/auth/enter')
    data = {
      access_token: 'isolated-test',
      user: {
        id: '1',
        company_id: '2',
        company_code: 'tmy',
        username: 'test',
        real_name: '测试',
        role: 'boss',
        must_change_password: false,
        public_access: true,
      },
    };
  if (url.pathname === '/api/ai/voice/status')
    data = { available: true, message: '隔离录音测试，不发送外部服务' };
  if (url.pathname === '/api/ai/voice/transcribe') {
    for await (const _chunk of req) {
    }
    uploads++;
    data = { text: '明天下午五点之前完成二楼物料盘点。' };
  }
  if (url.pathname === '/api/ai/voice/document')
    data = {
      title: '物料盘点备忘录',
      sections: [{ heading: '工作安排', text: '明天下午五点前完成二楼物料盘点。' }],
    };
  if (url.pathname === '/api/todos/reminders')
    data = { overdue_count: 0, server_now: '2026-11-17 22:00:00' };
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
  args: ['.', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  env: { ...process.env, TMY_PHASE2_TEST_DIR: profile },
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.getByRole('button', { name: '◉ 语音输入', exact: true }).click();
  await page.getByRole('button', { name: '结束并识别' }).waitFor();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '结束并识别' }).click();
  await page.waitForFunction(() =>
    document
      .querySelector<HTMLTextAreaElement>('[aria-label="全局AI输入"]')
      ?.value.includes('物料盘点'),
  );
  assert.equal(uploads, 1);
  assert.equal(writes, 0);
  await page.locator('.ant-drawer-close').click();
  await page.getByRole('menuitem', { name: 'Confluence', exact: true }).click();
  await page.locator('.confluence-create-actions button').first().click();
  await page.getByText('语音／口述整理为文档', { exact: true }).click();
  await page.getByLabel('文档口述原文').fill('明天盘点二楼物料。');
  await page.getByRole('button', { name: '整理为草稿' }).click();
  await page.getByRole('button', { name: '确认加入正文，继续编辑' }).click();
  await page
    .locator('.tiptap')
    .getByText('明天下午五点前完成二楼物料盘点。', { exact: true })
    .waitFor();
  assert.equal(await page.getByLabel('页面标题').inputValue(), '物料盘点备忘录');
  assert.equal(writes, 0);
  await page.screenshot({ path: '/tmp/qqt-voice-confluence.png' });
  console.log(
    'PASS: fake recording, transcription, document preview and insertion; no business writes',
  );
} finally {
  await app.close();
  server.close();
}
