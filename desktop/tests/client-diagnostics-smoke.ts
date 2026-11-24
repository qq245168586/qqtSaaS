import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { z } from 'zod';
import { diagnosticEventSchema } from '../electron/client-diagnostics';
const profile = await mkdtemp(path.join(tmpdir(), 'client-diagnostics-smoke-'));
const requests: { deviceId: string; version: string; requestId: string; ua: string }[] = [];
const server = createServer(async (req, res) => {
  requests.push({
    deviceId: String(req.headers['x-device-id'] ?? ''),
    version: String(req.headers['x-app-version'] ?? ''),
    requestId: String(req.headers['x-request-id'] ?? ''),
    ua: String(req.headers['user-agent'] ?? ''),
  });
  const url = new URL(req.url ?? '/', 'http://localhost');
  let data: unknown = { items: [], total: 0, page: 1, page_size: 100 };
  if (url.pathname === '/api/auth/access-mode') data = { public_access: true };
  if (url.pathname === '/api/auth/enter')
    data = {
      access_token: 'test-token',
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
  if (url.pathname === '/api/tasks/999') {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ code: 503, message: 'private customer secret', data: null }));
    return;
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
  await page.getByRole('menuitem', { name: '零售', exact: true }).waitFor({ timeout: 15000 });
  const identity = z
    .object({
      ok: z.literal(true),
      data: z.object({ device_id: z.string().uuid(), app_version: z.string() }),
    })
    .parse(await page.evaluate(() => window.desktop.getClientIdentity()));
  await page.evaluate(async () => {
    await window.desktop.request({
      method: 'GET',
      path: '/tasks/999?secret=do-not-log',
      binary: false,
    });
    await window.desktop.reportRendererError({ kind: 'error', frames: ['index-test.js:1:2'] });
  });
  assert.ok(requests.length > 3);
  for (const req of requests) {
    assert.equal(req.deviceId, identity.data.device_id);
    assert.equal(req.version, identity.data.app_version);
    assert.match(req.ua, /TMY-TRI-Manager/);
    z.string().uuid().parse(req.requestId);
  }
  assert.equal(new Set(requests.map((req) => req.requestId)).size, requests.length);
  const text = await readFile(path.join(profile, 'client-diagnostics.json'), 'utf8');
  const events = z.array(diagnosticEventSchema).parse(JSON.parse(text));
  assert.ok(
    events.some((e) => e.code === 'http_error' && e.status === 503 && e.route === '/api/tasks/:id'),
  );
  assert.ok(events.some((e) => e.code === 'renderer_error'));
  assert.doesNotMatch(text, /private customer|secret|do-not-log/);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('update:state', {
      supported: true,
      phase: 'error',
      current_version: '2.1.34',
      available_version: '2.1.35',
      percent: null,
      message:
        'Windows 拒绝了安装所需的访问权限，本次无法自动安装。请手动安装并处理 Windows 的权限提示。',
      checked_at: new Date().toISOString(),
      manual_required: true,
      failure_code: 'access_denied',
    });
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByText('无法自动安装，请手动安装', { exact: true }).waitFor();
  assert.ok(await dialog.getByText(/Windows 拒绝了安装所需/).isVisible());
  assert.ok(await dialog.getByRole('button', { name: '手动下载安装包', exact: true }).isEnabled());
  assert.equal(await dialog.getByRole('button', { name: '重启更新', exact: true }).count(), 0);
  await dialog.getByRole('button', { name: /稍\s*后/ }).click();
  console.log(
    'PASS: real Electron device/version headers, unique request IDs, HTTP/renderer diagnostics and actionable manual-install error dialog without sensitive text',
  );
} finally {
  await app.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(profile, { recursive: true, force: true });
}
