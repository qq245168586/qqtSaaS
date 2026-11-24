import { spawn, type SpawnOptions } from 'node:child_process';
import path from 'node:path';

export interface DetachedProcess {
  pid?: number;
  unref(): void;
  kill(): boolean;
  once(event: 'error', listener: (error: Error) => void): void;
  once(event: 'exit', listener: (code: number | null) => void): void;
  stdout: { on(event: 'data', listener: (data: Buffer) => void): void; destroy(): void } | null;
  stderr: { on(event: 'data', listener: (data: Buffer) => void): void; destroy(): void } | null;
}
export type SpawnDetached = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => DetachedProcess;
export interface WindowsUpdateLaunch {
  command: string;
  args: string[];
  options: SpawnOptions;
}
export interface UpdateReceiptTarget {
  file: string;
  attempt_id: string;
}

export function createWindowsUpdateLaunch(
  installerPath: string,
  parentPid: number,
  environment: NodeJS.ProcessEnv = process.env,
  receipt?: UpdateReceiptTarget,
): WindowsUpdateLaunch {
  if (
    !/^[A-Za-z]:[\\/]/.test(installerPath) ||
    !path.win32.isAbsolute(installerPath) ||
    path.win32.extname(installerPath).toLowerCase() !== '.exe'
  )
    throw new Error('更新安装包路径无效');
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) throw new Error('App 进程号无效');
  const systemRoot = environment.SystemRoot ?? environment.WINDIR ?? 'C:\\Windows';
  if (!path.win32.isAbsolute(systemRoot)) throw new Error('Windows 系统目录无效');
  // Acknowledge readiness before closing Electron; do not mistake spawn() for a
  // working updater. Paths stay in env, never interpolated into PowerShell code.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'function Save-UpdateResult($phase, $exitCode) { if ($env:TMY_UPDATE_RESULT) { @{ attempt_id=$env:TMY_UPDATE_ATTEMPT; phase=$phase; exit_code=$exitCode; reason=$script:failureReason } | ConvertTo-Json -Compress | Set-Content -LiteralPath $env:TMY_UPDATE_RESULT -Encoding UTF8 } }',
    'function Get-UpdateErrorCode($record) { $exception=$record.Exception; while ($exception) { if ($exception -is [System.ComponentModel.Win32Exception]) { return $exception.NativeErrorCode }; $exception=$exception.InnerException }; return $record.Exception.HResult }',
    "$script:failureReason = 'launch_error'",
    'try {',
    "if (!(Test-Path -LiteralPath $env:TMY_UPDATE_INSTALLER -PathType Leaf)) { $script:failureReason = 'installer_missing'; throw 'Installer missing' }",
    '$parentId = [int]$env:TMY_UPDATE_PARENT_PID',
    "Save-UpdateResult 'helper_ready' $null",
    "[Console]::Out.WriteLine('TMY_UPDATE_READY')",
    '[Console]::Out.Flush()',
    "Save-UpdateResult 'waiting_for_exit' $null",
    'Wait-Process -Id $parentId -Timeout 120 -ErrorAction SilentlyContinue',
    "if (Get-Process -Id $parentId -ErrorAction SilentlyContinue) { $script:failureReason = 'app_exit_timeout'; throw 'App exit timed out' }",
    'Start-Sleep -Milliseconds 2000',
    "Save-UpdateResult 'installer_started' $null",
    "$installer = Start-Process -FilePath $env:TMY_UPDATE_INSTALLER -ArgumentList @('/S','--updated','--force-run') -PassThru -ErrorAction Stop",
    '$null = $installer.Handle',
    '$installer.WaitForExit()',
    '$installer.Refresh()',
    "$script:failureReason = 'installer_exit'",
    "Save-UpdateResult 'installer_finished' $installer.ExitCode",
    "if ($installer.ExitCode -ne 0) { throw ('静默更新失败，安装程序退出码：' + $installer.ExitCode) }",
    "} catch { Save-UpdateResult 'failed' $(if ($installer) { $installer.ExitCode } else { Get-UpdateErrorCode $_ }); exit 1 }",
  ]
    .join('; ')
    .replace('try {;', 'try { ')
    .replace('} catch {;', '} catch { ');
  return {
    command: path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
    options: {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...environment,
        TMY_UPDATE_INSTALLER: installerPath,
        TMY_UPDATE_PARENT_PID: String(parentPid),
        ...(receipt
          ? { TMY_UPDATE_RESULT: receipt.file, TMY_UPDATE_ATTEMPT: receipt.attempt_id }
          : {}),
      },
    },
  };
}

export async function launchWindowsUpdateAfterExit(
  installerPath: string,
  parentPid: number,
  spawnDetached: SpawnDetached = spawn,
  receipt?: UpdateReceiptTarget,
): Promise<void> {
  const launch = createWindowsUpdateLaunch(installerPath, parentPid, process.env, receipt);
  await new Promise<void>((resolve, reject) => {
    const helper = spawnDetached(launch.command, launch.args, launch.options);
    let settled = false;
    let output = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      helper.stdout?.destroy();
      helper.stderr?.destroy();
      if (error) {
        helper.kill();
        reject(error);
      } else {
        helper.unref();
        resolve();
      }
    };
    helper.once('error', () => finish(new Error('无法启动更新助手，请使用手动下载安装包')));
    helper.once('exit', () => finish(new Error('更新助手未准备好，请使用手动下载安装包')));
    helper.stdout?.on('data', (chunk) => {
      output = (output + chunk.toString('utf8')).slice(-256);
      if (output.includes('TMY_UPDATE_READY')) finish();
    });
    // Consume stderr so a verbose system error cannot block the helper.
    helper.stderr?.on('data', () => undefined);
    if (!helper.pid || !helper.stdout) finish(new Error('无法启动独立更新程序'));
    if (!settled)
      timer = setTimeout(() => finish(new Error('更新助手启动超时，请使用手动下载安装包')), 10000);
  });
}

export function windowsInstallerDownloadUrl(version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('更新版本无效，请重新检查更新');
  return `https://114.215.185.184/updates/windows/stable/TMY-TRI-Manager-${version}-x64-Setup.exe`;
}
