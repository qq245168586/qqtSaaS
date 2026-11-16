import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  createPublicSession,
  publicIdentity,
  enforcePublicAccess,
  enforceWikiAccess,
  publicAccessEnabled,
} from '../src/public-access';
import type { User } from '../src/auth';
const admin: User = {
  id: '1',
  company_id: '2',
  company_code: 'tmy',
  username: 'admin',
  real_name: '管理员',
  role: 'boss',
  employee_id: null,
  must_change_password: true,
};
test('公开进入只签2h标记access、不签refresh，保留公司并屏蔽改密要求', () => {
  const result = createPublicSession(admin, 's'.repeat(32), true);
  assert.deepEqual(Object.keys(result).sort(), ['access_token', 'user']);
  assert.equal(result.user.public_access, true);
  assert.equal(result.user.must_change_password, false);
  const claims = jwt.verify(result.access_token, 's'.repeat(32), {
    algorithms: ['HS256'],
    issuer: 'tmytri-api',
    audience: 'tmytri-client',
  });
  assert.notEqual(typeof claims, 'string');
  if (typeof claims === 'string') throw new Error('JWT类型错误');
  assert.equal(claims.public_access, true);
  assert.equal(claims.company_id, '2');
  assert.equal((claims.exp ?? 0) - (claims.iat ?? 0), 7200);
});
test('Confluence免密公开会话只能访问知识库接口', () => {
  const result = createPublicSession(admin, 's'.repeat(32), true, 'wiki');
  const claims = jwt.verify(result.access_token, 's'.repeat(32), {
    algorithms: ['HS256'],
    issuer: 'tmytri-api',
    audience: 'tmytri-client',
  });
  assert.notEqual(typeof claims, 'string');
  if (typeof claims === 'string') throw new Error('JWT类型错误');
  assert.equal(claims.wiki_access, true);
  assert.doesNotThrow(() => enforceWikiAccess(claims.wiki_access, '/api/wiki/pages'));
  assert.doesNotThrow(() => enforceWikiAccess(claims.wiki_access, '/api/wiki/images/1'));
  assert.throws(() => enforceWikiAccess(claims.wiki_access, '/api/tasks'));
  assert.throws(() => enforceWikiAccess(claims.wiki_access, '/api/backup'));
});
test('关闭开关使公开身份失效，普通密码身份保留；员工不可作为公开管理员', () => {
  assert.throws(() => publicIdentity(admin, true, false));
  assert.throws(() => createPublicSession(admin, 's'.repeat(32), false));
  assert.throws(() => publicIdentity({ ...admin, role: 'employee' }, true, true));
  assert.equal(publicIdentity(admin, undefined, false), admin);
  assert.throws(() => publicIdentity(admin, 'true', true));
  const before = process.env.PUBLIC_ACCESS;
  try {
    process.env.PUBLIC_ACCESS = 'true';
    assert.equal(publicAccessEnabled(), true);
    process.env.PUBLIC_ACCESS = 'false';
    assert.equal(publicAccessEnabled(), false);
  } finally {
    if (before === undefined) delete process.env.PUBLIC_ACCESS;
    else process.env.PUBLIC_ACCESS = before;
  }
});
test('公开身份禁止账户/改密/所有备份，含大小写尾斜杠；可操作任务送货', () => {
  const publicUser = publicIdentity(admin, true, true);
  for (const path of [
    '/api/users',
    '/api/users/1',
    '/API/USERS/1/',
    '/api/auth/change-password/',
    '/api/backup/restore',
    '/api/backup/export',
    '/api/backup',
  ])
    assert.throws(() => enforcePublicAccess(publicUser, path));
  for (const path of ['/api/tasks', '/api/delivery-notes', '/api/auth/me'])
    assert.doesNotThrow(() => enforcePublicAccess(publicUser, path));
  assert.doesNotThrow(() => enforcePublicAccess(admin, '/api/users'));
});
