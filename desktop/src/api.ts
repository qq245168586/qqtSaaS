import { isValidationDump } from './assistant-errors';
import { dispatch, getState } from './store';
import {
  cacheRead,
  cacheWrite,
  clearCache,
  setCacheScope,
  cacheable,
  getCacheScope,
} from './cache';
import axios, { AxiosHeaders, AxiosError, type AxiosResponse } from 'axios';
import { z } from 'zod';
import {
  sessionSchema,
  pageSchema,
  resourceSchema,
  type Session,
  type Resource,
} from './contracts';
let token = '';
let sessionVersion = 0;
let offline = !navigator.onLine;
export function isOffline() {
  return offline;
}
function connection(value: boolean) {
  offline = value;
  window.dispatchEvent(new CustomEvent('api-connection', { detail: { offline: value } }));
}
window.addEventListener('offline', () => connection(true));
window.addEventListener('online', () => connection(false));
let refreshPromise: Promise<Session> | null = null;
export async function ipc<T extends z.ZodType>(
  promise: Promise<unknown>,
  schema: T,
): Promise<z.infer<T>> {
  const result = z
    .discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), data: z.unknown() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ])
    .parse(await promise);
  if (!result.ok) throw new Error(result.error);
  return schema.parse(result.data);
}
export const http = axios.create({
  timeout: 70000,
  adapter: async (config) => {
    const body: unknown = config.data;
    const payload: {
      path: string;
      method: string;
      binary: boolean;
      text?: string;
      files?: Array<{ field: string; name: string; type: string; bytes: Uint8Array }>;
      fields?: Array<[string, string]>;
    } = {
      path: config.url ?? '',
      method: (config.method ?? 'GET').toUpperCase(),
      binary: config.responseType === 'arraybuffer',
    };
    if (body instanceof FormData) {
      payload.files = [];
      payload.fields = [];
      for (const [field, value] of body.entries()) {
        if (typeof value === 'string') payload.fields.push([field, value]);
        else
          payload.files.push({
            field,
            name: value.name,
            type: value.type,
            bytes: new Uint8Array(await value.arrayBuffer()),
          });
      }
    } else if (typeof body === 'string') payload.text = body;
    try {
      const result = await ipc(
        window.desktop.request(payload),
        z.object({
          status: z.number(),
          headers: z.record(z.string(), z.string()),
          data: z.union([z.string(), z.instanceof(Uint8Array)]),
        }),
      );
      const response: AxiosResponse<unknown> = {
        status: result.status,
        statusText: String(result.status),
        headers: result.headers,
        config,
        data: typeof result.data === 'string' ? result.data : result.data.buffer,
      };
      if (result.status < 200 || result.status >= 300)
        throw new AxiosError(
          '服务器请求失败',
          AxiosError.ERR_BAD_RESPONSE,
          config,
          undefined,
          response,
        );
      return response;
    } catch (error) {
      if (axios.isAxiosError(error)) throw error;
      throw new AxiosError(
        error instanceof Error ? error.message : '网络请求失败',
        AxiosError.ERR_NETWORK,
        config,
      );
    }
  },
});
export function setSession(session: Session | null) {
  sessionVersion++;
  token = session?.access_token ?? '';
  if (session) setCacheScope(session.user.company_id, session.user.id, session.user.role);
  else void clearCache().catch(() => undefined);
  dispatch({ type: 'session', session });
}
export async function refresh() {
  const version = sessionVersion;
  refreshPromise ??= ipc(
    getState().session?.user.public_access ? window.desktop.enter() : window.desktop.refresh(),
    sessionSchema,
  )
    .then((session) => {
      if (version !== sessionVersion) throw new Error('登录会话已变化');
      setSession(session);
      return session;
    })
    .catch((e: unknown) => {
      if (version === sessionVersion) setSession(null);
      throw e;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}
http.interceptors.request.use((config) => {
  if (isOffline() && config.method?.toLowerCase() !== 'get')
    throw new Error('当前离线，只能查看缓存数据，不能提交修改');
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});
http.interceptors.response.use(
  (response) => {
    connection(false);
    return response;
  },
  async (error: unknown) => {
    if (axios.isAxiosError(error)) {
      // Any HTTP response proves that the server is reachable. A 4xx/5xx response
      // is an API error and must not leave the whole application in offline mode.
      connection(!error.response);
    }
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      error.config &&
      !error.config.headers.get('X-Refresh-Retry')
    ) {
      await refresh();
      error.config.headers = AxiosHeaders.from(error.config.headers);
      error.config.headers.set('X-Refresh-Retry', '1');
      error.config.headers.set('Authorization', `Bearer ${token}`);
      return http.request(error.config);
    }
    throw error;
  },
);
export async function api<T extends z.ZodType>(
  method: string,
  path: string,
  schema: T,
  data?: unknown,
) {
  const requestScope = getCacheScope();
  let raw: unknown;
  try {
    const response = await http.request<unknown>({ method, url: path, data });
    raw = response.data;
    if (method === 'GET' && cacheable(path))
      void cacheWrite(path, raw, requestScope).catch(() => undefined);
  } catch (error) {
    if (method === 'GET' && cacheable(path) && axios.isAxiosError(error) && !error.response) {
      raw = await cacheRead(path, requestScope);
      if (raw === undefined) throw new Error('当前离线，且此页面没有七天内的缓存');
    } else throw error;
  }
  if (requestScope !== getCacheScope()) throw new Error('登录会话已变化，请重新加载');
  const envelope = z
    .object({ code: z.number(), message: z.string(), data: z.unknown() })
    .parse(raw);
  if (envelope.code !== 0) throw new Error(envelope.message);
  return schema.parse(envelope.data);
}
export function errorText(error: unknown) {
  if (error instanceof z.ZodError) return '返回的数据格式不兼容，请刷新或更新 App 后重试。';
  if (axios.isAxiosError(error)) {
    let body: unknown = error.response?.data;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* Keep a non-JSON server response generic. */
      }
    }
    const parsed = z.object({ message: z.string() }).safeParse(body);
    if (parsed.success)
      return isValidationDump(parsed.data.message)
        ? '数据格式校验失败，请检查填写内容或更新 App 后重试。'
        : parsed.data.message;
  }
  return error instanceof Error
    ? isValidationDump(error.message)
      ? '数据格式校验失败，请刷新或更新 App 后重试。'
      : error.message
    : '操作失败';
}
export async function download(path: string, name: string) {
  const scope = getCacheScope();
  const response = await http.get<ArrayBuffer>(path, { responseType: 'arraybuffer' });
  if (scope !== getCacheScope()) throw new Error('登录会话已变化，导出已取消');
  return ipc(window.desktop.saveFile(name, new Uint8Array(response.data)), z.boolean());
}

export async function allResources(path: string) {
  const items: Resource[] = [];
  let page = 1;
  let total = 1;
  while (items.length < total) {
    const result = await api(
      'GET',
      `${path}?page_size=100&page=${page}`,
      pageSchema(resourceSchema),
    );
    total = result.total;
    items.push(...result.items);
    if (!result.items.length && items.length < total)
      throw new Error('基础资料分页响应不完整，请刷新重试');
    page++;
  }
  return items;
}

export async function downloadBatch(ids: string[]) {
  const response = await http.post<ArrayBuffer>(
    '/delivery-notes/export-batch',
    { ids },
    { responseType: 'arraybuffer' },
  );
  return ipc(
    window.desktop.saveFile('批量送货单.xlsx', new Uint8Array(response.data)),
    z.boolean(),
  );
}
