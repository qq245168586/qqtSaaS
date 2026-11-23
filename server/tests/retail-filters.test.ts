import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { retailFilterPredicate } from '../src/retail-filters';
import { taskList } from '../src/tasks';
import { db } from '../src/db';
import type { User } from '../src/auth';

test('列过滤：包含、排除、与、空值、金额边界和非法条件', () => {
  const memory = new DatabaseSync(':memory:');
  try {
    memory.exec(`CREATE TABLE tasks(id TEXT,order_taker_employee_id TEXT,assignee_employee_id TEXT,entry_progress TEXT,order_amount NUMERIC);
      INSERT INTO tasks VALUES ('1','11','21','entered',100),('2','12','21','not_entered',200),('3',NULL,NULL,NULL,NULL),('4','11','22','',0);`);
    const find = (rules: unknown) => {
      const predicate = retailFilterPredicate(JSON.stringify(rules));
      return memory
        .prepare(`SELECT id FROM tasks t WHERE ${predicate.sql} ORDER BY id`)
        .all(...(predicate.params as SQLInputValue[]))
        .map((r) => r.id);
    };
    const taker = { field: 'order_taker_employee_id', operator: 'include', values: ['11'] };
    assert.deepEqual(find([taker]), ['1', '4']);
    assert.deepEqual(find([{ ...taker, operator: 'exclude' }]), ['2', '3']);
    assert.deepEqual(find([{ ...taker, values: ['unset'] }]), ['3']);
    assert.deepEqual(find([{ ...taker, values: ['11', 'unset'] }]), ['1', '3', '4']);
    assert.deepEqual(find([taker, { ...taker, operator: 'exclude' }]), []);
    assert.deepEqual(
      find([taker, { field: 'assignee_employee_id', operator: 'include', values: ['21'] }]),
      ['1'],
    );
    assert.deepEqual(
      find([{ field: 'entry_progress', operator: 'include', values: ['not_entered'] }]),
      ['2', '3', '4'],
    );
    assert.deepEqual(
      find([{ field: 'order_amount', operator: 'include', min: '0', max: '100.00' }]),
      ['1', '4'],
    );
    assert.deepEqual(
      find([{ field: 'order_amount', operator: 'exclude', min: '0', max: '100.00' }]),
      ['2', '3'],
    );
    for (const rules of [
      [{ ...taker, field: 'id OR 1=1' }],
      [{ ...taker, values: ["1' OR 1=1"] }],
      [{ ...taker, operator: 'or' }],
      [{ field: 'order_amount', operator: 'include' }],
      [{ field: 'order_amount', operator: 'include', min: '20', max: '10' }],
      [{ field: 'order_amount', operator: 'include', min: '1.001' }],
      Array(13).fill(taker),
    ])
      assert.throws(() => retailFilterPredicate(JSON.stringify(rules)));
    assert.throws(() => retailFilterPredicate('{bad'));
  } finally {
    memory.close();
  }
});

test('同一过滤应用到分页、订单数和总金额；仍保留权限、月份和删除限制', async (t) => {
  const memory = new DatabaseSync(':memory:');
  t.after(() => memory.close());
  memory.exec(`CREATE TABLE companies(id TEXT,code TEXT,name TEXT);
    CREATE TABLE departments(id TEXT,name TEXT);
    CREATE TABLE employees(id TEXT,name TEXT);
    CREATE TABLE categories(id TEXT,name TEXT);
    CREATE TABLE delivery_notes(id TEXT,company_id TEXT,source_task_id TEXT,note_number TEXT,delivery_date TEXT,is_draft INT,deleted_at TEXT);
    CREATE TABLE tasks(id TEXT,company_id TEXT,title TEXT,department_id TEXT,category_id TEXT,assignee_employee_id TEXT,order_taker_employee_id TEXT,entry_progress TEXT,order_amount NUMERIC,status TEXT,expected_delivery_at TEXT,created_at TEXT,deleted_at TEXT);
    INSERT INTO companies VALUES('1','tmy','天美意'),('2','tri','趣趣特');`);
  const insert = memory.prepare(
    `INSERT INTO tasks VALUES(?,?,'测试订单',NULL,NULL,?,?,?,10,?,?,?,?)`,
  );
  for (let i = 1; i <= 25; i++)
    insert.run(
      String(i),
      '1',
      '21',
      '11',
      'not_entered',
      'delivered',
      '2026-11-19 09:00',
      '2026-11-19 08:00',
      null,
    );
  insert.run(
    '26',
    '1',
    '21',
    '11',
    'not_entered',
    'canceled',
    '2026-11-19 09:00',
    '2026-11-19 08:00',
    null,
  );
  insert.run(
    '27',
    '2',
    '22',
    '11',
    'not_entered',
    'todo',
    '2026-11-19 09:00',
    '2026-11-19 08:00',
    null,
  );
  insert.run(
    '28',
    '1',
    '21',
    '11',
    'not_entered',
    'todo',
    '2026-11-19 09:00',
    '2026-11-19 08:00',
    '2026-11-19',
  );
  insert.run(
    '29',
    '1',
    '21',
    '11',
    'not_entered',
    'todo',
    '2026-10-19 09:00',
    '2026-10-19 08:00',
    null,
  );
  t.mock.method(db.manager, 'query', async (sql: string, params: SQLInputValue[] = []) =>
    memory.prepare(sql).all(...params),
  );
  const user = { id: '1', company_id: '1', role: 'boss', public_access: true } as User;
  const query = {
    month: '2026-11',
    page: 1,
    page_size: 20,
    column_filters: JSON.stringify([
      { field: 'entry_progress', operator: 'include', values: ['not_entered'] },
      { field: 'order_taker_employee_id', operator: 'include', values: ['11'] },
    ]),
  };
  const first = await taskList(user, query);
  assert.equal(first.total, 27);
  assert.equal(Number(first.total_amount), 260);
  assert.equal((first.items as unknown[]).length, 20);
  const second = await taskList(user, { ...query, page: 2 });
  assert.equal((second.items as unknown[]).length, 7);
  assert.equal(second.total_amount, first.total_amount);
  const privateResult = await taskList({ ...user, public_access: false }, query);
  assert.equal(privateResult.total, 26);
  assert.equal(Number(privateResult.total_amount), 250);
  const employeeResult = await taskList({ ...user, role: 'employee', employee_id: '22' }, query);
  assert.equal(employeeResult.total, 1);
});
