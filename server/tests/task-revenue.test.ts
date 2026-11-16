import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { EntityManager } from 'typeorm';
import { db } from '../src/db';
import type { User } from '../src/auth';
import { taskRevenue, revenueQuery } from '../src/task-revenue';
import { taskSchema } from '../src/validation';

test('零售金额验证保持分精度，允许未定价，拒绝负数、多余小数和超限金额', () => {
  const task = { title: '蛋糕订单', department_id: '1', assignee_employee_id: '1' };
  assert.equal(taskSchema.parse(task).entry_progress, 'not_entered');
  assert.equal(taskSchema.parse({ ...task, entry_progress: 'entered' }).entry_progress, 'entered');
  assert.throws(() => taskSchema.parse({ ...task, entry_progress: 'half' }));
  assert.equal(taskSchema.parse({ ...task, order_amount: '0' }).order_amount, '0.00');
  assert.equal(taskSchema.parse({ ...task, order_amount: '12.3' }).order_amount, '12.30');
  assert.equal(taskSchema.parse(task).delivery_fee, '0.00');
  assert.equal(taskSchema.parse({ ...task, delivery_fee: '8.5' }).delivery_fee, '8.50');
  assert.equal(taskSchema.parse(task).order_taker_employee_id, null);
  assert.equal(
    taskSchema.parse({ ...task, order_taker_employee_id: '9' }).order_taker_employee_id,
    '9',
  );
  assert.equal(taskSchema.parse(task).order_amount, undefined);
  assert.equal(taskSchema.parse({ ...task, order_amount: null }).order_amount, null);
  for (const order_amount of ['-1', '0.001', '10000000000', 'NaN', ''])
    assert.throws(() => taskSchema.parse({ ...task, order_amount }));
  for (const delivery_fee of ['-1', '0.001', '10000000000', 'NaN', ''])
    assert.throws(() => taskSchema.parse({ ...task, delivery_fee }));
  assert.throws(() => revenueQuery.parse({ start_date: '2026-10-01', end_date: '2026-09-30' }));
  assert.throws(() => revenueQuery.parse({ customers: 'not-json' }));
});

test('收入按日期客户渠道来源组合筛选；关联送货单、取消、草稿和删除不计入；分页不截断总额', async (t) => {
  const memory = new DatabaseSync(':memory:');
  t.after(() => memory.close());
  memory.exec(`CREATE TABLE tasks(id TEXT,company_id TEXT,assignee_employee_id TEXT,title TEXT,customer_name TEXT,order_channel TEXT,order_amount NUMERIC,expected_delivery_at TEXT,created_at TEXT,status TEXT,deleted_at TEXT);
    CREATE TABLE delivery_notes(id TEXT,company_id TEXT,note_number TEXT,customer_name_snapshot TEXT,total_amount NUMERIC,delivery_date TEXT,is_draft INT,source_task_id TEXT,deleted_at TEXT);
    INSERT INTO tasks VALUES
      ('1','1','8','蛋糕','客户甲','微信',100.10,'2026-09-30 09:00','2026-08-01','todo',NULL),
      ('2','2','9','布丁','客户乙','小红书',20.20,'2026-09-01 09:00','2026-09-01','todo',NULL),
      ('3','1','8','未定价','客户甲','微信',NULL,'2026-09-02 09:00','2026-09-01','todo',NULL),
      ('4','1','8','取消单','客户甲','微信',900,'2026-09-01 09:00','2026-09-01','canceled',NULL),
      ('5','1','8','零元','客户甲','微信',0,'2026-09-01 09:00','2026-09-01','todo',NULL),
      ('6','1','8','历史无日期','客户丙',NULL,30,NULL,'2026-09-20 10:00','todo',NULL),
      ('7','1','8','去年订单','客户甲','微信',50,'2025-09-01 09:00','2025-09-01','todo',NULL),
      ('8','1','8','已删订单','客户甲','微信',700,'2026-09-01 09:00','2026-09-01','todo','2026-09-02');
    INSERT INTO delivery_notes VALUES
      ('1','1','D1','客户甲',40.40,'2026-09-30',0,NULL,NULL),
      ('2','2','D2','客户乙',900,'2026-09-30',0,'1',NULL),
      ('3','1','D3','客户甲',800,'2026-09-30',1,NULL,NULL),
      ('4','1','D4','客户甲',700,'2026-09-30',0,NULL,'2026-09-30'),
      ('5','1','D5','客户甲',600,'2026-10-01',0,NULL,NULL);`);
  t.mock.method(db.manager, 'query', async (sql: string, params: SQLInputValue[] = []) =>
    memory.prepare(sql).all(...params),
  );
  t.mock.method(db, 'transaction', async (run: (manager: EntityManager) => Promise<unknown>) =>
    run(db.manager),
  );
  const user = { id: '1', company_id: '1', role: 'boss', public_access: true } as User;
  const month = { start_date: '2026-09-01', end_date: '2026-09-30', page_size: 2 };
  const result = await taskRevenue(user, month);
  const totals = result.totals as Record<string, unknown>;
  assert.equal(Number(totals.total_amount).toFixed(2), '190.70');
  assert.equal(Number(totals.retail_amount).toFixed(2), '150.30');
  assert.equal(Number(totals.supply_amount).toFixed(2), '40.40');
  assert.equal(totals.missing_amount_count, 1);
  assert.equal(result.total, 6);
  assert.equal((result.items as unknown[]).length, 2);
  const filtered = await taskRevenue(user, {
    ...month,
    customers: JSON.stringify(['客户甲', '客户乙']),
    channels: JSON.stringify(['微信']),
    source: 'retail',
  });
  assert.equal(
    Number((filtered.totals as Record<string, unknown>).total_amount).toFixed(2),
    '100.10',
  );
  assert.equal(filtered.total, 3);
  const supply = await taskRevenue(user, { ...month, source: 'supply' });
  assert.equal(supply.total, 1);
  assert.deepEqual(supply.by_channel, []);
  const unsetChannel = await taskRevenue(user, { ...month, channels: JSON.stringify(['']) });
  assert.equal(unsetChannel.total, 1);
  assert.equal(
    Number((unsetChannel.totals as Record<string, unknown>).total_amount).toFixed(2),
    '30.00',
  );
  const all = await taskRevenue(user, {});
  assert.equal(Number((all.totals as Record<string, unknown>).total_amount).toFixed(2), '840.70');
  const year = await taskRevenue(user, { start_date: '2026-01-01', end_date: '2026-12-31' });
  assert.equal(Number((year.totals as Record<string, unknown>).total_amount).toFixed(2), '790.70');
  const employee = await taskRevenue({ ...user, role: 'employee', employee_id: '9' }, month);
  assert.equal(employee.total, 1);
  const privateUser = await taskRevenue({ ...user, public_access: false }, month);
  assert.equal(
    Number((privateUser.totals as Record<string, unknown>).total_amount).toFixed(2),
    '170.50',
  );
  const empty = await taskRevenue(user, { ...month, customers: JSON.stringify(['不存在客户']) });
  assert.equal(empty.total, 0);
  assert.equal((empty.totals as Record<string, unknown>).total_amount, 0);
});
