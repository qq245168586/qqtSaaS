import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { importLegacy, legacyDue } from '../src/import-legacy';
import { db } from '../src/db';
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
test('真实SQLite只读dry-run：保留分钟/提示旧日期；不读取密钥；附件目录错误时执行前拒绝', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-import-'));
  const delivery = join(dir, 'delivery.sqlite');
  const tasks = join(dir, 'tasks.sqlite');
  try {
    const d = new DatabaseSync(delivery);
    d.exec(
      'CREATE TABLE delivery_notes(id TEXT,company_id TEXT,number TEXT,payload TEXT,updated_at TEXT)',
    );
    d.prepare('INSERT INTO delivery_notes VALUES(?,?,?,?,?)').run(
      'uuid-1',
      'tri',
      'OLD-001',
      JSON.stringify({
        number: 'OLD-001',
        date: '2026-09-22',
        customerName: '测试客户',
        items: [{ name: '产品', unit: '份', quantity: 3, unitPrice: 0.1 }],
      }),
      '2026-09-22 12:00:00',
    );
    d.close();
    const t = new DatabaseSync(tasks);
    t.exec(
      "CREATE TABLE departments(id INTEGER,name TEXT);INSERT INTO departments VALUES(1,'蛋糕部');CREATE TABLE employees(id INTEGER,name TEXT,department_id INTEGER);INSERT INTO employees VALUES(1,'员工',1);CREATE TABLE tasks(id INTEGER,title TEXT,department_id INTEGER,assignee_id INTEGER,status TEXT,priority TEXT,due_date TEXT,task_type TEXT);INSERT INTO tasks VALUES(1,'旧任务',1,1,'todo','normal','2026-09-22','order');CREATE TABLE task_images(id INTEGER,task_id INTEGER,file_name TEXT,created_at TEXT,data BLOB);CREATE TABLE settings(key TEXT,value TEXT);INSERT INTO settings VALUES('api_key','secret-must-not-leak');",
    );
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } })
      .png()
      .toBuffer();
    t.prepare('INSERT INTO task_images VALUES(?,?,?,?,?)').run(
      1,
      1,
      'image.png',
      '2026-09-22 12:00:00',
      png,
    );
    t.close();
    const before = [hash(delivery), hash(tasks)];
    const report = await importLegacy({ delivery, tasks, sourceKey: 'test', execute: false });
    assert.equal(report.task_company, 'tmy');
    assert.equal(report.date_only_tasks, 1);
    assert.equal(report.counts['tasks.task_images'], 1);
    assert.equal(JSON.stringify(report).includes('secret-must-not-leak'), false);
    assert.deepEqual(report.removed, {});
    const replacement = await importLegacy({
      delivery,
      tasks,
      sourceKey: 'test',
      execute: false,
      replaceDelivery: true,
    });
    assert.equal(
      replacement.warnings.some((item) => item.includes('完整重建')),
      true,
    );
    assert.deepEqual([hash(delivery), hash(tasks)], before);
    const prior = process.env.ATTACHMENT_DIR;
    const secret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.ATTACHMENT_DIR = delivery;
    try {
      await assert.rejects(
        importLegacy({ delivery, tasks, sourceKey: 'test', execute: true }),
        /EEXIST/,
      );
      assert.equal(db.isInitialized, false);
    } finally {
      if (prior) process.env.ATTACHMENT_DIR = prior;
      else delete process.env.ATTACHMENT_DIR;
      if (secret) process.env.JWT_SECRET = secret;
      else delete process.env.JWT_SECRET;
    }
    assert.deepEqual([hash(delivery), hash(tasks)], before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('迁移日期不编造午夜，原分钟时间不改变', () => {
  assert.deepEqual(legacyDue('2026-09-22', '原备注'), {
    expected_delivery_at: null,
    remark: '原备注\n旧系统预计日期：2026-09-22（具体时间待补充）',
  });
  assert.equal(legacyDue('2026-09-22 15:30', '').expected_delivery_at, '2026-09-22 15:30');
});
