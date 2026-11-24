export type UpdateFailureCode =
  | 'network'
  | 'invalid_package'
  | 'access_denied'
  | 'blocked'
  | 'cancelled'
  | 'app_running'
  | 'files_locked'
  | 'installer_missing'
  | 'helper_failed'
  | 'installer_failed'
  | 'version_unchanged'
  | 'unknown';
export interface UpdateFailure {
  code: UpdateFailureCode;
  message: string;
  manual_required: boolean;
}
const reasons: Record<UpdateFailureCode, string> = {
  network: '无法连接更新服务器或下载中断，请检查网络后重新检查更新。',
  invalid_package:
    '当前更新包校验失败或格式不受支持，不能安装此文件。请重新下载官方安装包后手动安装。',
  access_denied:
    'Windows 拒绝了安装所需的访问权限，本次无法自动安装。请手动安装并处理 Windows 的权限提示。',
  blocked:
    'Windows 安全策略或安全软件阻止了安装，本次无法自动安装。请检查系统拦截提示，确认官方安装包后手动安装。',
  cancelled: '安装或权限确认被取消，本次未完成更新。请重新下载官方安装包并手动安装。',
  app_running:
    '旧版 App 进程没有正常退出，本次无法自动安装。请关闭所有 App 窗口及后台进程后手动安装。',
  files_locked: '旧版文件仍被占用，本次无法自动安装。请关闭 App；必要时重启电脑，再手动安装。',
  installer_missing:
    '下载的安装文件不存在或不可读取，本次无法自动安装。请重新下载安装包后手动安装。',
  helper_failed: '更新助手未能正常启动，本次无法自动安装。请手动下载安装包。',
  installer_failed: '安装程序已退出但没有完成更新，本次无法继续自动安装。请手动下载安装包。',
  version_unchanged:
    '安装流程结束后仍运行旧版本，未能确认更新成功。具体原因尚未确定，请手动安装到原来的目录。',
  unknown: '更新没有完成，暂未取得明确的失败原因。请重新检查更新；若仍失败，请手动下载安装包。',
};
export function updateFailure(code: UpdateFailureCode, exitCode?: number): UpdateFailure {
  return {
    code,
    message: reasons[code] + (exitCode === undefined ? '' : `（错误码：${exitCode}）`),
    manual_required: code !== 'network',
  };
}
export function receiptFailure(phase: string, exitCode?: number, reason?: string): UpdateFailure {
  if (reason === 'installer_missing') return updateFailure('installer_missing', exitCode);
  if (reason === 'app_exit_timeout') return updateFailure('app_running', exitCode);
  if (reason === 'launch_error') {
    const native = exitCode === undefined ? undefined : exitCode & 0xffff;
    if (native === 5 || native === 740) return updateFailure('access_denied', exitCode);
    if (native === 225 || native === 1260) return updateFailure('blocked', exitCode);
    if (native === 1223) return updateFailure('cancelled', exitCode);
    if (native === 193) return updateFailure('invalid_package', exitCode);
    if (native === 2 || native === 3) return updateFailure('installer_missing', exitCode);
  }
  if (reason === 'installer_exit' || phase === 'installer_finished') {
    if (exitCode === 1001) return updateFailure('files_locked', exitCode);
    if (exitCode === 1002) return updateFailure('app_running', exitCode);
    if (exitCode === 1003 || exitCode === 1223) return updateFailure('cancelled', exitCode);
    if (exitCode !== undefined && exitCode !== 0)
      return updateFailure('installer_failed', exitCode);
    return updateFailure('version_unchanged', exitCode);
  }
  if (['waiting_for_exit', 'helper_ready', 'installer_started'].includes(phase)) {
    const stage =
      phase === 'waiting_for_exit'
        ? '等待 App 退出'
        : phase === 'helper_ready'
          ? '更新助手就绪'
          : '启动安装程序';
    return {
      ...updateFailure('unknown', exitCode),
      message: `上次更新停留在“${stage}”阶段，未取得完成结果，具体原因尚未确定。请手动下载安装包。`,
    };
  }
  return updateFailure('unknown', exitCode);
}
export function classifyUpdateError(error: unknown, installing = false): UpdateFailure {
  const text = error instanceof Error ? error.message : String(error ?? '');
  if (
    /sha512|checksum|signature|签名|校验|ERR_UPDATER_INVALID|invalid.*(package|installer)/i.test(
      text,
    )
  )
    return updateFailure('invalid_package');
  if (/EACCES|EPERM|access.*denied|拒绝访问/i.test(text)) return updateFailure('access_denied');
  if (/更新助手|独立更新程序/.test(text)) return updateFailure('helper_failed');
  if (/安装包.*(不存在|尚未准备|路径无效)/.test(text)) return updateFailure('installer_missing');
  if (/net::|ENOTFOUND|ECONN|ETIMEDOUT|network|fetch|HTTP|网络|timed?\s*out/i.test(text))
    return updateFailure('network');
  return updateFailure(installing ? 'installer_failed' : 'unknown');
}
