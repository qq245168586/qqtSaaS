import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { z } from 'zod';
const profile = await mkdtemp(path.join(tmpdir(), 'tmy-wiki-folders-'));
const folders: Array<{ id: string; path: string }> = [];
const pageInput = z.object({
  title: z.string(),
  icon: z.string(),
  parent_id: z.string().nullable(),
  directory_path: z.string(),
  blocks: z.array(z.unknown()),
  position: z.number(),
});
type Page = z.infer<typeof pageInput> & {
  id: string;
  version: number;
  updated_at: string;
  updated_by_name: string;
};
let saved: Page | null = null;
const server = createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', 'http://localhost');
  let data: unknown = { items: [], total: 0, page: 1, page_size: 20 };
  if (u.pathname === '/api/auth/access-mode') data = { public_access: true };
  else if (u.pathname === '/api/auth/enter')
    data = {
      access_token: 'test',
      user: {
        id: '1',
        company_id: '1',
        company_code: 'tmy',
        username: 'test',
        real_name: '测试',
        role: 'boss',
        must_change_password: false,
        public_access: true,
      },
    };
  else if (u.pathname === '/api/wiki/directories') {
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const part of req) chunks.push(Buffer.from(part));
      const input = z
        .object({ path: z.string() })
        .parse(JSON.parse(Buffer.concat(chunks).toString()));
      const parts = input.path.split('/').filter(Boolean);
      for (let i = 1; i <= parts.length; i++) {
        const p = '/' + parts.slice(0, i).join('/');
        if (!folders.some((f) => f.path === p))
          folders.push({ id: String(folders.length + 1), path: p });
      }
      data = folders.at(-1);
    } else data = { items: folders, total: folders.length };
  } else if (u.pathname === '/api/wiki/pages' || u.pathname === '/api/wiki/pages/1') {
    if (req.method === 'POST' || req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const part of req) chunks.push(Buffer.from(part));
      const input = pageInput.parse(JSON.parse(Buffer.concat(chunks).toString()));
      saved = {
        ...input,
        id: '1',
        version: (saved?.version ?? 0) + 1,
        updated_at: '2026-11-13 22:00:00',
        updated_by_name: '测试',
      };
      data = saved;
    } else
      data = u.pathname.endsWith('/1')
        ? saved
        : { items: saved ? [saved] : [], total: saved ? 1 : 0 };
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ code: 0, message: 'ok', data }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const addr = server.address();
assert(addr && typeof addr !== 'string');
await writeFile(
  path.join(profile, 'connection.json'),
  JSON.stringify(`http://127.0.0.1:${addr.port}`),
);
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, TMY_PHASE2_TEST_DIR: profile },
});
try {
  const p = await app.firstWindow();
  p.setDefaultTimeout(15000);
  await p
    .locator('.app-sidebar')
    .getByRole('menuitem', { name: 'Confluence', exact: true })
    .click();
  await p.getByRole('button', { name: /^目\s*录$/ }).click();
  await p.getByLabel('新目录路径').fill('操作流程/生产');
  await p.getByRole('button', { name: /^创\s*建$/ }).click();
  await p.getByText('目录已创建', { exact: true }).waitFor();
  await p.getByRole('button', { name: /页\s*面$/ }).click();
  await p.getByLabel('页面标题').fill('目录测试文档');
  await p.locator('.wiki-rich-content[contenteditable="true"]').fill('正文和目录独立保存');
  await p.getByRole('button', { name: /^保\s*存$/ }).click();
  await p.getByText('页面已保存', { exact: true }).waitFor();
  assert(saved);
  assert.equal((saved as Page).directory_path, '/操作流程/生产');
  await p.getByRole('button', { name: /Edit$/ }).click();
  await p.locator('.confluence-directory-field .ant-select-selector').click();
  await p.getByTitle('未分类（/）', { exact: true }).click();
  await p.getByRole('button', { name: /^保\s*存$/ }).click();
  await p.getByText('目录：未分类（/）', { exact: true }).waitFor();
  assert.equal((saved as Page).directory_path, '/');
  assert.ok(JSON.stringify((saved as Page).blocks).includes('正文和目录独立保存'));
  for (const width of [1280, 1024]) {
    await p.setViewportSize({ width, height: 800 });
    const fits = await p.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    assert.ok(fits, `Layout must fit at ${width}px`);
  }
  console.log(
    'Confluence nested folder creation, save selection, document relocation and content preservation verified with isolated data',
  );
} finally {
  await app.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
