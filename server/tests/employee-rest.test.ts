import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Row } from '../src/db';
import { restBalances, type RestEmployee } from '../src/employee-rest';
import { scheduleBalances } from '../src/employee-schedules';
import { DatabaseSync } from 'node:sqlite';
import type { QueryRunner } from 'typeorm';
import { EmployeeRest1791295000000 } from '../src/migrations/employee-rest';

const employees: RestEmployee[] = [{ id: '1', rest_start_month: '2026-10', left_on: null }];
const rest = (date: string, extra: Row = {}): Row => ({
  employee_id: '1',
  work_date: date,
  shift_kind: 'rest',
  overtime_minutes: 0,
  timeoff_minutes: 0,
  ...extra,
});

test('迁移为现有员工初始化当月，重复执行和跨月执行不重置累计起始月', async (t) => {
  const memory = new DatabaseSync(':memory:');
  t.after(() => memory.close());
  memory.exec("CREATE TABLE employees(id TEXT PRIMARY KEY); INSERT INTO employees VALUES('1');");
  t.mock.method(Date, 'now', () => Date.parse('2026-10-06T10:00:00Z'));
  const runner = {
    hasColumn: async (_table: string, column: string) =>
      memory
        .prepare('PRAGMA table_info(employees)')
        .all()
        .some((r) => r.name === column),
    query: async (sql: string, params: string[] = []) => memory.prepare(sql).run(...params),
  } as unknown as QueryRunner;
  const migration = new EmployeeRest1791295000000();
  await migration.up(runner);
  assert.equal(
    memory.prepare('SELECT rest_start_month FROM employees').get()?.rest_start_month,
    '2026-10',
  );
  t.mock.method(Date, 'now', () => Date.parse('2026-11-01T10:00:00Z'));
  await migration.up(runner);
  assert.equal(
    memory.prepare('SELECT rest_start_month FROM employees').get()?.rest_start_month,
    '2026-10',
  );
});

test('每月四天：未休四天、休一天剩三天，与加班调休小时独立', () => {
  assert.equal(restBalances(employees, [], '2026-10', '2026-10-06')[0].unused_days, 4);
  const rows = [
    rest('2026-10-06'),
    rest('2026-10-05', { shift_kind: 'comp_leave', timeoff_minutes: 60 }),
  ];
  const result = restBalances(employees, rows, '2026-10', '2026-10-06')[0];
  assert.equal(result.taken_days, 1);
  assert.equal(result.current_unused_days, 3);
  assert.equal(result.unused_days, 3);
  assert.equal(scheduleBalances(['1'], rows, '2026-10', '2026-10-06')[0].balance_minutes, -60);
});
test('月末未休跨月累计，重复查询不会重复发放，跨年也保留', () => {
  const rows = [rest('2026-10-02'), rest('2026-10-03'), rest('2026-10-04')];
  assert.equal(restBalances(employees, rows, '2026-10', '2026-10-31')[0].unused_days, 1);
  for (let i = 0; i < 2; i++) {
    const november = restBalances(employees, rows, '2026-11', '2026-11-01')[0];
    assert.equal(november.opening_days, 1);
    assert.equal(november.quota_days, 4);
    assert.equal(november.unused_days, 5);
  }
  assert.equal(restBalances(employees, [], '2027-01', '2027-01-01')[0].opening_days, 12);
});
test('本月休满后补休使用旧结余，超出全部额度不变负数或自动扣工资', () => {
  const rows = Array.from({ length: 5 }, (_, i) => rest(`2026-11-0${i + 1}`));
  const result = restBalances(employees, rows, '2026-11', '2026-11-05')[0];
  assert.equal(result.opening_days, 4);
  assert.equal(result.current_unused_days, 0);
  assert.equal(result.carry_remaining_days, 3);
  assert.equal(result.unused_days, 3);
  const excess = restBalances(
    employees,
    rows.map((r) => ({ ...r, work_date: String(r.work_date).replace('11', '10') })),
    '2026-10',
    '2026-10-31',
  )[0];
  assert.equal(excess.unused_days, 0);
  assert.equal(excess.excess_rest_days, 1);
});
test('未来休息到当天才扣，软删除、重复日期、工作和有加班的休息不算已休', () => {
  const rows = [
    rest('2026-10-05'),
    rest('2026-10-05'),
    rest('2026-10-07'),
    rest('2026-10-04', { deleted_at: '2026-10-04' }),
    rest('2026-10-03', { shift_kind: 'work' }),
    rest('2026-10-02', { overtime_minutes: 480 }),
  ];
  const current = restBalances(employees, rows, '2026-10', '2026-10-06')[0];
  assert.equal(current.taken_days, 1);
  assert.equal(current.unused_days, 3);
  assert.equal(current.planned_rest_days, 1);
  assert.equal(current.planned_unused_days, 2);
  assert.equal(restBalances(employees, rows, '2026-10', '2026-10-07')[0].unused_days, 2);
});
test('未来月份不提前发放四天、起始月之前不虚构余额、历史月份不混入以后休息', () => {
  const future = restBalances(employees, [rest('2026-11-02')], '2026-11', '2026-10-06')[0];
  assert.equal(future.opening_days, 4);
  assert.equal(future.quota_days, 0);
  assert.equal(future.planned_rest_days, 1);
  assert.equal(future.planned_unused_days, 3);
  assert.equal(restBalances(employees, [], '2026-09', '2026-10-06')[0].unused_days, 0);
  assert.equal(
    restBalances(employees, [rest('2026-11-02')], '2026-10', '2026-11-30')[0].unused_days,
    4,
  );
});
test('离职后不产生新月份额度，离职前已休有效，新增员工从自己的起始月累计', () => {
  const left = [{ ...employees[0], left_on: '2026-11-01' }];
  const result = restBalances(
    left,
    [rest('2026-11-02'), rest('2026-10-31')],
    '2026-12',
    '2026-12-31',
  )[0];
  assert.equal(result.opening_days, 3);
  assert.equal(result.quota_days, 0);
  assert.equal(result.unused_days, 3);
  const joined = [{ ...employees[0], rest_start_month: '2026-11' }];
  assert.equal(restBalances(joined, [], '2026-10', '2026-10-31')[0].unused_days, 0);
  assert.equal(restBalances(joined, [], '2026-11', '2026-11-01')[0].unused_days, 4);
});
