import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionSchema, deliverySchema, taskSchema } from '../src/contracts.ts';
import { printModel } from '../src/delivery-model.ts';
test('公开会话标记与跨公司记录归属保留', () => {
  const session = sessionSchema.parse({
    access_token: 'public',
    user: {
      id: '0',
      company_id: '2',
      company_code: 'tmy',
      username: 'public',
      real_name: '共享',
      role: 'boss',
      must_change_password: false,
      public_access: true,
    },
  });
  assert.equal(session.user.public_access, true);
  const task = taskSchema.parse({
    id: '1',
    company_code: 'tri',
    company_name: '趣趣特',
    title: '订单',
    status: 'todo',
    priority: 'normal',
    task_type: 'order',
  });
  assert.equal(task.company_code, 'tri');
});
test('打印抬头使用每张单据所属公司，不能取公开会话默认公司', () => {
  const base = {
    id: '1',
    delivery_date: '2026-09-22',
    customer_name_snapshot: '测试',
    is_draft: false,
    items: [{ product_name: '蛋糕', unit: '个', quantity: '1', unit_price: '12.00' }],
  };
  const tri = deliverySchema.parse({ ...base, company_code: 'tri' });
  const tmy = deliverySchema.parse({ ...base, id: '2', company_code: 'tmy' });
  assert.equal(printModel(tri, 'tmy').companyId, 'tri');
  assert.equal(printModel(tmy, 'tri').companyId, 'tmy');
});
