import { receiptFailure } from './update-errors.js';
import { beginUpdateReceipt, readUpdateReceipt, clearUpdateReceipt } from './update-receipt.js';
import { trustedMediaUrl } from './media-permission.js';
import { ClientDiagnostics, clientHeaders, safeError, safeRoute } from './client-diagnostics.js';
import { cachedImage, imageType, invalidateImage } from './image-cache.js';
import { submitPrintWithCompatibility } from './print-job.js';
import { WindowsUpdateManager } from './windows-updater.js';
import { installWindowsUpdate } from './update-install.js';
import { launchWindowsUpdateAfterExit, windowsInstallerDownloadUrl } from './update-launcher.js';
import { isAllowedApiPath } from './api-path.js';
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const here = path.dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
const deployedServer = 'https://114.215.185.184/api';
let baseUrl = deployedServer;
let accessToken = '';
let publicSession = false;
let downloadedWindowsInstaller = '';
let diagnostics: ClientDiagnostics | undefined;
async function flushDiagnostics() {
  if (!diagnostics || !accessToken || !app.isPackaged) return;
  await diagnostics.flush(async (events) => {
    const response = await fetch(baseUrl + '/client-diagnostics/events', {
      method: 'POST',
      headers: {
        ...clientHeaders(diagnostics!.identity),
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events }),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Diagnostic upload failed');
    return z
      .object({ code: z.literal(0), data: z.object({ accepted: z.array(z.string().uuid()) }) })
      .parse(await response.json()).data.accepted;
  });
}
async function appFetch(url: string | URL, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  const metadata = diagnostics ? clientHeaders(diagnostics.identity) : {};
  for (const [key, value] of Object.entries(metadata)) headers.set(key, value);
  const method = z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
    .catch('GET')
    .parse(options.method ?? 'GET');
  const context = { request_id: metadata['X-Request-ID'], route: safeRoute(String(url)), method };
  try {
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) diagnostics?.record('http_error', { ...context, status: response.status });
    return response;
  } catch (error) {
    diagnostics?.record('network_error', { ...context, ...safeError(error) });
    throw error;
  }
}
const credentials = () => path.join(app.getPath('userData'), 'session.encrypted');
const settings = () => path.join(app.getPath('userData'), 'connection.json');
const serverSchema = z
  .string()
  .url()
  .transform((value) => {
    const u = new URL(value);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      (u.protocol !== 'https:' &&
        !(u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)))
    )
      throw new Error('服务器必须使用 HTTPS；本地测试可使用 127.0.0.1');
    return value.replace(/\/+$/, '').replace(/\/api$/, '') + '/api';
  });
const sessionSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  user: z.object({
    id: z.string(),
    company_id: z.string(),
    company_code: z.enum(['tri', 'tmy']),
    username: z.string(),
    real_name: z.string(),
    role: z.enum(['boss', 'admin', 'employee']),
    must_change_password: z.union([z.boolean(), z.number()]).transform(Boolean),
    public_access: z.boolean().optional(),
  }),
});
async function request(route: string, body?: unknown, method: 'GET' | 'POST' = 'POST') {
  if (!baseUrl) throw new Error('请先配置服务器地址');
  const response = await appFetch(baseUrl + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(route === '/auth/logout' && accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  const envelope = z
    .object({ code: z.number(), message: z.string(), data: z.unknown() })
    .parse(await response.json());
  if (!response.ok || envelope.code !== 0) throw new Error(envelope.message);
  return envelope.data;
}
async function accessMode() {
  const mode = z
    .object({ public_access: z.boolean() })
    .parse(await request('/auth/access-mode', undefined, 'GET'));
  if (mode.public_access) {
    await unlink(credentials()).catch(() => undefined);
  }
  return mode;
}
async function remember(data: unknown) {
  const session = sessionSchema.parse(data);
  if (session.user.public_access) throw new Error('公开会话请使用公司入口');
  publicSession = false;
  accessToken = session.access_token;
  void flushDiagnostics();
  if (session.refresh_token) {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('系统安全存储不可用，无法保存登录凭据');
    await writeFile(
      credentials(),
      safeStorage.encryptString(JSON.stringify({ server: baseUrl, token: session.refresh_token })),
      { mode: 0o600 },
    );
  }
  return { access_token: session.access_token, user: session.user };
}
function handle(name: string, fn: (value: unknown) => Promise<unknown>) {
  ipcMain.handle(name, async (event, value: unknown) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('不可信调用');
    try {
      return { ok: true, data: await fn(value) };
    } catch (e) {
      if (name !== 'diagnostics:renderer-error') diagnostics?.record('ipc_error', safeError(e));
      return { ok: false, error: e instanceof Error ? e.message : '操作失败' };
    }
  });
}
async function savedToken() {
  const data = z
    .object({ server: z.string(), token: z.string() })
    .parse(JSON.parse(safeStorage.decryptString(await readFile(credentials()))));
  if (data.server !== baseUrl) throw new Error('登录服务器已变化');
  return data.token;
}
app.setName('天美意趣趣特管理');
if (!app.isPackaged && process.env.TMY_PHASE2_TEST_DIR)
  app.setPath('userData', process.env.TMY_PHASE2_TEST_DIR);
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  window?.show();
  window?.focus();
});
async function start() {
  await mkdir(app.getPath('userData'), { recursive: true });
  diagnostics = new ClientDiagnostics(
    app.getPath('userData'),
    app.getVersion() + (app.isPackaged ? '' : '-dev'),
    process.platform,
    process.arch,
  );
  diagnostics.record('app_started');
  const previousUpdate = readUpdateReceipt(app.getPath('userData'), app.getVersion());
  if (previousUpdate) {
    diagnostics.record(previousUpdate.success ? 'update_succeeded' : 'update_incomplete', {
      target_version: previousUpdate.target_version,
      phase: previousUpdate.phase,
      exit_code: previousUpdate.exit_code,
      error_type: previousUpdate.success
        ? undefined
        : receiptFailure(previousUpdate.phase, previousUpdate.exit_code, previousUpdate.reason)
            .code,
    });
    if (previousUpdate.success) clearUpdateReceipt(app.getPath('userData'));
  }
  process.on('uncaughtExceptionMonitor', (error) =>
    diagnostics?.record('main_error', safeError(error)),
  );
  setInterval(() => void flushDiagnostics(), 60_000).unref();
  handle('diagnostics:identity', async () => ({
    ...diagnostics!.identity,
    previous_update: previousUpdate,
  }));
  handle('diagnostics:renderer-error', async (value) => {
    const input = z
      .object({
        kind: z.enum(['error', 'rejection']),
        frames: z
          .array(
            z
              .string()
              .regex(/^[a-zA-Z0-9_.-]+\.[cm]?js:\d+:\d+$/)
              .max(120),
          )
          .max(8),
      })
      .strict()
      .parse(value);
    diagnostics?.record('renderer_error', { error_type: input.kind, frames: input.frames });
    return true;
  });
  if (!app.isPackaged) {
    try {
      baseUrl = serverSchema.parse(JSON.parse(await readFile(settings(), 'utf8')));
    } catch {
      /* Development defaults to the deployed server too. */
    }
  }
  handle('connection:get', async () => baseUrl);
  handle('compliance:reminders', async () => {
    const url = new URL('/compliance/api/reminders', baseUrl);
    const response = await appFetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`合规提醒读取失败（${response.status}）`);
    return z
      .object({
        dueCount: z.number().int().nonnegative(),
        dueItems: z.number().int().nonnegative(),
        overdueCount: z.number().int().nonnegative(),
        unprintedCount: z.number().int().nonnegative(),
        hasReminder: z.boolean(),
        date: z.string(),
      })
      .parse(await response.json());
  });
  handle('connection:set', async (value) => {
    const next = serverSchema.parse(value);
    if (app.isPackaged && next !== deployedServer) throw new Error('当前版本已内置服务器连接');
    if (next !== baseUrl) {
      accessToken = '';
      await unlink(credentials()).catch(() => undefined);
    }
    baseUrl = next;
    await writeFile(settings(), JSON.stringify(baseUrl), { mode: 0o600 });
    return baseUrl;
  });
  handle('auth:access-mode', async () => accessMode());
  handle('auth:enter', async (value) => {
    z.object({})
      .strict()
      .parse(value ?? {});
    accessToken = '';
    await unlink(credentials()).catch(() => undefined);
    const session = sessionSchema.parse(await request('/auth/enter', { client: 'desktop' }));
    if (session.user.public_access !== true || session.refresh_token)
      throw new Error('公开入口返回了无效会话');
    publicSession = true;
    accessToken = session.access_token;
    void flushDiagnostics();
    return { access_token: session.access_token, user: session.user };
  });
  handle('auth:login', async (value) => {
    const input = z
      .object({
        company_code: z.enum(['tri', 'tmy']),
        username: z.string().min(1).max(100),
        password: z.string().min(1).max(128),
      })
      .strict()
      .parse(value);
    if ((await accessMode()).public_access) throw new Error('请通过公司选择进入');
    return remember(await request('/auth/login', { ...input, client: 'desktop' }));
  });
  handle('auth:refresh', async () => {
    if (publicSession || (await accessMode()).public_access)
      throw new Error('公开会话到期，请重新选择公司');
    return remember(
      await request('/auth/refresh', { refresh_token: await savedToken(), client: 'desktop' }),
    );
  });
  handle('auth:logout', async () => {
    try {
      if (!publicSession)
        await request('/auth/logout', { refresh_token: await savedToken(), client: 'desktop' });
    } finally {
      await unlink(credentials()).catch(() => undefined);
      accessToken = '';
      publicSession = false;
    }
    return null;
  });
  handle('voice:settings', async () => {
    if (process.platform === 'win32') await shell.openExternal('ms-settings:privacy-microphone');
    else if (process.platform === 'darwin')
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      );
    return null;
  });
  handle('api:request', async (value) => {
    const input = z
      .object({
        path: z.string().max(4000),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        text: z
          .string()
          .max(100 * 1024 * 1024)
          .optional(),
        files: z
          .array(
            z.object({
              field: z.string().max(60),
              name: z.string().max(255),
              type: z.enum(['image/png', 'image/jpeg', 'image/webp', 'audio/wav']),
              bytes: z.instanceof(Uint8Array),
            }),
          )
          .max(12)
          .optional(),
        fields: z
          .array(z.tuple([z.string(), z.string()]))
          .max(30)
          .optional(),
        binary: z.boolean(),
      })
      .strict()
      .parse(value);
    if (!isAllowedApiPath(input.path)) throw new Error('接口路径不在白名单');
    if (!baseUrl || !accessToken) throw new Error('请先登录');
    if (publicSession && /^\/(backup|users|auth\/change-password)(\/|\?|$)/.test(input.path))
      throw new Error('公开模式不提供账号、密码或备份操作');
    if (
      new URL(baseUrl + input.path).pathname !==
        new URL(baseUrl).pathname + input.path.split('?')[0] ||
      /%2e|%2f|%5c/i.test(input.path.split('?')[0])
    )
      throw new Error('接口路径包含非法转义');
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    let body: BodyInit | undefined;
    if (input.files) {
      const data = new FormData();
      for (const [key, text] of input.fields ?? []) data.append(key, text);
      for (const file of input.files) {
        if (file.bytes.byteLength > 10 * 1024 * 1024) throw new Error('文件超过10MiB');
        if (
          file.type === 'audio/wav' &&
          (input.path !== '/ai/voice/transcribe' ||
            input.method !== 'POST' ||
            input.files.length !== 1 ||
            file.field !== 'file')
        )
          throw new Error('音频只能上传到语音识别接口');
        data.append(
          file.field,
          new Blob([new Uint8Array(file.bytes)], { type: file.type }),
          path.basename(file.name),
        );
      }
      body = data;
    } else if (input.text !== undefined) {
      JSON.parse(input.text);
      headers['Content-Type'] = 'application/json';
      body = input.text;
    }
    const response = await appFetch(baseUrl + input.path, {
      method: input.method,
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(70000),
    });
    const data = input.binary
      ? new Uint8Array(await response.arrayBuffer())
      : await response.text();
    return {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? '' },
      data,
    };
  });
  handle('image:invalidate', async (value) => {
    const id = z.string().regex(/^\d+$/).parse(value);
    await invalidateImage(
      path.join(app.getPath('userData'), 'attachment-cache'),
      `${baseUrl}:${id}:immutable`,
    );
    return null;
  });
  handle('image:read', async (value) => {
    const input = z
      .object({ taskId: z.string().regex(/^\d+$/), id: z.string().regex(/^\d+$/) })
      .strict()
      .parse(value);
    if (!accessToken) throw new Error('请先登录');
    // Authorize against current metadata even on cache hits; never trust renderer URLs.
    const response = await appFetch(`${baseUrl}/tasks/${input.taskId}/images?page_size=100`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error('附件访问权限校验失败');
    const body = z
      .object({
        code: z.literal(0),
        data: z.object({
          items: z.array(
            z.object({
              id: z.string(),
              url: z.string(),
              sha256: z.string().optional(),
              version: z.union([z.string(), z.number()]).optional(),
            }),
          ),
        }),
      })
      .parse(await response.json());
    const item = body.data.items.find((item) => item.id === input.id);
    if (!item) throw new Error('附件已删除或不可访问');
    const bytes = await cachedImage(
      path.join(app.getPath('userData'), 'attachment-cache'),
      `${baseUrl}:${input.id}:immutable`,
      async () => {
        const url = new URL(item.url, baseUrl);
        if (url.origin !== new URL(baseUrl).origin) throw new Error('附件地址不可信');
        const result = await appFetch(url, {
          redirect: 'error',
          signal: AbortSignal.timeout(30000),
        });
        if (!result.ok) throw new Error('图片下载失败');
        if (Number(result.headers.get('content-length')) > 10 * 1024 * 1024)
          throw new Error('图片超过10MiB');
        return new Uint8Array(await result.arrayBuffer());
      },
    );
    return { bytes, type: imageType(bytes) };
  });
  handle('wiki:image', async (value) => {
    const id = z.string().regex(/^\d+$/u).parse(value);
    if (!baseUrl || !accessToken) throw new Error('请先登录');
    const bytes = await cachedImage(
      path.join(app.getPath('userData'), 'attachment-cache'),
      `${baseUrl}:wiki:${id}:immutable`,
      async () => {
        const response = await appFetch(`${baseUrl}/wiki/images/${id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          redirect: 'error',
          signal: AbortSignal.timeout(20_000),
        });
        const body = z
          .object({
            code: z.number(),
            message: z.string(),
            data: z.object({ id: z.string(), url: z.string().url() }),
          })
          .parse(await response.json());
        if (!response.ok || body.code !== 0) throw new Error(body.message);
        const url = new URL(body.data.url, baseUrl);
        if (url.origin !== new URL(baseUrl).origin) throw new Error('附件地址不可信');
        const result = await appFetch(url, {
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
        });
        if (!result.ok) throw new Error('图片下载失败');
        if (Number(result.headers.get('content-length')) > 10 * 1024 * 1024)
          throw new Error('图片超过10MiB');
        return new Uint8Array(await result.arrayBuffer());
      },
    );
    return { bytes, type: imageType(bytes) };
  });
  handle('printers:list', async () => window!.webContents.getPrintersAsync());
  handle('system:open-external', async (value) => {
    const url = z
      .string()
      .url()
      .max(2048)
      .refine((candidate) => ['http:', 'https:'].includes(new URL(candidate).protocol))
      .parse(value);
    await shell.openExternal(url);
    return null;
  });
  handle('file:save', async (value) => {
    const input = z
      .object({ name: z.string().max(100), data: z.instanceof(Uint8Array) })
      .parse(value);
    if (input.data.byteLength > 100 * 1024 * 1024) throw new Error('文件过大');
    const result = await dialog.showSaveDialog(window!, { defaultPath: path.basename(input.name) });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, input.data);
    return true;
  });
  handle('delivery:print', async (value) => {
    const input = z
      .object({
        printer: z.string().min(1),
        width: z.number().min(80).max(400),
        height: z.number().min(60).max(600),
        copies: z.number().int().min(1).max(9),
      })
      .strict()
      .parse(value);
    const online = await appFetch(baseUrl + '/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!online.ok) throw new Error('当前无法验证云端会话，离线或登录失效时禁止打印');
    const printers = await window!.webContents.getPrintersAsync();
    if (!printers.some((p) => p.name === input.printer)) throw new Error('打印机不存在');
    const ready: unknown = await window!.webContents.executeJavaScript(
      `(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const pages=[...document.querySelectorAll('.print-preview-source .delivery-paper')];const overflow=[...document.querySelectorAll('.print-preview-source .tpl-element, .print-preview-source .tpl-cell, .print-preview-source .tpl-text')].some(el=>el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2);return {valid:pages.length>0&&pages.length<=2&&!overflow&&!document.querySelector('.print-preview-source [data-date-overflow="true"]'),custom:!!document.querySelector('.print-preview-source[data-custom-template="true"]')};})()`,
    );
    const layout = z.object({ valid: z.boolean(), custom: z.boolean() }).parse(ready);
    if (!layout.valid) throw new Error('打印页面未准备好或文本内容溢出，请检查模板和内容');
    return submitPrintWithCompatibility(
      (pageSize, done) => {
        window!.webContents.print(
          {
            silent: true,
            deviceName: input.printer,
            printBackground: true,
            color: false,
            margins: { marginType: 'none' },
            pageSize,
            copies: input.copies,
            scaleFactor: 100,
            landscape: false,
            duplexMode: 'simplex',
            pagesPerSheet: 1,
            collate: true,
          },
          done,
        );
      },
      { width: Math.round(input.width * 1000), height: Math.round(input.height * 1000) },
      layout.custom,
    );
  });
  const updateSupported = process.platform === 'win32' && app.isPackaged;
  const { autoUpdater } = electronUpdater;
  const updates = new WindowsUpdateManager(
    updateSupported,
    app.getVersion(),
    async () => {
      autoUpdater.requestHeaders = clientHeaders(diagnostics!.identity);
      return autoUpdater.checkForUpdates();
    },
    () =>
      installWindowsUpdate({
        windows: () => BrowserWindow.getAllWindows(),
        launchInstaller: () => {
          if (!downloadedWindowsInstaller) throw new Error('更新安装包尚未准备好');
          const target = updates.getState().available_version;
          if (!target) throw new Error('更新版本尚未准备好');
          const receipt = beginUpdateReceipt(app.getPath('userData'), app.getVersion(), target);
          diagnostics?.record('update_requested', { target_version: target });
          return launchWindowsUpdateAfterExit(
            downloadedWindowsInstaller,
            process.pid,
            undefined,
            receipt,
          );
        },
        exitApp: (code) => app.exit(code),
      }),
    (state) => {
      if (state.phase !== 'unsupported')
        diagnostics?.record('update_state', {
          phase: state.phase,
          target_version: state.available_version ?? undefined,
          error_type: state.failure_code ?? undefined,
        });
      if (window && !window.isDestroyed()) window.webContents.send('update:state', state);
    },
  );
  if (previousUpdate && !previousUpdate.success)
    updates.restoreFailure(
      previousUpdate.target_version,
      receiptFailure(previousUpdate.phase, previousUpdate.exit_code, previousUpdate.reason),
    );
  handle('update:get', async () => updates.getState());
  handle('update:check', async (value) => {
    z.object({})
      .strict()
      .parse(value ?? {});
    return updates.check();
  });
  handle('update:install', async (value) => {
    z.object({})
      .strict()
      .parse(value ?? {});
    await updates.installNow();
    return updates.getState();
  });
  handle('update:download-manually', async (value) => {
    z.object({})
      .strict()
      .parse(value ?? {});
    if (!updateSupported) throw new Error('手动更新仅支持 Windows 安装版');
    const version = updates.getState().available_version;
    if (!version) throw new Error('请先检查更新');
    await shell.openExternal(windowsInstallerDownloadUrl(version));
    return true;
  });
  if (updateSupported) {
    autoUpdater.requestHeaders = clientHeaders(diagnostics.identity);
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on('checking-for-update', () => updates.checking());
    autoUpdater.on('update-available', (info) => updates.available(info.version));
    autoUpdater.on('download-progress', (progress) => updates.progress(progress.percent));
    autoUpdater.on('update-downloaded', (info) => {
      downloadedWindowsInstaller = info.downloadedFile;
      updates.downloaded(info.version);
    });
    autoUpdater.on('update-not-available', () => updates.unavailable());
    autoUpdater.on('error', (error) => updates.failed(error));
  }
  window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setUserAgent(clientHeaders(diagnostics.identity)['User-Agent']);
  window.webContents.on('render-process-gone', (_event, details) =>
    diagnostics?.record('renderer_crashed', { exit_code: details.exitCode }),
  );
  const trustedMediaOrigin = (url: string) =>
    trustedMediaUrl(url, path.join(here, '../../dist/index.html'), !app.isPackaged);
  window.webContents.session.setPermissionCheckHandler(
    (contents, permission, origin, details) =>
      contents === window?.webContents &&
      permission === 'media' &&
      details.mediaType === 'audio' &&
      (trustedMediaOrigin(origin) || trustedMediaOrigin(details.requestingUrl ?? '')),
  );
  window.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      callback(
        contents === window?.webContents &&
          permission === 'media' &&
          details.isMainFrame &&
          trustedMediaOrigin(
            new URL(contents.getURL()).protocol === 'file:'
              ? contents.getURL()
              : new URL(contents.getURL()).origin,
          ) &&
          'mediaTypes' in details &&
          details.mediaTypes?.length === 1 &&
          details.mediaTypes[0] === 'audio',
      );
    },
  );
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (!app.isPackaged && dev === 'http://127.0.0.1:5176') await window.loadURL(dev);
  else await window.loadFile(path.join(here, '../../dist/index.html'));
  if (updateSupported) {
    setTimeout(() => {
      if (!updates.getState().manual_required) void updates.check();
    }, 10_000).unref();
    setInterval(
      () => {
        if (!updates.getState().manual_required) void updates.check();
      },
      4 * 60 * 60 * 1000,
    ).unref();
  }
}
void app
  .whenReady()
  .then(start)
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : '启动失败');
    app.quit();
  });
app.on('window-all-closed', () => app.quit());
