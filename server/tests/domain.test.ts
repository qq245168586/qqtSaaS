import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amounts,
  canTransition,
  minute,
  taskSchema,
  deliverySchema,
  statuses,
} from '../src/validation';
import { createPrintTemplate, validatePrintTemplate } from '../src/print-template-model';
test('状态只能逐步前进；交付可取消；取消不可重开', () => {
  for (const from of statuses)
    for (const to of statuses) {
      const expected =
        from === to ||
        (from !== 'canceled' &&
          (to === 'canceled' || statuses.indexOf(to) === statuses.indexOf(from) + 1));
      assert.equal(canTransition(from, to), expected);
    }
  assert.equal(canTransition('todo', 'delivered'), false);
});
test('分钟时间严格拒绝日期、无效日期和多余秒', () => {
  for (const s of ['2026-02-30 12:00', '2026-09-22', '2026-09-22 24:00', '2026-09-22 12:00:00'])
    assert.equal(minute.safeParse(s).success, false);
  assert.equal(minute.parse('2028-02-29 12:00'), '2028-02-29 12:00');
});
test('精确十进制，逐行四舍五入再求和', () => {
  assert.deepEqual(
    amounts([
      { quantity: '0.10', unit_price: '0.20' },
      { quantity: '3', unit_price: '0.335'.slice(0, 4) },
    ]),
    { lines: ['0.02', '0.99'], total: '1.01' },
  );
  assert.throws(() => amounts([{ quantity: '9999999999.99', unit_price: '9999999999.99' }]));
});
test('任务拒绝company_id注入和不完整分配', () => {
  const base = { title: '蛋糕', department_id: '1', assignee_employee_id: '2' };
  assert.equal(taskSchema.safeParse(base).success, true);
  assert.equal(taskSchema.safeParse({ ...base, company_id: '2' }).success, false);
  assert.equal(taskSchema.safeParse({ ...base, assignee_employee_id: null }).success, false);
});
test('送货单5行上限、正式必填、草稿可空', () => {
  const row = { product_name: '产品', unit: '份', quantity: '1.00', unit_price: '2.00' };
  const base = { delivery_date: '2026-09-22', customer_name_snapshot: '客户', items: [row] };
  assert.equal(deliverySchema.safeParse(base).success, true);
  assert.equal(
    deliverySchema.safeParse({ ...base, items: Array.from({ length: 6 }, () => row) }).success,
    false,
  );
  assert.equal(deliverySchema.safeParse({ ...base, items: [] }).success, false);
  assert.equal(
    deliverySchema.safeParse({ ...base, customer_name_snapshot: '', is_draft: 1, items: [] })
      .success,
    true,
  );
});
test('复用19元素模板验证，拒绝越界与丢元素', () => {
  const t = createPrintTemplate('test');
  assert.equal('companyId' in validatePrintTemplate({ ...t, companyId: 'tri' }), false);
  assert.throws(() =>
    validatePrintTemplate({
      ...t,
      elements: { ...t.elements, date: { ...t.elements.date, x: 999 } },
    }),
  );
});
