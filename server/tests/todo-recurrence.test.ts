import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { EntityManager } from 'typeorm';
import type { AuthRequest } from '../src/auth';
import { db, now } from '../src/db';
import { monthlyTimes, restartTimes, todoCreate } from '../src/todos-core';
import { rollMonthlyTodos } from '../src/todo-recurrence';
import { TodosController } from '../src/todos';
const req = { user: { id: '1', role: 'boss' } } as AuthRequest;
test('月度截止日处理闰年、大小月；重新开始保留分钟时长并跨年', () => {
  assert.deepEqual(monthlyTimes('2026-01-31 23:59', '2026-02'), {
    starts_at: '2026-02-01 00:00',
    ends_at: '2026-02-28 23:59',
  });
  assert.equal(monthlyTimes('2026-01-31 23:59', '2028-02').ends_at, '2028-02-29 23:59');
  assert.equal(monthlyTimes('2026-01-31 23:59', '2026-03').ends_at, '2026-03-31 23:59');
  assert.equal(monthlyTimes('2026-01-30 09:00', '2026-03').ends_at, '2026-03-30 09:00');
  assert.deepEqual(restartTimes('2026-11-01 09:00', '2026-11-03 10:30', '2026-12-31 23:45:57'), {
    starts_at: '2026-12-31 23:45',
    ends_at: '2027-01-03 01:15',
  });
  assert.throws(() => restartTimes('2026-11-03 09:00', '2026-11-01 09:00', '2026-12-01 00:00'));
  assert.equal(
    todoCreate.safeParse({
      title: 'x',
      starts_at: '2026-11-01 00:00',
      ends_at: '2026-11-30 23:59',
      progress: 0,
      recurrence: 'daily',
    }).success,
    false,
  );
});
test('月度结转幂等、历史保留、已完成可重开且并发版本阻止重复重开', async (t) => {
  const memory = new DatabaseSync(':memory:');
  t.after(() => memory.close());
  memory.exec(`CREATE TABLE todo_items(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,note TEXT,starts_at TEXT,ends_at TEXT,progress INTEGER,recurrence TEXT DEFAULT 'once',cycle_month TEXT,monthly_anchor_end TEXT,completed_at TEXT,import_key TEXT UNIQUE,version INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT);
  CREATE TABLE todo_history(id INTEGER PRIMARY KEY AUTOINCREMENT,todo_id TEXT,source_version INTEGER,reason TEXT,snapshot_json TEXT,archived_at TEXT,UNIQUE(todo_id,source_version));`);
  t.mock.method(db.manager, 'query', async (sql: string, params: SQLInputValue[] = []) => {
    const statement = memory.prepare(sql.replace(/ FOR UPDATE/g, ''));
    if (sql.trim().startsWith('SELECT')) return statement.all(...params);
    const result = statement.run(...params);
    return { insertId: String(result.lastInsertRowid), affectedRows: result.changes };
  });
  t.mock.method(db, 'transaction', async (run: (m: EntityManager) => Promise<unknown>) => {
    memory.exec('BEGIN');
    try {
      const result = await run(db.manager);
      memory.exec('COMMIT');
      return result;
    } catch (e) {
      memory.exec('ROLLBACK');
      throw e;
    }
  });
  const c = new TodosController();
  const base = {
    title: '每月检查',
    note: '保留原文',
    starts_at: '2020-01-01 00:00',
    ends_at: '2020-01-31 23:59',
    progress: 100,
    recurrence: 'monthly',
  };
  const first = await c.create(base, req);
  const once = await c.create({ ...base, title: '一次性', recurrence: 'once' }, req);
  const pending = await c.create({ ...base, title: '未完成月度', progress: 0 }, req);
  const future = await c.create(
    { ...base, title: '未来月度', starts_at: '2099-01-01 00:00', ends_at: '2099-01-31 23:59' },
    req,
  );
  await rollMonthlyTodos('2020-01-31 23:59:59');
  assert.equal(memory.prepare('SELECT COUNT(*) n FROM todo_history').get()?.n, 0);
  await rollMonthlyTodos('2020-02-01 00:00:00');
  await rollMonthlyTodos('2020-02-01 00:00:00');
  const get = (id: string) => memory.prepare('SELECT * FROM todo_items WHERE id=?').get(id)!;
  assert.equal(get(first.id).progress, 0);
  assert.equal(get(first.id).ends_at, '2020-02-29 23:59');
  assert.equal(get(first.id).version, 2);
  assert.equal(get(pending.id).progress, 0);
  assert.equal(get(future.id).progress, 100);
  assert.equal(get(once.id).version, 1);
  const historical = memory
    .prepare('SELECT snapshot_json FROM todo_history WHERE todo_id=?')
    .get(first.id)!;
  assert.equal(JSON.parse(String(historical.snapshot_json)).progress, 100);
  assert.equal(JSON.parse(String(historical.snapshot_json)).note, '保留原文');
  assert.equal(memory.prepare('SELECT COUNT(*) n FROM todo_history').get()?.n, 2);
  await rollMonthlyTodos('2020-05-01 00:00:00');
  assert.equal(get(first.id).ends_at, '2020-05-31 23:59');
  assert.equal(memory.prepare('SELECT COUNT(*) n FROM todo_history').get()?.n, 4);
  memory.prepare('UPDATE todo_items SET deleted_at=? WHERE id=?').run('2020-05-02', pending.id);
  await rollMonthlyTodos('2020-06-01 00:00:00');
  assert.equal(get(pending.id).cycle_month, '2020-05');
  const one = await c.create(
    {
      title: '一次性完成',
      note: '重开备注',
      starts_at: '2026-01-01 08:00',
      ends_at: '2026-01-03 09:30',
      progress: 100,
      recurrence: 'once',
    },
    req,
  );
  const before = now().slice(0, 16);
  const restarted = await c.restart(one.id, { version: 1 }, req);
  assert.equal(restarted.progress, 0);
  assert.equal(restarted.starts_at, before);
  assert.equal(
    restarted.ends_at,
    restartTimes('2026-01-01 08:00', '2026-01-03 09:30', before).ends_at,
  );
  await assert.rejects(c.restart(one.id, { version: 1 }, req), /已更新/);
  await assert.rejects(c.restart(one.id, { version: 2 }, req), /只有已完成/);
  await assert.rejects(
    c.restart(one.id, { version: 2 }, { user: { role: 'employee' } } as AuthRequest),
  );
  const history = await c.history(one.id, {});
  assert.equal(history.total, 1);
  assert.equal((history.items[0].snapshot as { progress: number }).progress, 100);
  const activeMonth = now().slice(0, 7),
    activeTimes = monthlyTimes('2000-01-31 23:59', activeMonth);
  const active = await c.create({ ...base, ...activeTimes, progress: 0 }, req);
  const completed = await c.edit(active.id, { ...base, ...activeTimes, version: 1 }, req);
  assert.equal(completed.progress, 100);
  await rollMonthlyTodos(now());
  assert.equal(get(active.id).progress, 100);
  const manualMonthly = await c.restart(active.id, { version: 2 }, req);
  assert.equal(manualMonthly.progress, 0);
  assert.equal(manualMonthly.cycle_month, manualMonthly.ends_at.slice(0, 7));
  await rollMonthlyTodos(now());
  assert.equal(get(active.id).version, 3);
  const reminders = await c.reminders();
  assert.ok(reminders.overdue_count >= 1);
});
