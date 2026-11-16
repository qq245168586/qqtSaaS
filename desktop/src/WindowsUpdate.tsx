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

export function WindowsUpdate() {
  const [state, setState] = useState<UpdateState | null>(null);
  const notified = useRef('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => {
    const accept = (value: unknown) => {
      const parsed = updateStateSchema.safeParse(value);
      if (!parsed.success) return;
      setState(parsed.data);
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
        title={state.phase === 'error' ? '应用更新未完成' : '重启并安装更新？'}
        onCancel={() => setConfirmOpen(false)}
        footer={[
          <Button key="later" onClick={() => setConfirmOpen(false)}>
            稍后
          </Button>,
          <Button
            key="manual"
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
              type="primary"
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
        <p>若无法自动安装，可以手动下载安装包，退出 App 后安装到原来的目录。</p>
      </Modal>
    </>
  );
}
