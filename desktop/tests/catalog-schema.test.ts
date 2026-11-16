import test from 'node:test';
import assert from 'node:assert/strict';
import { pageSchema, resourceSchema } from '../src/contracts';
test('catalog page accepts legacy customer code null alongside string and absent codes', () => {
  const items = pageSchema(resourceSchema).parse({
    items: [
      { id: '1', name: '御牛纪一店', code: null },
      { id: '2', name: '御牛纪二店', code: 'YNJ2' },
      { id: '3', name: '御牛纪三店' },
    ],
    total: 3,
    page: 1,
    page_size: 100,
  }).items;
  assert.equal(items.length, 3);
  assert.equal(items[0].code, null);
  assert.equal(items[1].code, 'YNJ2');
  assert.equal(items[2].code, undefined);
  assert.throws(() => resourceSchema.parse({ id: '4', name: '错误编码', code: 42 }));
});
