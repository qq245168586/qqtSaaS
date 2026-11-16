import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explicitRetailDetails } from '../src/retail-details';
import { taskView } from '../src/tasks';
test('历史商品不夹带联系人，显式地址与自取独立恢复', () => {
  assert.deepEqual(
    explicitRetailDetails(
      '商品：6寸薄荷生巧奥利奥；收货人：测试；电话：123；备注：10人份刀叉 自取',
    ),
    { product_summary: '6寸薄荷生巧奥利奥', delivery_address: '自取' },
  );
  assert.equal(
    explicitRetailDetails('茶歇，地点：深圳湾科技生态园12栋B座B2出口').delivery_address,
    '深圳湾科技生态园12栋B座B2出口',
  );
  assert.equal(explicitRetailDetails('蓝莓乳酪').delivery_address, '');
  const result = taskView({
    detail: '送达地址：旧地址',
    delivery_address: '人工确认地址',
    order_amount: '248.00',
    delivery_fee: '0.00',
  });
  assert.equal(result.delivery_address, '人工确认地址');
  assert.equal(result.order_amount, '248.00');
});
