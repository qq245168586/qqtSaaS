import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyFilter, writeUser, preparePublicContext } from '../src/company-scope';
import type { User, AuthRequest } from '../src/auth';
const user: User = {
  id: '1',
  company_id: '2',
  company_code: 'tmy',
  username: 'admin',
  real_name: '管理员',
  role: 'boss',
  employee_id: null,
  must_change_password: false,
};
test('共享查询只由已验证public标记放开；普通公司仍绑定SQL参数', () => {
  assert.deepEqual(companyFilter(user, 't.company_id'), { sql: 't.company_id=?', params: ['2'] });
  assert.deepEqual(companyFilter({ ...user, public_access: true }, 't.company_id'), {
    sql: '1=1',
    params: [],
  });
});
test('编辑以锁定记录归属为准，只有显式目标覆盖归属', () => {
  const record = { company_id: '1', company_code: 'tri' };
  assert.equal(writeUser(user, record).company_id, '1');
  assert.equal(writeUser(user, record).company_code, 'tri');
  assert.equal(
    writeUser({ ...user, write_company_id: '2', write_company_code: 'tmy' }, record).company_id,
    '2',
  );
  assert.equal(writeUser(user).company_code, 'tmy');
});
test('普通身份不剥离company_code以保持严格DTO拒绝；public无效公司先拒绝', async () => {
  const normal = { user, body: { company_code: 'tri' } } as AuthRequest;
  await preparePublicContext(normal);
  assert.equal(normal.body.company_code, 'tri');
  const invalid = {
    user: { ...user, public_access: true },
    body: { company_code: 'unknown' },
  } as AuthRequest;
  await assert.rejects(preparePublicContext(invalid));
});
