import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Windows release uses an HTTPS generic feed and NSIS metadata', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
    dependencies: Record<string, string>;
    build: {
      win: {
        target: string;
        artifactName: string;
        publish: Array<{ provider: string; url: string }>;
      };
      nsis: {
        oneClick: boolean;
        perMachine: boolean;
        include: string;
        runAfterFinish: boolean;
      };
    };
  };
  assert.match(pkg.version, /^2\.1\.\d+$/);
  assert.ok(pkg.dependencies['electron-updater']);
  assert.equal(pkg.build.win.target, 'nsis');
  assert.match(pkg.build.win.artifactName, /\$\{version\}/);
  assert.deepEqual(pkg.build.win.publish, [
    {
      provider: 'generic',
      url: 'https://114.215.185.184/updates/windows/stable/',
    },
  ]);
  assert.deepEqual(
    {
      oneClick: pkg.build.nsis.oneClick,
      perMachine: pkg.build.nsis.perMachine,
      include: pkg.build.nsis.include,
      runAfterFinish: pkg.build.nsis.runAfterFinish,
    },
    {
      oneClick: false,
      perMachine: false,
      include: 'build/installer.nsh',
      runAfterFinish: true,
    },
  );
});

test('Windows installer rescues broken 2.1.x uninstallers without deleting user data', async () => {
  const installer = await readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8');
  for (const version of ['2.0.0', '2.1.0', '2.1.1', '2.1.2', '2.1.3', '2.1.4', '2.1.7']) {
    assert.match(installer, new RegExp(`\\$R2 == \"${version.replaceAll('.', '\\.')}`));
  }
  assert.match(installer, /DeleteRegKey \$\{_ROOT_KEY\} \"\$\{UNINSTALL_REGISTRY_KEY\}\"/);
  assert.match(installer, /\.rescue-old/);
  assert.doesNotMatch(installer, /APPDATA|userData|attachment-cache/);
});

test('更新使用受控窗口，不依赖旧版失效的静态确认弹窗', async () => {
  const ui = await readFile(new URL('../src/WindowsUpdate.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /Modal\.confirm/);
  assert.match(ui, /<Modal[\s\S]*open=\{confirmOpen\}/);
  assert.match(ui, /downloadUpdateManually/);
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  assert.match(main, /autoInstallOnAppQuit = false/);
});

test('旧客户端传入更新标记时也静默安装，首次手动安装保留向导', async () => {
  const installer = await readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8');
  assert.match(
    installer,
    /!macro preInit\s+[\s\S]*?!ifndef BUILD_UNINSTALLER\s+\$\{If\} \$\{isUpdated\}\s+SetSilent silent\s+\$\{EndIf\}/,
  );
});
