import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EntityManager } from 'typeorm';
import type { AuthRequest } from '../src/auth';
import { db } from '../src/db';
import { TaskController } from '../src/tasks';

test('行内运费只更新运费；拒绝越权、非法金额和额外订单金额字段', async (t) => {
  const controller = new TaskController();
  const req = {
    user: { id: '1', company_id: '1', role: 'boss', public_access: true },
  } as AuthRequest;
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  t.mock.method(db, 'transaction', async (run: (m: EntityManager) => Promise<unknown>) =>
    run(db.manager),
  );
  t.mock.method(db.manager, 'query', async (sql: string, params: unknown[]) => {
    if (sql.startsWith('SELECT'))
      return [{ id: '7', company_id: '2', order_amount: '100.00', delivery_fee: '0.00' }];
    writes.push({ sql, params });
    return { affectedRows: 1 };
  });
  t.mock.method(controller, 'get', async () => ({ id: '7', order_amount: '100.00' }));
  await controller.deliveryFee(req, '7', { delivery_fee: '12.3' });
  assert.equal(writes.length, 1);
  assert.equal(
    writes[0].sql,
    'UPDATE `tasks` SET `delivery_fee`=?,`updated_by`=? WHERE id=? AND company_id=?',
  );
  assert.deepEqual(writes[0].params, ['12.30', '1', '7', '2']);
  await controller.deliveryFee(req, '7', { delivery_fee: '0' });
  assert.equal(writes[1].params[0], '0.00');
  for (const delivery_fee of ['-1', '0.001', 'NaN', '10000000000']) {
    await assert.rejects(controller.deliveryFee(req, '7', { delivery_fee }));
  }
  await assert.rejects(
    controller.deliveryFee(req, '7', { delivery_fee: '1', order_amount: '999' }),
  );
  await assert.rejects(
    controller.deliveryFee({ user: { ...req.user, role: 'employee' } } as AuthRequest, '7', {
      delivery_fee: '1',
    }),
  );
  assert.equal(writes.length, 2);
});
