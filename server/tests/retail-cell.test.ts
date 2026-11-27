import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { retailCellSchema, cellPatch } from '../src/retail-cell';
import { TaskController, taskView } from '../src/tasks';
import { db, type Row } from '../src/db';
import type { AuthRequest } from '../src/auth';

test('单格编辑校验金额、日期、字段白名单和并发冲突，不覆盖其他字段', () => {
  assert.deepEqual(
    cellPatch(
      { field: 'order_amount', value: '120', previous: '100' },
      { order_amount: '100.00', title: '别人的新标题' },
    ),
    { order_amount: '120.00' },
  );
  assert.deepEqual(
    cellPatch({ field: 'note', value: '新备注', previous: '' }, { remark: '', note: '' }),
    { remark: '新备注' },
  );
  assert.throws(
    () =>
      cellPatch({ field: 'title', value: '覆盖', previous: '旧标题' }, { title: '别人的新标题' }),
    ConflictException,
  );
  for (const value of ['-1', '1.001', 'not money', '10000000000'])
    assert.throws(() =>
      cellPatch({ field: 'order_amount', value, previous: '0' }, { order_amount: '0' }),
    );
  assert.throws(() =>
    cellPatch(
      { field: 'expected_delivery_at', value: '2026-02-30 09:00', previous: null },
      { expected_delivery_at: null },
    ),
  );
  assert.throws(() =>
    cellPatch({ field: 'title', value: ' ', previous: '原名' }, { title: '原名' }),
  );
  for (const field of ['company_id', 'status', 'deleted_at', 'id'])
    assert.throws(() => retailCellSchema.parse({ field, value: '2', previous: '1' }));
  assert.throws(() =>
    retailCellSchema.parse({ field: 'title', value: '新名', previous: '原名', company_id: '2' }),
  );
  assert.equal(taskView({ detail: '送达地址：原地址', delivery_address: '' }).delivery_address, '');
  assert.equal(
    taskView({ detail: '送达地址：原地址', delivery_address: null }).delivery_address,
    '原地址',
  );
});

test('单格接口保持权限、记录范围、离职日期，并在换负责人时同步部门', async (t) => {
  const controller = new TaskController();
  const req = {
    user: { id: '1', company_id: '1', role: 'boss', public_access: false },
  } as AuthRequest;
  const record: Row = {
    id: '1',
    company_id: '1',
    title: '原订单',
    detail: '原详情',
    remark: '',
    order_amount: '100.00',
    department_id: '1',
    assignee_employee_id: '10',
    order_taker_employee_id: null,
    expected_delivery_at: '2026-11-27 09:00',
    created_at: '2026-11-01 09:00',
  };
  const writes: { sql: string; params: unknown[] }[] = [];
  t.mock.method(db, 'transaction', async (callback: (m: EntityManager) => Promise<unknown>) =>
    callback(db.manager),
  );
  t.mock.method(db.manager, 'query', async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith('SELECT') && sql.includes('FROM tasks WHERE')) {
      assert.match(sql, /deleted_at IS NULL/);
      assert(sql.includes('company_id=?'));
      return params[0] === '1' && params[1] === '1' ? [{ ...record }] : [];
    }
    if (sql.includes('FROM employees'))
      return [
        {
          id: params[0],
          department_id: '2',
          status: 'active',
          left_on: params[0] === '30' ? '2026-11-27' : null,
        },
      ];
    if (sql.includes('FROM departments')) return [{ id: '2' }];
    if (sql.startsWith('UPDATE')) {
      writes.push({ sql, params });
      return {};
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.mock.method(controller, 'get', async () => taskView(record));
  await controller.editCell(req, '1', { field: 'order_amount', value: '200', previous: '100' });
  assert.match(writes[0].sql, /`order_amount`=\?,`updated_by`=\? WHERE id=\? AND company_id=\?/);
  assert.deepEqual(writes[0].params, ['200.00', '1', '1', '1']);
  await assert.rejects(
    controller.editCell(req, '1', { field: 'order_amount', value: '200', previous: '90' }),
    ConflictException,
  );
  await controller.editCell(req, '1', {
    field: 'assignee_employee_id',
    value: '20',
    previous: '10',
  });
  assert.match(writes[1].sql, /`department_id`/);
  assert.deepEqual(writes[1].params, ['20', '2', '1', '1', '1']);
  await assert.rejects(
    controller.editCell(req, '1', { field: 'assignee_employee_id', value: '30', previous: '10' }),
    BadRequestException,
  );
  record.assignee_employee_id = '30';
  await assert.rejects(
    controller.editCell(req, '1', {
      field: 'expected_delivery_at',
      value: '2026-11-28 09:00',
      previous: '2026-11-27 09:00',
    }),
    BadRequestException,
  );
  await assert.rejects(
    controller.editCell({ ...req, user: { ...req.user, role: 'employee' } } as AuthRequest, '1', {
      field: 'title',
      value: '无权修改',
      previous: '原订单',
    }),
    ForbiddenException,
  );
  await assert.rejects(
    controller.editCell({ ...req, user: { ...req.user, company_id: '2' } } as AuthRequest, '1', {
      field: 'title',
      value: '跨公司',
      previous: '原订单',
    }),
    NotFoundException,
  );
  assert.equal(writes.length, 2, '失败不能写入任何业务字段');
});
