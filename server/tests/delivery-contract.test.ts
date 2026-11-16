import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EntityManager } from 'typeorm';
import { DeliveryController } from '../src/delivery';
import { db, type Row } from '../src/db';
import type { AuthRequest, User } from '../src/auth';
import { deliverySchema } from '../src/validation';

const user: User = {
  id: '1',
  company_id: '2',
  company_code: 'tmy',
  username: 'admin',
  real_name: '管理员',
  role: 'boss',
  employee_id: null,
  must_change_password: false,
};
const input = {
  delivery_date: '2026-09-22',
  customer_name_snapshot: '测试客户',
  is_draft: false,
  items: [
    { product_name: '面包', spec: '', unit: '个', quantity: '2', unit_price: '3.50', remark: '' },
  ],
};

test('送货单写入契约仅接受可编辑字段，关联来源和数据库明细ID不能由客户端改写', () => {
  assert.equal(deliverySchema.safeParse(input).success, true);
  for (const source_task_id of [null, '9'])
    assert.equal(deliverySchema.safeParse({ ...input, source_task_id }).success, false);
  for (const field of ['product_id', 'id'])
    assert.equal(
      deliverySchema.safeParse({ ...input, items: [{ ...input.items[0], [field]: '9' }] }).success,
      false,
    );
});

test('新建和编辑可保存；任务草稿转正式保留服务端来源并继续幂等', async (t) => {
  const notes = new Map<string, Row>();
  const lines = new Map<string, Row[]>();
  const catalogWrites: { sql: string; params: unknown[] }[] = [];
  let nextId = 10;
  let sequence = '0';
  t.mock.method(db, 'transaction', async (run: (manager: EntityManager) => Promise<unknown>) =>
    run(db.manager),
  );
  t.mock.method(
    db.manager,
    'query',
    async (sql: string, params: unknown[] = []): Promise<unknown> => {
      if (sql.includes('FROM employees')) return [];
      if (sql.startsWith('INSERT INTO customers') || sql.startsWith('INSERT INTO products')) {
        catalogWrites.push({ sql, params });
        return {};
      }
      if (sql.startsWith('SELECT id FROM customers')) return [{ id: '90' }];
      if (sql.startsWith('SELECT') && sql.includes(' FROM tasks '))
        return [
          {
            id: '9',
            company_id: '2',
            company_code: 'tmy',
            status: 'waiting_ship',
            expected_delivery_at: '2026-09-22 15:00',
          },
        ];
      if (sql.startsWith('SELECT') && sql.includes(' FROM delivery_notes ')) {
        if (sql.includes('source_task_id=?'))
          return [...notes.values()].filter((note) => note.source_task_id === params.at(-1));
        const note = notes.get(String(params[0]));
        return note ? [{ ...note, company_code: 'tmy' }] : [];
      }
      if (sql.startsWith('SELECT') && sql.includes(' FROM delivery_note_items '))
        return lines.get(String(params[0])) ?? [];
      if (sql.startsWith('SELECT') && sql.includes(' FROM app_meta '))
        return [{ id: '1', meta_value: sequence }];
      if (sql.startsWith('INSERT IGNORE INTO app_meta')) return {};
      if (sql.startsWith('INSERT INTO `')) {
        const table = sql.match(/^INSERT INTO `([^`]+)`/)?.[1];
        const keys = [...sql.slice(sql.indexOf('('), sql.indexOf(')')).matchAll(/`([^`]+)`/g)].map(
          (m) => m[1],
        );
        const id = String(nextId++);
        const row = { id, ...Object.fromEntries(keys.map((key, index) => [key, params[index]])) };
        if (table === 'delivery_notes') notes.set(id, row);
        else if (table === 'delivery_note_items') {
          const target = String(row.delivery_note_id);
          lines.set(target, [...(lines.get(target) ?? []), row]);
        } else throw new Error(`Unexpected insert: ${table}`);
        return { insertId: id };
      }
      if (sql.startsWith('UPDATE `')) {
        const table = sql.match(/^UPDATE `([^`]+)`/)?.[1];
        const keys = [
          ...sql.slice(sql.indexOf(' SET '), sql.indexOf(' WHERE ')).matchAll(/`([^`]+)`=/g),
        ].map((m) => m[1]);
        const values = Object.fromEntries(keys.map((key, index) => [key, params[index]]));
        if (table === 'app_meta') sequence = String(values.meta_value);
        else if (table === 'delivery_notes') {
          const id = String(params.at(-2));
          notes.set(id, { ...notes.get(id), ...values });
        } else throw new Error(`Unexpected update: ${table}`);
        return {};
      }
      if (sql.startsWith('DELETE FROM delivery_note_items')) {
        lines.delete(String(params[0]));
        return {};
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  );
  const controller = new DeliveryController();
  const req = { user: { ...user } } as AuthRequest;
  const created = await controller.create(req, input);
  assert.equal(created.total_amount, '7.00');
  assert.equal(created.customer_id, '90');
  assert.equal(catalogWrites.length, 2);
  assert.equal(catalogWrites[0].params[0], '2');
  const edited = await controller.edit(req, String(created.id), {
    ...input,
    customer_name_snapshot: '修改客户',
  });
  assert.equal(edited.customer_name_snapshot, '修改客户');
  assert.equal(edited.note_number, created.note_number);
  const draft = await controller.from(req, '9');
  assert.equal(draft.source_task_id, '9');
  assert.equal(draft.is_draft, 1);
  const finalized = await controller.edit(req, String(draft.id), input);
  assert.equal(finalized.source_task_id, '9');
  assert.equal(finalized.is_draft, 0);
  assert.match(String(finalized.note_number), /^TMY260922\d+$/);
  assert.equal((await controller.from(req, '9')).id, draft.id);
  assert.equal(notes.size, 2);
  const rounded = await controller.create(req, {
    ...input,
    items: Array.from({ length: 2 }, () => ({
      ...input.items[0],
      quantity: '0.01',
      unit_price: '0.50',
    })),
  });
  assert.equal(rounded.total_amount, '0.02');
  assert.deepEqual(
    (rounded.items as Row[]).map((line) => line.amount),
    ['0.01', '0.01'],
  );
});
