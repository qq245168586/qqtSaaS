import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateRecipeCost,
  convertCostQuantity,
  normalizeCostUnit,
  unitCost,
} from '../src/costing-core';

test('成本单位标准化并进行质量、容量换算', () => {
  assert.equal(normalizeCostUnit('kg'), '千克');
  assert.equal(convertCostQuantity('1.25', '千克', '克').toString(), '1250');
  assert.equal(convertCostQuantity('2', 'L', '毫升').toString(), '2000');
  assert.throws(() => convertCostQuantity('1', '克', '毫升'), /不能把/);
});

test('每克成本保留八位小数且不使用浮点数', () => {
  assert.equal(unitCost('18.50', '125', '克', '克'), '0.14800000');
  assert.equal(unitCost('1', '3000', '克', '克'), '0.00033333');
});

test('SOP计算本批和单个成本并保留价格精度', () => {
  const result = calculateRecipeCost(
    [
      {
        material_id: 'egg',
        material_name: '鸡蛋',
        quantity: '500',
        unit: '克',
        base_unit: '克',
        unit_cost_yuan_per_base: '0.01234567',
      },
      {
        material_id: 'cream',
        material_name: '淡奶油',
        quantity: '0.5',
        unit: '升',
        base_unit: '毫升',
        unit_cost_yuan_per_base: '0.04280000',
      },
    ],
    '10',
  );
  assert.equal(result.lines[0].line_cost_yuan, '6.17283500');
  assert.equal(result.lines[1].line_cost_yuan, '21.40000000');
  assert.equal(result.batch_cost_yuan, '27.57283500');
  assert.equal(result.unit_cost_yuan, '2.75728350');
});
