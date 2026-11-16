import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WindowsUpdateManager, type UpdateState } from '../electron/windows-updater';

test('Windows更新检查、进度、下载完成与安装状态完整', async () => {
  const states: UpdateState[] = [];
  let checks = 0;
  let installs = 0;
  const manager = new WindowsUpdateManager(
    true,
    '2.1.0',
    async () => {
      checks++;
    },
    () => {
      installs++;
    },
    (state) => states.push(state),
    () => '2026-09-24T01:00:00.000Z',
  );
  await manager.check();
  assert.equal(checks, 1);
  assert.equal(manager.getState().phase, 'checking');
  manager.available('2.1.1');
  manager.progress(45.26);
  assert.equal(manager.getState().percent, 45.3);
  await manager.check();
  assert.equal(checks, 1, '下载期间不重复检查');
  manager.downloaded('2.1.1');
  await manager.installNow();
  assert.equal(installs, 1);
  assert.equal(manager.getState().phase, 'installing');
  assert.ok(states.some((state) => state.phase === 'downloading'));
});

test('非Windows安装版不检查更新，安装前必须下载完成', async () => {
  let checks = 0;
  const unsupported = new WindowsUpdateManager(
    false,
    '2.1.0',
    async () => {
      checks++;
    },
    () => undefined,
    () => undefined,
  );
  await unsupported.check();
  assert.equal(checks, 0);
  assert.equal(unsupported.getState().phase, 'unsupported');
  await assert.rejects(unsupported.installNow(), /尚未下载/);
});

test('无新版与网络错误都可再次检查', async () => {
  let fail = true;
  let checks = 0;
  const manager = new WindowsUpdateManager(
    true,
    '2.1.0',
    async () => {
      checks++;
      if (fail) throw new Error('network\nfailed');
    },
    () => undefined,
    () => undefined,
  );
  await manager.check();
  assert.equal(manager.getState().phase, 'error');
  assert.doesNotMatch(manager.getState().message, /\n/);
  fail = false;
  await manager.check();
  manager.unavailable();
  assert.equal(manager.getState().phase, 'up-to-date');
  await manager.check();
  assert.equal(checks, 3);
});

test('异步安装失败显示错误状态，可重新检查且不会停留在安装中', async () => {
  const manager = new WindowsUpdateManager(
    true,
    '2.1.20',
    async () => undefined,
    async () => {
      throw new Error('helper failed');
    },
    () => undefined,
  );
  manager.downloaded('2.1.21');
  await assert.rejects(manager.installNow(), /helper failed/);
  assert.equal(manager.getState().phase, 'error');
  assert.equal(manager.getState().available_version, '2.1.21');
  await manager.check();
  assert.equal(manager.getState().phase, 'checking');
});
