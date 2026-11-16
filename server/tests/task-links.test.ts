import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { EntityManager } from 'typeorm';
import { db } from '../src/db';
import { DeliveryController } from '../src/delivery';
import { TaskController } from '../src/tasks';
import { withTaskLinks } from '../src/task-links';
import type { AuthRequest } from '../src/auth';
test('真实SQLite多单关联：不同request_id新建、重试幂等、双向摘要、计数按单非明细、任务软删除保留来源摘要', async (t) => {
  const memory = new DatabaseSync(':memory:');
  t.after(() => memory.close());
  memory.exec(`CREATE TABLE companies(id TEXT,code TEXT,name TEXT);INSERT INTO companies VALUES('1','tri','趣趣特'),('2','tmy','天美意');
 CREATE TABLE tasks(id TEXT,company_id TEXT,title TEXT,status TEXT,expected_delivery_at TEXT,updated_by TEXT,deleted_at TEXT);
 INSERT INTO tasks VALUES('9','1','蛋糕订单','waiting_ship','2026-09-25 10:00',NULL,NULL);
 CREATE TABLE task_images(id TEXT,company_id TEXT,task_id TEXT,oss_key TEXT);
 CREATE TABLE delivery_notes(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id TEXT,note_number TEXT,source_task_id TEXT,conversion_request_id TEXT,delivery_date TEXT,customer_name_snapshot TEXT,is_draft INTEGER,created_by TEXT,updated_by TEXT,deleted_at TEXT,UNIQUE(source_task_id,conversion_request_id));
 CREATE TABLE delivery_note_items(id INTEGER PRIMARY KEY,company_id TEXT,delivery_note_id TEXT,sort INTEGER);
 CREATE TABLE company_choice_samples(entity_type TEXT,entity_id TEXT);
 `);
  t.mock.method(db.manager, 'query', async (sql: string, params: SQLInputValue[] = []) => {
    const prepared = memory.prepare(sql.replace(/ FOR UPDATE$/, ''));
    if (sql.startsWith('SELECT'))
      return prepared
        .all(...params)
        .map((row) => ({ ...row, ...('id' in row ? { id: String(row.id) } : {}) }));
    const result = prepared.run(...params);
    return { insertId: String(result.lastInsertRowid) };
  });
  t.mock.method(db, 'transaction', async (run: (m: EntityManager) => Promise<unknown>) => {
    memory.exec('BEGIN');
    try {
      const result = await run(db.manager);
      memory.exec('COMMIT');
      return result;
    } catch (error) {
      memory.exec('ROLLBACK');
      throw error;
    }
  });
  const req = {
    user: { id: '1', company_id: '2', company_code: 'tmy', role: 'boss', public_access: true },
  } as AuthRequest;
  const controller = new DeliveryController();
  const first = await controller.from(req, '9', {
    request_id: 'c2311bde-644f-49a3-8e99-a1337dbe6274',
  });
  const second = await controller.from(req, '9', {
    request_id: 'c2311bde-644f-49a3-8e99-a1337dbe6275',
  });
  assert.notEqual(first.id, second.id);
  assert.equal(first.company_code, 'tri');
  assert.equal(
    (await controller.from(req, '9', { request_id: 'c2311bde-644f-49a3-8e99-a1337dbe6274' })).id,
    first.id,
  );
  assert.equal((await controller.from(req, '9')).id, first.id);
  assert.equal((first.source_task as { title: string }).title, '蛋糕订单');
  memory.exec(`INSERT INTO delivery_note_items VALUES(1,'1','1',1),(2,'1','1',2),(3,'1','1',3);`);
  const linked = (await withTaskLinks([{ id: '9' }], req.user))[0];
  assert.equal(linked.delivery_note_count, 2);
  const tasks = new TaskController();
  assert.equal((await tasks.deliveries(req, '9')).total, 2);
  await controller.remove(req, String(first.id));
  assert.equal((await tasks.deliveries(req, '9')).total, 1);
  await assert.rejects(
    controller.from(req, '9', { request_id: 'c2311bde-644f-49a3-8e99-a1337dbe6274' }),
    /已删除/,
  );
  for (const status of ['todo', 'doing', 'waiting_ship', 'shipped', 'delivered', 'canceled']) {
    memory.prepare("UPDATE tasks SET status=? WHERE id='9'").run(status);
    const request_id = randomUUID();
    const draft = await controller.from(req, '9', { request_id });
    assert.equal(draft.source_task_id, '9');
    assert.equal((await controller.from(req, '9', { request_id })).id, draft.id);
  }
  await tasks.remove(req, '9');
  await assert.rejects(controller.from(req, '9', { request_id: randomUUID() }));
  assert.ok(memory.prepare("SELECT deleted_at FROM tasks WHERE id='9'").get()?.deleted_at);
  const historic = await controller.get(req, String(second.id));
  assert.equal((historic.source_task as { deleted: boolean }).deleted, true);
});
