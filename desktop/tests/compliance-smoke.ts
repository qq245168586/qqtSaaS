import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';

// Separate profile and read-only proxy: never changes production records or prints.
const profile = await mkdtemp(path.join(tmpdir(), 'tmy-compliance-smoke-'));
const errors: string[] = [];
const fixture = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/compliance/')) {
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    try {
      const response = await fetch(new URL(url.pathname + url.search, 'https://114.215.185.184'));
      for (const header of ['content-type', 'content-security-policy']) {
        const value = response.headers.get(header); if (value) res.setHeader(header, value);
      }
      res.writeHead(response.status); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(502); res.end('Fixture proxy unavailable'); }
    return;
  }
  let data: unknown = { items: [], total: 0, page: 1, page_size: 200 };
  if (url.pathname === '/api/auth/access-mode') data = { public_access: true };
  if (url.pathname === '/api/auth/enter') data = {
    access_token: 'isolated-compliance-test',
    user: { id: '0', company_id: '2', company_code: 'tmy', username: 'public', real_name: '测试', role: 'boss', must_change_password: false, public_access: true },
  };
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ code: 0, message: 'ok', data }));
});
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
const address = fixture.address(); assert(address && typeof address !== 'string');
await writeFile(path.join(profile, 'connection.json'), JSON.stringify(`http://127.0.0.1:${address.port}`));
const app = await electron.launch({ args: ['.'], env: { ...process.env, TMY_PHASE2_TEST_DIR: profile }, timeout: 30000 });
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  const nav = page.getByRole('menu', { name: '一级导航', exact: true });
  const item = nav.getByRole('menuitem', { name: /合规管理/ });
  await item.waitFor(); await item.locator('.ant-badge-dot').waitFor(); await item.click();
  const frame = page.frameLocator('iframe[title="食品安全周期合规工作台"]');
  await frame.locator('.checklist-row').first().waitFor();
  assert.equal(await frame.locator('.checklist-row').count(), 60);
  await frame.locator('[data-view="cycles"]').click();
  await frame.locator('.cycle-table').waitFor();
  assert.equal(await frame.locator('.cycle-table tbody tr').count(), 60);
  await page.screenshot({ path: '/tmp/tmy-compliance-app-2.1.22.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: desktop navigation red dot, actual embedded cycle page, 60 tasks, no renderer errors');
} finally { await app.close(); fixture.close(); }
