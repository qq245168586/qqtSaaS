import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTask, nextStates, taskSchema, sessionSchema } from '../src/contracts.ts';
import { createPrintTemplate, validatePrintTemplate } from '../electron/print-template-model.ts';
test('状态不能跳过已发货或重新打开已取消任务', () => {
  assert.deepEqual(nextStates('waiting_ship'), ['waiting_ship', 'shipped', 'canceled']);
  assert.deepEqual(nextStates('shipped'), ['shipped', 'delivered', 'canceled']);
  assert.deepEqual(nextStates('canceled'), ['canceled']);
  assert.deepEqual(nextStates('delivered'), ['delivered', 'canceled']);
});
test('API ID 保持字符串且拒绝无效状态', () => {
  const input = {
    id: '9007199254740993',
    title: '测试订单',
    status: 'todo',
    priority: 'normal',
    task_type: 'order',
  };
  assert.equal(taskSchema.parse(input).id, input.id);
  assert.equal(taskSchema.parse(input).entry_progress, 'not_entered');
  assert.throws(() => taskSchema.parse({ ...input, id: 9007199254740993 }));
  assert.throws(() => taskSchema.parse({ ...input, status: 'unknown' }));
});
test('零售订单兼容旧数据并解析商品、地址、配送费和接单人', () => {
  const legacy = taskSchema.parse({
    id: '1',
    title: '旧订单',
    status: 'todo',
    priority: 'normal',
    task_type: 'order',
  });
  assert.equal(legacy.delivery_fee, '0.00');
  assert.equal(legacy.product_summary, undefined);
  assert.equal(legacy.order_taker_employee_id, undefined);

  const current = taskSchema.parse({
    ...legacy,
    product_summary: '蓝莓乳酪',
    delivery_address: '深圳市南山区测试路1号',
    order_amount: '188.00',
    delivery_fee: '12.00',
    order_taker_employee_id: '8',
    order_taker_name: '肖燕',
  });
  assert.equal(current.product_summary, '蓝莓乳酪');
  assert.equal(current.delivery_address, '深圳市南山区测试路1号');
  assert.equal(current.order_amount, '188.00');
  assert.equal(current.delivery_fee, '12.00');
  assert.equal(current.order_taker_name, '肖燕');

  const draft = emptyTask();
  assert.equal(draft.delivery_fee, '0.00');
  assert.equal(draft.order_taker_employee_id, null);
});
test('会话必须包含公司与角色，不泄漏刷新令牌', () => {
  const result = sessionSchema.parse({
    access_token: 'access',
    refresh_token: 'secret',
    user: {
      id: '1',
      company_id: '1',
      company_code: 'tri',
      username: 'test',
      real_name: '测试',
      role: 'boss',
      must_change_password: 1,
    },
  });
  assert.equal(result.user.must_change_password, true);
  assert.equal('refresh_token' in result, false);
});
test('移植打印模板仍保留尺寸、十九元素和严格边界校验', () => {
  const t = createPrintTemplate('template-test');
  assert.equal(Object.keys(t.elements).length, 19);
  assert.equal(validatePrintTemplate(t).paper.width, 241);
  assert.throws(() => validatePrintTemplate({ ...t, paper: { width: Infinity, height: 140 } }));
  const bad = structuredClone(t);
  bad.elements.title.x = 500;
  assert.throws(() => validatePrintTemplate(bad));
});
