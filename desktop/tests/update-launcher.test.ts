import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  createWindowsUpdateLaunch,
  launchWindowsUpdateAfterExit,
  windowsInstallerDownloadUrl,
} from '../electron/update-launcher';

function helper() {
  return Object.assign(new EventEmitter(), {
    pid: 99,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    unrefs: 0,
    kills: 0,
    unref() {
      this.unrefs++;
    },
    kill() {
      this.kills++;
      return true;
    },
  });
}
test('更新助手使用系统绝对路径，校验安装包并在退出前确认就绪', () => {
  const installer = String.raw`C:\Users\tester\AppData\Local\tmy-updater\pending\TMY-TRI-Manager-2.1.20-x64-Setup.exe`;
  const launch = createWindowsUpdateLaunch(installer, 4321, { SystemRoot: 'C:\\Windows' });
  assert.equal(
    launch.command,
    String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
  );
  assert.match(launch.args.at(-1) ?? '', /Test-Path -LiteralPath/);
  assert.match(launch.args.at(-1) ?? '', /TMY_UPDATE_READY/);
  assert.match(launch.args.at(-1) ?? '', /Wait-Process/);
  assert.match(launch.args.at(-1) ?? '', /Start-Sleep -Milliseconds 2000/);
  assert.match(launch.args.at(-1) ?? '', /--updated/);
  assert.match(launch.args.at(-1) ?? '', /@\('\/S','--updated','--force-run'\)/);
  assert.match(launch.args.at(-1) ?? '', /-Wait -PassThru/);
  assert.match(launch.args.at(-1) ?? '', /ExitCode -ne 0/);
  assert.match(launch.args.at(-1) ?? '', /\.launch\.log/);
  assert.equal(launch.options.detached, true);
  assert.deepEqual(launch.options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(launch.options.env?.TMY_UPDATE_INSTALLER, installer);
  assert.equal(launch.options.env?.TMY_UPDATE_PARENT_PID, '4321');
  assert.doesNotMatch(launch.args.join(' '), /TMY-TRI-Manager-2\.1\.20/);
  assert.throws(() => createWindowsUpdateLaunch('/tmp/update.exe', 123), /路径无效/);
  assert.throws(
    () => createWindowsUpdateLaunch(String.raw`C:\updates\manager.txt`, 123),
    /路径无效/,
  );
});
test('收到分段就绪消息后才允许关闭 App，关闭管道并脱离父进程', async () => {
  const process = helper();
  let ready = false;
  const launched = launchWindowsUpdateAfterExit(
    String.raw`D:\updates\manager.exe`,
    123,
    () => process,
  ).then(() => {
    ready = true;
  });
  process.stdout.write('TMY_UPDATE_');
  await Promise.resolve();
  assert.equal(ready, false);
  process.stdout.write('READY\r\n');
  await launched;
  assert.equal(ready, true);
  assert.equal(process.unrefs, 1);
  assert.equal(process.stdout.destroyed, true);
  assert.equal(process.kills, 0);
});
test('更新助手启动错误或提前退出可捕获，不能误报成功', async () => {
  for (const event of ['error', 'exit'] as const) {
    const process = helper();
    const launched = launchWindowsUpdateAfterExit(
      String.raw`D:\updates\manager.exe`,
      123,
      () => process,
    );
    if (event === 'error') process.emit(event, new Error('ENOENT'));
    else process.emit(event, 1);
    await assert.rejects(launched, /更新助手/);
    assert.equal(process.unrefs, 0);
    assert.equal(process.kills, 1);
  }
});
test('手动下载地址仅接受版本号和既有可信更新源', () => {
  assert.equal(
    windowsInstallerDownloadUrl('2.1.20'),
    'https://114.215.185.184/updates/windows/stable/TMY-TRI-Manager-2.1.20-x64-Setup.exe',
  );
  for (const invalid of ['https://example.com', '../2.1.20', '2.1.20?token=x'])
    assert.throws(() => windowsInstallerDownloadUrl(invalid), /版本无效/);
});
