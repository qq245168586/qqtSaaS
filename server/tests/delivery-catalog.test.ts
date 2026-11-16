import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EntityManager } from 'typeorm';
import { rememberDeliveryCatalog } from '../src/delivery-catalog';
import { db } from '../src/db';
import { deliverySchema, amounts } from '../src/validation';
import type { User } from '../src/auth';

const target: User = {
  id: '8',
  company_id: '2',
  company_code: 'tmy',
  username: 'admin',
  real_name: '管理员',
  role: 'boss',
  employee_id: null,
  must_change_password: false,
};
const input = deliverySchema.parse({
  delivery_date: '2026-09-22',
  customer_name_snapshot: '新客户',
  customer_address_snapshot: '送货地址',
  customer_phone_snapshot: '123456',
  items: [
    { product_name: '蛋糕', spec: '6寸', unit: '盒', quantity: '1', unit_price: '50.00' },
    { product_name: '蛋糕', spec: '8寸', unit: '个', quantity: '1', unit_price: '80.00' },
  ],
});
test('正式单积累客户和分规格产品，以目标公司及本次单位价格为准；恢复软删除资料', async (t) => {
  const transaction = new EntityManager(db);
  const calls: { sql: string; params: unknown[] }[] = [];
  t.mock.method(transaction, 'query', async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return sql.startsWith('SELECT') ? [{ id: '77' }] : {};
  });
  assert.equal(await rememberDeliveryCatalog(input, target, transaction), '77');
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0].params, ['2', '新客户', '送货地址', '123456', '8', '8']);
  assert.deepEqual(calls[1].params, ['2', '新客户']);
  assert.match(calls[1].sql, /company_id=\? AND name=\?/);
  assert.deepEqual(
    calls.slice(2).map((call) => call.params.slice(0, 5)),
    [
      ['2', '蛋糕', '6寸', '盒', '50.00'],
      ['2', '蛋糕', '8寸', '个', '80.00'],
    ],
  );
  for (const call of [calls[0], ...calls.slice(2)]) {
    assert.match(call.sql, /ON DUPLICATE KEY UPDATE/);
    assert.match(call.sql, /active=1,deleted_at=NULL/);
  }
  assert.match(calls[0].sql, /address=IF\(VALUES\(address\)='',address,VALUES\(address\)\)/);
  assert.match(calls[0].sql, /phone=IF\(VALUES\(phone\)='',phone,VALUES\(phone\)\)/);
  assert.match(calls[2].sql, /unit=VALUES\(unit\),default_price=VALUES\(default_price\)/);
});
test('显式选择客户保留关联、不改其资料；草稿不积累资料', async (t) => {
  const transaction = new EntityManager(db);
  const calls: string[] = [];
  t.mock.method(transaction, 'query', async (sql: string) => {
    calls.push(sql);
    return {};
  });
  assert.equal(
    await rememberDeliveryCatalog({ ...input, customer_id: '55' }, target, transaction),
    '55',
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every((sql) => sql.startsWith('INSERT INTO products')));
  calls.length = 0;
  assert.equal(await rememberDeliveryCatalog({ ...input, is_draft: 1 }, target, transaction), null);
  assert.equal(calls.length, 0);
});
test('资料写入错误向外传播，由同一送货事务整体回滚', async (t) => {
  const transaction = new EntityManager(db);
  t.mock.method(transaction, 'query', async () => {
    throw new Error('catalog write failed');
  });
  await assert.rejects(rememberDeliveryCatalog(input, target, transaction), /catalog write failed/);
});
test('金额按每行ROUND_HALF_UP、再合计，零金额与半分边界保持十进制精度', () => {
  assert.deepEqual(
    amounts([
      { quantity: '0.01', unit_price: '0.50' },
      { quantity: '0.01', unit_price: '0.50' },
      { quantity: '1', unit_price: '0' },
    ]),
    { lines: ['0.01', '0.01', '0.00'], total: '0.02' },
  );
  assert.deepEqual(amounts([{ quantity: '0.03', unit_price: '0.50' }]), {
    lines: ['0.02'],
    total: '0.02',
  });
});
