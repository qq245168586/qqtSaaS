import assert from 'node:assert/strict';
import test from 'node:test';
import type { Resource } from '../src/contracts.ts';
import { resolveDeliveryProduct } from '../src/delivery-product-selection.ts';

const products: Resource[] = [
  {
    id: '435',
    name: '宽意面',
    spec: '1.3*5mm',
    unit: 'g',
    default_price: '0.00',
  },
  { id: '80', name: '宽意面', spec: '', unit: '斤', default_price: '15.00' },
];

test('同名商品按用户点击的商品ID带出对应规格、单位和单价', () => {
  const selected = resolveDeliveryProduct(products, '宽意面', '80');
  assert.equal(selected.product?.id, '80');
  assert.equal(selected.value, '宽意面');
  assert.deepEqual(selected.patch, {
    productName: '宽意面',
    specification: '',
    unit: '斤',
    unitPrice: '15.00',
  });
});

test('直接输入名称继续使用最新匹配，未匹配名称保持人工输入', () => {
  assert.equal(resolveDeliveryProduct(products, '宽意面').product?.id, '435');
  assert.deepEqual(resolveDeliveryProduct(products, '新品').patch, {
    productName: '新品',
    specification: '',
    unit: '个',
    unitPrice: '0',
  });
});
