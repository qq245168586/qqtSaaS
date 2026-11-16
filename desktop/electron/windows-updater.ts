export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

export interface UpdateState {
  supported: boolean;
  phase: UpdatePhase;
  current_version: string;
  available_version: string | null;
  percent: number | null;
  message: string;
  checked_at: string | null;
}

type Publish = (state: UpdateState) => void;

function version(value: unknown): string | null {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)
    ? value
    : null;
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '未知错误');
  return raw.replace(/[\r\n]+/g, ' ').slice(0, 240);
}

export class WindowsUpdateManager {
  private state: UpdateState;

  constructor(
    supported: boolean,
    currentVersion: string,
    private readonly checkNative: () => Promise<unknown>,
    private readonly installNative: () => void | Promise<void>,
    private readonly publish: Publish,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.state = {
      supported,
      phase: supported ? 'idle' : 'unsupported',
      current_version: currentVersion,
      available_version: null,
      percent: null,
      message: supported ? '尚未检查更新' : '自动更新仅在 Windows 安装版启用',
      checked_at: null,
    };
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  private change(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...patch };
    const copy = this.getState();
    this.publish(copy);
    return copy;
  }

  async check(): Promise<UpdateState> {
    if (!this.state.supported) return this.getState();
    if (['checking', 'downloading', 'downloaded', 'installing'].includes(this.state.phase))
      return this.getState();
    this.change({
      phase: 'checking',
      message: '正在检查更新…',
      percent: null,
      checked_at: this.now(),
    });
    try {
      await this.checkNative();
    } catch (error) {
      this.failed(error);
    }
    return this.getState();
  }

  checking(): void {
    if (this.state.supported)
      this.change({ phase: 'checking', message: '正在检查更新…', checked_at: this.now() });
  }

  available(value: unknown): void {
    if (!this.state.supported) return;
    const next = version(value);
    this.change({
      phase: 'downloading',
      available_version: next,
      percent: 0,
      message: next ? `发现新版本 ${next}，正在后台下载…` : '发现新版本，正在后台下载…',
      checked_at: this.now(),
    });
  }

  progress(value: unknown): void {
    if (!this.state.supported) return;
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    const percent = Math.max(0, Math.min(100, Math.round(numeric * 10) / 10));
    this.change({
      phase: 'downloading',
      percent,
      message: `正在下载更新 ${Math.round(percent)}%`,
    });
  }

  downloaded(value: unknown): void {
    if (!this.state.supported) return;
    const next = version(value) ?? this.state.available_version;
    this.change({
      phase: 'downloaded',
      available_version: next,
      percent: 100,
      message: next ? `新版本 ${next} 已下载，重启后安装` : '新版本已下载，重启后安装',
      checked_at: this.now(),
    });
  }

  unavailable(): void {
    if (!this.state.supported) return;
    this.change({
      phase: 'up-to-date',
      available_version: null,
      percent: null,
      message: `当前 ${this.state.current_version} 已是最新版`,
      checked_at: this.now(),
    });
  }

  failed(error: unknown): void {
    if (!this.state.supported) return;
    this.change({
      phase: 'error',
      percent: null,
      message: `更新失败：${errorMessage(error)}`,
      checked_at: this.now(),
    });
  }

  async installNow(): Promise<void> {
    if (!this.state.supported || this.state.phase !== 'downloaded')
      throw new Error('更新尚未下载完成');
    this.change({ phase: 'installing', message: '正在退出并安装更新…' });
    try {
      await this.installNative();
    } catch (error) {
      this.failed(error);
      throw error;
    }
  }
}
