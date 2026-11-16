import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { db, insert, update } from '../src/db';
import { rankChannels, orderChannels } from '../src/order-channels';
import { taskSchema } from '../src/validation';
import type { User } from '../src/auth';

test('无历史默认微信，四个预置渠道始终保留，次数优先且同次数最近使用优先', () => {
  assert.deepEqual(
    rankChannels([]).items.map((item) => item.name),
    ['微信', '小程序', '小红书', '大众点评'],
  );
  assert.equal(rankChannels([]).default_channel, '微信');
  const result = rankChannels([
    { name: ' 电话 ', usage_count: 4, last_used_at: '2026-09-29' },
    { name: '小红书', usage_count: 4, last_used_at: '2026-09-30' },
    { name: '微信', usage_count: 3, last_used_at: '2026-10-01' },
  ]);
  assert.equal(result.default_channel, '小红书');
  assert.equal(result.items[1].name, '电话');
});

test('渠道长度校验，兼容旧客户端不传字段，空白不能作为新渠道', () => {
  const input = { title: '订单', department_id: '1', assignee_employee_id: '1' };
  assert.equal(taskSchema.parse(input).order_channel, undefined);
  assert.equal(taskSchema.parse({ ...input, order_channel: ' 电话 ' }).order_channel, '电话');
  assert.throws(() => taskSchema.parse({ ...input, order_channel: ' ' }));
  assert.throws(() => taskSchema.parse({ ...input, order_channel: 'a'.repeat(51) }));
});

test('保存渠道进入频次，编辑同一任务只计一次，删除与空值不参与学习，普通用户遵守范围', async (t) => {
  const memory = new DatabaseSync(':memory:');
  t.after(() => memory.close());
  memory.exec(`CREATE TABLE tasks(id INTEGER PRIMARY KEY,company_id TEXT,assignee_employee_id TEXT,order_channel TEXT,updated_at TEXT DEFAULT '2026-09-30',deleted_at TEXT);
    INSERT INTO tasks VALUES(1,'1','9','微信','2026-09-29',NULL),(2,'2','8','小红书','2026-09-30',NULL),(3,'1','9',NULL,'2026-09-29',NULL);`);
  t.mock.method(db.manager, 'query', async (sql: string, params: SQLInputValue[] = []) => {
    const statement = memory.prepare(sql);
    if (sql.startsWith('SELECT')) return statement.all(...params);
    const result = statement.run(...params);
    return { insertId: String(result.lastInsertRowid) };
  });
  const user = { id: '1', company_id: '1', public_access: true, role: 'boss' } as User;
  const id = await insert('tasks', { company_id: '1', order_channel: '电话' });
  await update('tasks', id, '1', { order_channel: '电话' });
  assert.equal(
    (await orderChannels(user)).items.find((item) => item.name === '电话')?.usage_count,
    1,
  );
  await update('tasks', id, '1', { order_channel: '微信' });
  assert.equal((await orderChannels(user)).default_channel, '微信');
  assert.equal(
    (await orderChannels(user)).items.some((item) => item.name === '电话'),
    false,
  );
  await update('tasks', id, '1', { deleted_at: '2026-09-30' });
  assert.equal((await orderChannels(user)).default_channel, '小红书');
  assert.equal((await orderChannels({ ...user, public_access: false })).default_channel, '微信');
  assert.equal(
    (await orderChannels({ ...user, role: 'employee', employee_id: '9' })).default_channel,
    '微信',
  );
});
