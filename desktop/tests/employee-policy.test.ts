import assert from 'node:assert/strict';
import { test } from 'node:test';
import { employeeAvailableOn, matchingBusinessEmployees } from '../src/assignment';
import { displayMinutes } from '../src/schedules-model';
import { parseNavigationPreference, pageModules } from '../src/navigation-preference';
test('离职前历史可选，离职当天停用，员工页偏好迁移至员工模块', () => {
  const employee = {
    id: '1',
    name: '甲',
    department_id: '1',
    status: 'left',
    left_on: '2026-10-01',
  };
  assert.equal(employeeAvailableOn(employee, '2026-09-30'), true);
  assert.equal(employeeAvailableOn(employee, '2026-10-01'), false);
  assert.equal(
    matchingBusinessEmployees([{ id: '1', name: '蛋糕部' }], [employee], '1', '2026-09-30').length,
    1,
  );
  assert.equal(
    matchingBusinessEmployees([{ id: '1', name: '蛋糕部' }], [employee], '1', '2026-10-01').length,
    0,
  );
  const p = parseNavigationPreference(
    JSON.stringify({ counts: { settings: 2 }, lastPages: { settings: 'employees' } }),
  );
  assert.equal(p.lastPages.staff, 'employees');
  assert.equal(pageModules.schedules, 'staff');
  assert.equal(displayMinutes(-119), '−1小时59分');
});
