import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DELIVERY_LIST_ORDER } from '../src/delivery';
import { rankPersonnelHabits } from '../src/delivery-personnel';

test('送货单列表以新建时间优先，不能被未来送货日期插到前面', () => {
  assert.equal(DELIVERY_LIST_ORDER, 'created_at DESC,id DESC,delivery_date DESC');
});

test('署名习惯按角色独立计算，客户和商品历史权重大于普通使用次数', () => {
  const ranked = rankPersonnelHabits([
    {
      field_name: 'warehouse_name',
      name: '常用仓管',
      usage_count: 9,
      customer_matches: 0,
      product_matches: 0,
      last_used_at: '2026-09-20 10:00:00',
    },
    {
      field_name: 'warehouse_name',
      name: '该客户仓管',
      usage_count: 2,
      customer_matches: 2,
      product_matches: 1,
      last_used_at: '2026-09-19 10:00:00',
    },
    {
      field_name: 'maker_name',
      name: '制单员',
      usage_count: 3,
      customer_matches: 0,
      product_matches: 0,
      last_used_at: '2026-09-18 10:00:00',
    },
  ]);
  assert.equal(ranked.defaults.warehouse_name, '该客户仓管');
  assert.equal(ranked.defaults.maker_name, '制单员');
  assert.deepEqual(
    ranked.options.warehouse_name.map((item) => item.name),
    ['该客户仓管', '常用仓管'],
  );
  assert.equal(ranked.defaults.sales_name, null);
});
