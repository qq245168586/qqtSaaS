import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { EntityManager } from 'typeorm';
import type { AuthRequest, User } from '../src/auth';
import { db, Row } from '../src/db';
import {
  EmployeeSchedulesController,
  EmployeeDepartureController,
  scheduleBalances,
  scheduleSchema,
} from '../src/employee-schedules';
import {
  businessDate,
  businessToday,
  employeeAvailable,
  standardEnd,
} from '../src/employee-policy';
import { employeeNameAvailable } from '../src/delivery-personnel';
import { TaskController } from '../src/tasks';
import { CatalogController } from '../src/catalog';

test('真实日期、上海日界线、任意分钟班次和离职日期资格', (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-01T16:01:00Z'));
  assert.equal(businessToday(), '2026-10-02');
  assert.equal(businessDate.parse('2028-02-29'), '2028-02-29');
  for (const date of ['2026-02-29', '2026-13-01', '2026-10-32', '2026-1-1'])
    assert.throws(() => businessDate.parse(date));
  assert.deepEqual(standardEnd('08:00'), { time: '17:00', next_day: false });
  assert.deepEqual(standardEnd('09:00'), { time: '18:00', next_day: false });
  assert.deepEqual(standardEnd('23:30'), { time: '08:30', next_day: true });
  const left = { name: '员工甲', status: 'left', left_on: '2026-10-01' };
  assert.equal(employeeAvailable(left, '2026-09-30'), true);
  assert.equal(employeeAvailable(left, '2026-10-01'), false);
  assert.equal(employeeNameAvailable('员工甲', [left], '2026-10-02'), false);
  assert.equal(employeeNameAvailable('自定义署名', [left], '2026-10-02'), true);
  assert.equal(
    employeeNameAvailable('员工甲', [left, { name: '员工甲', status: 'active' }], '2026-10-02'),
    true,
  );
  assert.throws(() =>
    scheduleSchema.parse({ shift_kind: 'work', start_time: '24:00', version: 0 }),
  );
  assert.throws(() =>
    scheduleSchema.parse({ shift_kind: 'rest', timeoff_minutes: 480, version: 0 }),
  );
  assert.throws(() =>
    scheduleSchema.parse({ shift_kind: 'comp_leave', timeoff_minutes: 0, version: 0 }),
  );
  assert.throws(() =>
    scheduleSchema.parse({
      shift_kind: 'work',
      start_time: '08:00',
      overtime_minutes: 1.5,
      version: 0,
    }),
  );
});
test('正负余额按分钟跨月，未来不入账，软删不入账，空白日期不自动扣减', () => {
  const rows: Row[] = [
    { employee_id: '1', work_date: '2026-09-30', overtime_minutes: 181, timeoff_minutes: 0 },
    { employee_id: '1', work_date: '2026-10-01', overtime_minutes: 0, timeoff_minutes: 300 },
    { employee_id: '1', work_date: '2026-10-20', overtime_minutes: 480, timeoff_minutes: 0 },
    {
      employee_id: '1',
      work_date: '2026-10-02',
      overtime_minutes: 999,
      timeoff_minutes: 0,
      deleted_at: '2026-10-02',
    },
    { employee_id: '1', work_date: '2026-11-02', overtime_minutes: 480, timeoff_minutes: 0 },
  ];
  assert.deepEqual(scheduleBalances(['1', '2'], rows, '2026-10', '2026-10-05'), [
    {
      employee_id: '1',
      opening_minutes: 181,
      overtime_minutes: 0,
      timeoff_minutes: 300,
      balance_minutes: -119,
      planned_net_minutes: 480,
    },
    {
      employee_id: '2',
      opening_minutes: 0,
      overtime_minutes: 0,
      timeoff_minutes: 0,
      balance_minutes: 0,
      planned_net_minutes: 0,
    },
  ]);
  assert.equal(scheduleBalances(['1'], rows, '2026-11', '2026-11-02')[0].balance_minutes, 841);
  assert.equal(scheduleBalances(['1'], rows, '2026-09', '2026-10-05')[0].balance_minutes, 181);
});
test('真实控制器：事务保存、并发版本、清除恢复、历史可新增修改清除、离职和目录历史保护', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-05T04:00:00Z'));
  const memory = new DatabaseSync(':memory:');
  t.after(() => memory.close());
  memory.exec(`CREATE TABLE employees(id TEXT PRIMARY KEY,name TEXT,department_id TEXT,phone TEXT,status TEXT,left_on TEXT,deleted_at TEXT,company_id TEXT,updated_by TEXT,updated_at TEXT,rest_start_month TEXT);
    CREATE TABLE departments(id TEXT PRIMARY KEY,name TEXT,deleted_at TEXT);
    CREATE TABLE employee_schedules(id INTEGER PRIMARY KEY AUTOINCREMENT,employee_id TEXT,work_date TEXT,shift_kind TEXT,start_time TEXT,overtime_minutes INTEGER,timeoff_minutes INTEGER,note TEXT,version INTEGER,created_by TEXT,updated_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT,deleted_at TEXT, UNIQUE(employee_id,work_date));
    CREATE TABLE employee_schedule_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,schedule_id TEXT,employee_id TEXT,work_date TEXT,action TEXT,before_json TEXT,after_json TEXT,actor_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE tasks(id TEXT,assignee_employee_id TEXT,department_id TEXT,status TEXT,deleted_at TEXT);
    INSERT INTO employees VALUES('1','员工甲','1','','active',NULL,NULL,NULL,NULL,NULL,'2026-10'),('2','员工乙','1','','active',NULL,NULL,NULL,NULL,NULL,'2026-10');
    INSERT INTO departments VALUES('1','蛋糕部',NULL);`);
  t.mock.method(
    db.manager,
    'query',
    async (sql: string, params: SQLInputValue[] = []): Promise<unknown> => {
      const query = sql.replace(/ FOR UPDATE/g, '');
      const statement = memory.prepare(query);
      if (/^SELECT/i.test(query))
        return statement
          .all(...params)
          .map((row) => ({ ...row, ...('id' in row ? { id: String(row.id) } : {}) }));
      const result = statement.run(...params);
      return { insertId: String(result.lastInsertRowid) };
    },
  );
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
  const req = { user: { id: '1', role: 'boss', public_access: true } as User } as AuthRequest;
  const controller = new EmployeeSchedulesController();
  const body = {
    shift_kind: 'work',
    start_time: '23:30',
    overtime_minutes: 61,
    timeoff_minutes: 0,
    note: '夜班',
    version: 0,
  };
  const saved = await controller.save(req, '1', '2026-10-05', body);
  assert.equal(saved.version, 1);
  assert.equal(saved.standard_end, '08:30');
  await assert.rejects(controller.save(req, '1', '2026-10-05', body), /刷新/);
  await controller.save(req, '1', '2026-10-05', { ...body, version: 1, timeoff_minutes: 121 });
  assert.equal((await controller.list(req, { month: '2026-10' })).today, '2026-10-05');
  const october = await controller.list(req, { month: '2026-10' });
  assert.equal(october.days, 31);
  assert.equal((october.balances as Row[])[0].balance_minutes, -60);
  assert.equal((october.rest_balances as Row[])[0].unused_days, 4);
  assert.equal((await controller.list(req, { month: '2028-02' })).days, 29);
  await assert.rejects(controller.save(req, '1', '2026-02-29', body));
  await assert.rejects(controller.clear(req, '1', '2026-02-29', { version: 1 }));
  const historical = await controller.save(req, '1', '2026-09-30', body);
  assert.equal(historical.version, 1);
  let snapshot = await controller.list(req, { month: '2026-10' });
  assert.equal((snapshot.balances as Row[])[0].opening_minutes, 61);
  assert.equal((snapshot.balances as Row[])[0].balance_minutes, 1);
  await assert.rejects(controller.save(req, '1', '2026-09-30', body), /刷新/);
  await controller.save(req, '1', '2026-09-30', { ...body, version: 1, overtime_minutes: 120 });
  snapshot = await controller.list(req, { month: '2026-10' });
  assert.equal((snapshot.balances as Row[])[0].opening_minutes, 120);
  assert.equal((snapshot.balances as Row[])[0].balance_minutes, 60);
  await assert.rejects(controller.clear(req, '1', '2026-09-30', { version: 1 }), /刷新/);
  await controller.clear(req, '1', '2026-09-30', { version: 2 });
  assert.equal(
    ((await controller.list(req, { month: '2026-10' })).balances as Row[])[0].balance_minutes,
    -60,
  );
  // 历史例休也重新计入当月未休天数，清除后恢复。
  await controller.save(req, '1', '2026-10-04', { shift_kind: 'rest', version: 0 });
  assert.equal(
    ((await controller.list(req, { month: '2026-10' })).rest_balances as Row[])[0].unused_days,
    3,
  );
  await controller.clear(req, '1', '2026-10-04', { version: 1 });
  assert.equal(
    ((await controller.list(req, { month: '2026-10' })).rest_balances as Row[])[0].unused_days,
    4,
  );
  await controller.clear(req, '1', '2026-10-05', { version: 2 });
  await assert.rejects(controller.save(req, '1', '2026-10-05', body), /刷新/);
  await controller.save(req, '1', '2026-10-05', { ...body, version: 3 });
  assert.equal(
    memory.prepare('SELECT COUNT(*) total FROM employee_schedule_audit').get()?.total,
    9,
  );
  assert.equal((await controller.list(req, { month: '2026-10' })).items instanceof Array, true);
  const departure = new EmployeeDepartureController();
  await departure.depart(req, '1', { left_on: '2026-10-06' });
  await controller.save(req, '1', '2026-10-05', { ...body, version: 4 });
  await assert.rejects(controller.save(req, '1', '2026-10-06', body), /离职/);
  await assert.rejects(
    new TaskController().create(
      { ...req, user: { ...req.user, company_id: '2', public_access: false } } as AuthRequest,
      {
        title: '订单',
        department_id: '1',
        assignee_employee_id: '1',
        expected_delivery_at: '2026-10-06 09:00',
      },
    ),
    /离职/,
  );
  await assert.rejects(departure.depart(req, '1', { left_on: '2026-10-07' }), /覆盖/);
  await assert.rejects(
    new CatalogController().remove({ ...req, path: '/api/employees/1' } as AuthRequest, '1'),
    /排班历史/,
  );
  assert.equal(
    memory.prepare('SELECT COUNT(*) total FROM employee_schedule_audit').get()?.total,
    10,
  );
});
