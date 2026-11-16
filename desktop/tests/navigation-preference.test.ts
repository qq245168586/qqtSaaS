import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyNavigationPreference,
  parseNavigationPreference,
  preferredModule,
  preferredPage,
  recordPageVisit,
  navigationSessionKey,
} from '../src/navigation-preference.ts';
import { sessionSchema } from '../src/contracts.ts';

test('同一用户令牌续期不重置导航；身份或服务器改变才重新初始化', () => {
  const session = sessionSchema.parse({
    access_token: 'old',
    user: {
      id: '1',
      company_id: '2',
      company_code: 'tmy',
      username: 'test',
      real_name: '测试',
      role: 'boss',
      must_change_password: false,
      public_access: true,
    },
  });
  const key = navigationSessionKey('https://example.test/api', session);
  assert.equal(
    navigationSessionKey('https://example.test/api', { ...session, access_token: 'renewed' }),
    key,
  );
  assert.notEqual(navigationSessionKey('https://other.test/api', session), key);
  assert.notEqual(
    navigationSessionKey('https://example.test/api', {
      ...session,
      user: { ...session.user, id: '3' },
    }),
    key,
  );
  assert.notEqual(
    navigationSessionKey('https://example.test/api', {
      ...session,
      user: { ...session.user, role: 'employee' },
    }),
    key,
  );
});

test('常用大模块按本机用户的访问次数选择，并记住模块内最后页面', () => {
  let preference = emptyNavigationPreference();
  preference = recordPageVisit(preference, 'delivery');
  preference = recordPageVisit(preference, 'summary');
  preference = recordPageVisit(preference, 'tasks');
  assert.equal(preferredModule(preference, ['orders', 'delivery', 'bom', 'settings']), 'delivery');
  assert.equal(preferredPage(preference, 'delivery', ['delivery', 'summary']), 'summary');
});

test('没有权限的常用模块会回退到可用模块，损坏偏好不会影响启动', () => {
  const preference = parseNavigationPreference(
    JSON.stringify({
      counts: { bom: 20, orders: 2, delivery: -1 },
      lastModule: 'bom',
      lastPages: { bom: 'templates', orders: 'tasks' },
    }),
  );
  assert.equal(preferredModule(preference, ['orders']), 'orders');
  assert.equal(preferredPage(preference, 'orders', ['overview', 'tasks']), 'tasks');
  assert.deepEqual(parseNavigationPreference('{bad json'), emptyNavigationPreference());
});

test('新用户默认总览，AI设置与旧概览记忆迁到正确模块', () => {
  assert.equal(
    preferredModule(emptyNavigationPreference(), ['home', 'orders', 'delivery', 'bom', 'settings']),
    'home',
  );
  const oldSettings = parseNavigationPreference(
    JSON.stringify({ counts: { orders: 4 }, lastPages: { orders: 'ai-settings' } }),
  );
  assert.equal(oldSettings.lastPages.orders, undefined);
  assert.equal(preferredPage(oldSettings, 'settings', ['ai-settings', 'employees']), 'ai-settings');
  const oldOverview = parseNavigationPreference(
    JSON.stringify({ lastPages: { orders: 'overview' } }),
  );
  assert.equal(preferredPage(oldOverview, 'home', ['overview']), 'overview');
  assert.equal(preferredPage(oldOverview, 'orders', ['tasks']), 'tasks');
  assert.equal(recordPageVisit(emptyNavigationPreference(), 'ai-settings').lastModule, 'settings');
});

test('旧AI订单页面偏好迁为任务汇总，不出现空白页面', () => {
  const saved = parseNavigationPreference(JSON.stringify({ lastPages: { orders: 'ai' } }));
  assert.equal(preferredPage(saved, 'orders', ['tasks', 'categories']), 'tasks');
});
