import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyUpdateError, receiptFailure } from '../electron/update-errors';
import { WindowsUpdateManager } from '../electron/windows-updater';

test('更新失败按原因给出中文操作建议，不泄露异常原文', () => {
  const network = classifyUpdateError(
    new Error('net::ERR_CONNECTION_RESET https://host?token=private'),
  );
  assert.equal(network.manual_required, false);
  assert.equal(network.code, 'network');
  assert.doesNotMatch(network.message, /private/);
  const bad = classifyUpdateError(new Error('sha512 checksum mismatch'));
  assert.equal(bad.manual_required, true);
  assert.match(bad.message, /不能安装此文件/);
  assert.equal(classifyUpdateError(new Error('EACCES')).code, 'access_denied');
  assert.equal(classifyUpdateError(new Error('更新助手启动超时')).code, 'helper_failed');
});
test('更新回执区分权限、文件占用、取消和版本未改变，不虚构未知原因', () => {
  assert.equal(receiptFailure('failed', 5, 'launch_error').code, 'access_denied');
  assert.equal(receiptFailure('failed', 740, 'launch_error').code, 'access_denied');
  assert.equal(receiptFailure('failed', 225, 'launch_error').code, 'blocked');
  assert.equal(receiptFailure('failed', 193, 'launch_error').code, 'invalid_package');
  assert.equal(receiptFailure('failed', 1223, 'launch_error').code, 'cancelled');
  assert.equal(receiptFailure('failed', 1001, 'installer_exit').code, 'files_locked');
  assert.equal(receiptFailure('failed', 1002, 'installer_exit').code, 'app_running');
  assert.equal(receiptFailure('failed', 1003, 'installer_exit').code, 'cancelled');
  assert.equal(receiptFailure('installer_finished', 0, 'installer_exit').code, 'version_unchanged');
  assert.equal(receiptFailure('failed', -1, 'launch_error').code, 'unknown');
  assert.match(receiptFailure('failed', -1).message, /暂未取得明确/);
});
test('上次安装未完成保留目标版本和手动入口，禁止直接再次安装', async () => {
  let installed = false;
  const manager = new WindowsUpdateManager(
    true,
    '2.1.34',
    async () => undefined,
    () => {
      installed = true;
    },
    () => undefined,
  );
  manager.restoreFailure('2.1.35', receiptFailure('installer_finished', 0));
  assert.equal(manager.getState().phase, 'error');
  assert.equal(manager.getState().manual_required, true);
  assert.equal(manager.getState().available_version, '2.1.35');
  await assert.rejects(manager.installNow());
  assert.equal(installed, false);
  await manager.check();
  assert.equal(manager.getState().manual_required, false);
  manager.downloaded('2.1.35');
  await manager.installNow();
  assert.equal(installed, true);
});
test('NSIS 静默中止带有可诊断的非零错误码', () => {
  const source = readFileSync(new URL('../build/installer.nsh', import.meta.url), 'utf8');
  assert.match(source, /tmy_manager_cleanup_cancelled:\s+SetErrorLevel 1001\s+Quit/);
  assert.match(source, /tmy_manager_close_cancelled:\s+SetErrorLevel 1002\s+Quit/);
  assert.match(source, /IDOK \+3\s+SetErrorLevel 1003\s+Quit/);
});
