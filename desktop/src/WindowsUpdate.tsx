import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Tooltip, message } from 'antd';
import { z } from 'zod';
import { errorText, ipc } from './api';

function DownloadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5M5 20h14"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const updateStateSchema = z.object({
  supported: z.boolean(),
  manual_required: z.boolean(),
  failure_code: z.string().nullable(),
  phase: z.enum([
    'unsupported',
    'idle',
    'checking',
    'up-to-date',
    'downloading',
    'downloaded',
    'installing',
    'error',
  ]),
  current_version: z.string(),
  available_version: z.string().nullable(),
  percent: z.number().nullable(),
  message: z.string(),
  checked_at: z.string().nullable(),
});
type UpdateState = z.infer<typeof updateStateSchema>;

const clientIdentitySchema = z.object({
  device_id: z.string().uuid(),
  app_version: z.string(),
  previous_update: z
    .object({
      success: z.boolean(),
      target_version: z.string(),
      phase: z.string(),
      exit_code: z.number().optional(),
    })
    .nullable(),
});
export function WindowsUpdate() {
  const [identity, setIdentity] = useState<z.infer<typeof clientIdentitySchema> | null>(null);
  const [state, setState] = useState<UpdateState | null>(null);
  const notified = useRef('');
  const errorNotified = useRef('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => {
    void ipc(window.desktop.getClientIdentity(), clientIdentitySchema)
      .then(setIdentity)
      .catch(() => undefined);
    const accept = (value: unknown) => {
      const parsed = updateStateSchema.safeParse(value);
      if (!parsed.success) return;
      setState(parsed.data);
      if (parsed.data.phase === 'error' && errorNotified.current !== parsed.data.message) {
        errorNotified.current = parsed.data.message;
        setConfirmOpen(true);
      }
      if (
        parsed.data.phase === 'downloaded' &&
        parsed.data.available_version &&
        notified.current !== parsed.data.available_version
      ) {
        notified.current = parsed.data.available_version;
        void message.success(`新版本 ${parsed.data.available_version} 已下载，可重启安装`);
      }
    };
    window.desktop.onUpdateState(accept);
    void ipc(window.desktop.getUpdateState(), updateStateSchema)
      .then(accept)
      .catch((error) => message.warning(errorText(error)));
  }, []);
  if (
    !state?.supported ||
    !['downloading', 'downloaded', 'installing', 'error'].includes(state.phase)
  )
    return null;
  const act = () => {
    if (state.phase === 'downloaded' || state.phase === 'error') setConfirmOpen(true);
    if (state.phase === 'downloading')
      void message.info(`新版本正在后台下载：${Math.round(state.percent ?? 0)}%`);
  };
  const install = async () => {
    try {
      await ipc(window.desktop.installUpdate(), updateStateSchema);
    } catch (error) {
      void message.error(errorText(error));
    }
  };
  return (
    <>
      <Tooltip title={`${state.message}；当前版本 ${state.current_version}`}>
        <Button
          className="update-download-button"
          type="primary"
          shape="circle"
          icon={<DownloadIcon />}
          loading={state.phase === 'installing'}
          aria-label={
            state.phase === 'error'
              ? '应用更新失败'
              : state.phase === 'downloaded'
                ? '安装应用更新'
                : '应用更新下载中'
          }
          onClick={act}
        />
      </Tooltip>
      <Modal
        open={confirmOpen}
        title={
          state.phase === 'error'
            ? state.manual_required
              ? '无法自动安装，请手动安装'
              : '更新失败'
            : '重启并安装更新？'
        }
        onCancel={() => setConfirmOpen(false)}
        footer={[
          <Button key="later" onClick={() => setConfirmOpen(false)}>
            稍后
          </Button>,
          <Button
            key="manual"
            type={state.manual_required ? 'primary' : 'default'}
            disabled={!state.available_version}
            onClick={() =>
              void ipc(window.desktop.downloadUpdateManually(), z.boolean()).catch((error) =>
                message.error(errorText(error)),
              )
            }
          >
            手动下载安装包
          </Button>,
          state.phase === 'error' ? (
            <Button
              key="retry"
              type={state.manual_required ? 'default' : 'primary'}
              onClick={() =>
                void ipc(window.desktop.checkForUpdates(), updateStateSchema).catch((error) =>
                  message.error(errorText(error)),
                )
              }
            >
              重新检查
            </Button>
          ) : (
            <Button
              key="install"
              type="primary"
              loading={state.phase === 'installing'}
              disabled={state.phase !== 'downloaded'}
              onClick={() => void install()}
            >
              重启更新
            </Button>
          ),
        ]}
      >
        <p>
          {state.phase === 'error'
            ? state.message
            : '请先保存正在编辑的内容。App 将退出，在后台静默更新后自动打开，无需操作安装向导。'}
        </p>
        {identity && (
          <p style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
            设备编号：{identity.device_id} · 版本：{identity.app_version}
          </p>
        )}
        {identity?.previous_update && !identity.previous_update.success && (
          <p>
            上次更新尚未完成：目标版本 {identity.previous_update.target_version}，当前仍为{' '}
            {identity.app_version}。诊断记录将在联网后自动上传。
          </p>
        )}
        <p>
          手动安装时，请先退出 App，再运行官方安装包并安装到原来的目录。不要继续运行校验失败的文件。
        </p>
      </Modal>
    </>
  );
}
