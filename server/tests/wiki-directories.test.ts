import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { EntityManager } from 'typeorm';
import { db } from '../src/db';
import type { AuthRequest } from '../src/auth';
import { WikiController, WikiDirectoriesController } from '../src/wiki';
import { wikiDirectoryPath, directoryAncestors } from '../src/wiki-directory';

test('目录路径规范化、层级与非法名称限制', () => {
  assert.equal(wikiDirectoryPath.parse(' 操作流程 / 生产 / '), '/操作流程/生产');
  assert.deepEqual(directoryAncestors('/操作流程/生产'), ['/操作流程', '/操作流程/生产']);
  for (const path of ['/../目录', '/a\\b', '/a\n恶意', '/' + 'a/'.repeat(9), '/' + 'a'.repeat(81)])
    assert.equal(wikiDirectoryPath.safeParse(path).success, false);
});

test('目录创建去重、文档保存与移动、恢复正文不改变分类', async (t) => {
  const memory = new DatabaseSync(':memory:');
  t.after(() => memory.close());
  memory.exec(`CREATE TABLE users(id INTEGER,real_name TEXT);
    INSERT INTO users VALUES(1,'测试');
    CREATE TABLE wiki_directories(id INTEGER PRIMARY KEY AUTOINCREMENT,path TEXT UNIQUE);
    CREATE TABLE wiki_pages(id INTEGER PRIMARY KEY AUTOINCREMENT,parent_id TEXT,directory_path TEXT NOT NULL DEFAULT '/',title TEXT,icon TEXT,content_json TEXT,content_text TEXT,position INTEGER,version INTEGER,created_by TEXT,updated_by TEXT,updated_at TEXT DEFAULT '2026-11-13 22:00',deleted_at TEXT);
    CREATE TABLE wiki_page_versions(id INTEGER PRIMARY KEY AUTOINCREMENT,page_id TEXT,version INTEGER,title TEXT,icon TEXT,content_json TEXT,content_text TEXT,created_by TEXT,created_at TEXT DEFAULT '2026-11-13 22:00');`);
  t.mock.method(db.manager, 'query', async (sql: string, params: SQLInputValue[] = []) => {
    const query = sql
      .replace(/ FOR UPDATE/g, '')
      .replace('ON DUPLICATE KEY UPDATE path=VALUES(path)', 'ON CONFLICT(path) DO NOTHING');
    const statement = memory.prepare(query);
    if (sql.trim().startsWith('SELECT')) return statement.all(...params);
    const result = statement.run(...params);
    return { insertId: String(result.lastInsertRowid), affectedRows: result.changes };
  });
  t.mock.method(db, 'transaction', async (run: (m: EntityManager) => Promise<unknown>) => {
    memory.exec('BEGIN');
    try {
      const value = await run(db.manager);
      memory.exec('COMMIT');
      return value;
    } catch (error) {
      memory.exec('ROLLBACK');
      throw error;
    }
  });
  const req = { user: { id: '1', role: 'boss' } } as AuthRequest;
  const folders = new WikiDirectoriesController(),
    pages = new WikiController();
  await folders.create(req, { path: '操作流程/生产' });
  await folders.create(req, { path: '/操作流程/生产/' });
  assert.equal((await folders.list(req)).total, 2);
  await assert.rejects(
    folders.create({ user: { role: 'employee' } } as AuthRequest, { path: '/无权' }),
  );
  const input = {
    title: '流程',
    icon: '📄',
    parent_id: null,
    position: 0,
    blocks: [{ id: 'p', type: 'paragraph', text: '原文' }],
  };
  const page = await pages.create(req, { ...input, directory_path: '/操作流程/生产' });
  assert.equal(page.directory_path, '/操作流程/生产');
  await assert.rejects(
    pages.update(req, String(page.id), {
      ...input,
      directory_path: '/不存在',
      expected_version: 1,
    }),
    /目录不存在/,
  );
  assert.equal((await pages.get(req, String(page.id))).version, 1);
  await assert.rejects(pages.update(req, String(page.id), { ...input, expected_version: 1 }));
  const updated = await pages.update(req, String(page.id), {
    ...input,
    directory_path: '/操作流程/生产',
    expected_version: 1,
  });
  assert.equal(updated.directory_path, '/操作流程/生产');
  const moved = await pages.update(req, String(page.id), {
    ...input,
    directory_path: '/',
    expected_version: 2,
    create_version: true,
  });
  assert.equal(moved.directory_path, '/');
  await assert.rejects(
    pages.update(req, String(page.id), {
      ...input,
      directory_path: '/操作流程',
      expected_version: 2,
    }),
    /其他人修改/,
  );
  const restored = await pages.restore(req, String(page.id), '1');
  assert.equal(restored.directory_path, '/');
  const legacy = await pages.create(req, input);
  assert.equal(legacy.directory_path, '/');
  assert.equal((await pages.list(req)).total, 2);
  assert.equal((await pages.get(req, String(page.id))).title, '流程');
});
