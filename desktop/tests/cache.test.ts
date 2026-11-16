import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheRead, cacheWrite, clearCache, setCacheScope, cacheable } from '../src/cache.ts';
test('缓存按公司和用户隔离，退出清除且七天后过期', async () => {
  setCacheScope('1', '10');
  await cacheWrite('/tasks?page=1', { items: ['first'] });
  setCacheScope('2', '10');
  assert.equal(await cacheRead('/tasks?page=1'), undefined);
  setCacheScope('1', '11');
  assert.equal(await cacheRead('/tasks?page=1'), undefined);
  setCacheScope('1', '10');
  assert.deepEqual(await cacheRead('/tasks?page=1'), { items: ['first'] });
  const original = Date.now;
  Date.now = () => original() + 8 * 24 * 60 * 60 * 1000;
  try {
    assert.equal(await cacheRead('/tasks?page=1'), undefined);
  } finally {
    Date.now = original;
  }
  await clearCache();
  setCacheScope('1', '10');
  assert.equal(await cacheRead('/tasks?page=1'), undefined);
});
test('凭据、下载与图片签名地址不缓存', () => {
  assert.equal(cacheable('/auth/me'), false);
  assert.equal(cacheable('/tasks/1/images'), false);
  assert.equal(cacheable('/tasks/export'), false);
  assert.equal(cacheable('/tasks?month=2026-09'), true);
});
test('同一用户降权后不能读取老板缓存，退出清理该用户所有角色缓存', async () => {
  setCacheScope('3', '20', 'boss');
  await cacheWrite('/tasks', { secret: 'company-wide' });
  setCacheScope('3', '20', 'employee');
  assert.equal(await cacheRead('/tasks'), undefined);
  await cacheWrite('/tasks', { own: true });
  await clearCache();
  setCacheScope('3', '20', 'boss');
  assert.equal(await cacheRead('/tasks'), undefined);
});
