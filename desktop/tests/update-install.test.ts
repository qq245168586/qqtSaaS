import assert from 'node:assert/strict';
import test from 'node:test';
import { installWindowsUpdate, type UpdateWindow } from '../electron/update-install';

test('安装更新时先启动独立助手、关闭窗口并立即退出旧进程', async () => {
  let willPreventUnload: ((event: { preventDefault(): void }) => void) | null = null;
  let launched = 0;
  let destroyed = 0;
  let exitCode: number | null = null;
  let fallback: (() => void) | null = null;
  const window: UpdateWindow = {
    isDestroyed: () => destroyed > 0,
    webContents: {
      once: (event, listener) => {
        assert.equal(event, 'will-prevent-unload');
        willPreventUnload = listener;
      },
    },
    destroy: () => {
      destroyed++;
    },
  };

  await installWindowsUpdate({
    windows: () => [window],
    launchInstaller: () => {
      launched++;
    },
    exitApp: (code) => {
      exitCode = code;
    },
    schedule: (callback, delay) => {
      assert.equal(delay, 100);
      fallback = callback;
    },
  });

  assert.equal(launched, 1);
  assert.equal(destroyed, 1);
  let allowed = false;
  assert.ok(willPreventUnload);
  willPreventUnload({ preventDefault: () => (allowed = true) });
  assert.equal(allowed, true);
  assert.ok(fallback);
  fallback();
  assert.equal(destroyed, 1);
  assert.equal(exitCode, 0);
});

test('助手启动失败时保留窗口和旧App，不退出也不尝试第二次安装', async () => {
  let destroyed = false;
  let exited = false;
  await assert.rejects(
    installWindowsUpdate({
      windows: () => [
        {
          isDestroyed: () => false,
          webContents: { once: () => undefined },
          destroy: () => {
            destroyed = true;
          },
        },
      ],
      launchInstaller: async () => {
        throw new Error('helper failed');
      },
      exitApp: () => {
        exited = true;
      },
    }),
    /helper failed/,
  );
  assert.equal(destroyed, false);
  assert.equal(exited, false);
});
