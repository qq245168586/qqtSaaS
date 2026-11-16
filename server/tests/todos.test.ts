import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EntityManager } from 'typeorm';
import type { AuthRequest } from '../src/auth';
import { db } from '../src/db';
import { TodosController } from '../src/todos';
import { todoCreate, todoOverdue } from '../src/todos-core';
const input = {
  title: '确认采购',
  note: '',
  starts_at: '2026-11-13 08:00',
  ends_at: '2026-11-13 17:00',
  progress: 0,
  recurrence: 'once',
};
test('待办校验时间、标题和两种完成状态；到截止分钟即逾期，完成不提醒', () => {
  assert.equal(todoCreate.parse(input).title, '确认采购');
  for (const value of [
    { ...input, title: ' ' },
    { ...input, ends_at: '2026-11-12 17:00' },
    { ...input, starts_at: '2026-02-30 08:00' },
    { ...input, progress: 101 },
    { ...input, progress: 25 },
    { ...input, progress: -1 },
    { ...input, progress: 0.5 },
  ])
    assert.equal(todoCreate.safeParse(value).success, false);
  assert.equal(todoOverdue(0, input.ends_at, '2026-11-13 16:59'), false);
  assert.equal(todoOverdue(99, input.ends_at, '2026-11-13 17:00'), true);
  assert.equal(todoOverdue(100, input.ends_at, '2026-11-14 17:00'), false);
});
test('待办可创建；修改和删除保护并发版本，普通员工不得写入', async (t) => {
  const c = new TodosController(),
    req = { user: { id: '1', role: 'boss' } } as AuthRequest;
  const writes: string[] = [];
  t.mock.method(db, 'transaction', async (run: (m: EntityManager) => Promise<unknown>) =>
    run(db.manager),
  );
  t.mock.method(db.manager, 'query', async (sql: string) => {
    if (sql.startsWith('SELECT')) return [{ id: '1', ...input, version: 2 }];
    writes.push(sql);
    return { insertId: '1', affectedRows: 1 };
  });
  assert.equal((await c.create(input, req)).id, '1');
  assert.equal((await c.edit('1', { ...input, progress: 100, version: 2 }, req)).overdue, false);
  await assert.rejects(c.edit('1', { ...input, version: 1 }, req), /其他人修改/);
  await assert.rejects(c.remove('1', { version: 1 }, req), /其他人修改/);
  await assert.rejects(c.create(input, { user: { role: 'employee' } } as AuthRequest));
  assert.equal(writes.length, 2);
  await c.remove('1', { version: 2 }, req);
  assert.match(writes[2], /SET deleted_at=/);
});
