import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedApiPath } from '../electron/api-path.ts';

test('Electron安全白名单允许健康检查和全部BOM接口', () => {
  for (const path of [
    '/health',
    '/todos',
    '/todos/reminders',
    '/todos/12',
    '/cost/materials',
    '/cost/materials/import/file',
    '/cost/materials/import/confirm',
    '/cost/sops/parse',
    '/cost/sops',
    '/tasks/1/order-taker',
    '/ai/retail-details/1',
    '/bom/parse',
    '/boms',
    '/boms?page=1&page_size=200',
    '/boms/12',
    '/boms/12/export/kingdee',
    '/kingdee-products',
    '/kingdee-products/import',
    '/kingdee-products/import/preview',
  ])
    assert.equal(isAllowedApiPath(path), true, path);
});

test('Electron安全白名单继续拒绝越权路径与路径穿越', () => {
  for (const path of ['/admin', '/boms/../users', '/boms\\12', '/health-check'])
    assert.equal(isAllowedApiPath(path), false, path);
});

test('排班和离职接口通过安全白名单，路径穿越仍被拒绝', () => {
  assert.equal(isAllowedApiPath('/employee-schedules?month=2026-10'), true);
  assert.equal(isAllowedApiPath('/employee-schedules/1/2026-10-05'), true);
  assert.equal(isAllowedApiPath('/employees/1/departure'), true);
  assert.equal(isAllowedApiPath('/employee-schedules/../users'), false);
});

test('Confluence页面与版本接口通过安全白名单', () => {
  assert.equal(isAllowedApiPath('/wiki/pages'), true);
  assert.equal(isAllowedApiPath('/wiki/pages?keyword=SOP'), true);
  assert.equal(isAllowedApiPath('/wiki/pages/1/versions/2/restore'), true);
  assert.equal(isAllowedApiPath('/wiki/../users'), false);
});
