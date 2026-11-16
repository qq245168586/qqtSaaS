import { z } from "zod";
import { sessionSchema, type User } from "./models";
import { appStore } from "./store";
const envelope = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown(),
});
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
const getToken = () => appStore.getSnapshot().accessToken;
let publicMode = false;
let wikiMode = false;
let passwordRequired = false;
export async function accessMode() {
  const result = await decode(
    await send("/auth/access-mode"),
    z.object({
      public_access: z.boolean(),
      web_password_required: z.boolean().default(false),
    }),
  );
  publicMode = result.public_access;
  passwordRequired = result.web_password_required;
  return result;
}
let enterPromise: Promise<User> | null = null;
export function enterCompany(password?: string): Promise<User> {
  if (enterPromise) return enterPromise;
  enterPromise = (async () => {
    const result = await decode(
      await send("/auth/enter", {
        method: "POST",
        body: JSON.stringify({
          client: "web",
          ...(password === undefined ? {} : { password }),
        }),
      }),
      sessionSchema,
    );
    if (!result.user.public_access) throw new Error("公开入口响应无效");
    publicMode = true;
    wikiMode = false;
    appStore.dispatch({
      type: "session",
      user: result.user,
      accessToken: result.access_token,
    });
    return result.user;
  })().finally(() => {
    enterPromise = null;
  });
  return enterPromise;
}
let wikiEnterPromise: Promise<User> | null = null;
export function enterWiki(): Promise<User> {
  if (wikiEnterPromise) return wikiEnterPromise;
  wikiEnterPromise = (async () => {
    const result = await decode(
      await send("/auth/enter", {
        method: "POST",
        body: JSON.stringify({ client: "wiki" }),
      }),
      sessionSchema,
    );
    if (!result.user.public_access)
      throw new Error("Confluence 公开入口响应无效");
    publicMode = true;
    wikiMode = true;
    appStore.dispatch({
      type: "session",
      user: result.user,
      accessToken: result.access_token,
    });
    return result.user;
  })().finally(() => {
    wikiEnterPromise = null;
  });
  return wikiEnterPromise;
}
let refreshPromise: Promise<User> | null = null;
export function observeSession(callback: (user: User | null) => void) {
  let previous = appStore.getSnapshot().user;
  return appStore.subscribe(() => {
    const user = appStore.getSnapshot().user;
    if (user !== previous) {
      previous = user;
      callback(user);
    }
  });
}
export function clearSession() {
  appStore.dispatch({ type: "logout" });
}
async function decode<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const result = envelope.safeParse(await response.json().catch(() => null));
  if (!result.success)
    throw new ApiError("服务器响应格式错误", response.status);
  if (!response.ok || result.data.code !== 0)
    throw new ApiError(result.data.message, response.status);
  const parsed = schema.safeParse(result.data.data);
  if (!parsed.success)
    throw new ApiError("服务器数据与接口约定不一致", response.status);
  return parsed.data;
}
async function send(path: string, init: RequestInit = {}) {
  const multipart =
    typeof FormData !== "undefined" && init.body instanceof FormData;
  return fetch(`/api${path}`, {
    ...init,
    credentials: publicMode ? "omit" : "include",
    signal: init.signal ?? AbortSignal.timeout(75000),
    headers: {
      ...(multipart ? {} : { "Content-Type": "application/json" }),
      "X-Requested-With": "XMLHttpRequest",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...init.headers,
    },
  });
}
export async function refreshSession(): Promise<User> {
  if (publicMode || appStore.getSnapshot().user?.public_access) {
    clearSession();
    throw new ApiError("请选择公司重新进入", 401);
  }
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const result = await decode(
        await send("/auth/refresh", {
          method: "POST",
          body: JSON.stringify({ client: "web" }),
        }),
        sessionSchema,
      );
      appStore.dispatch({
        type: "session",
        accessToken: result.access_token,
        user: result.user,
      });
      return result.user;
    } catch (error) {
      clearSession();
      throw error;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}
export async function login(
  company_code: string,
  username: string,
  password: string,
) {
  const result = await decode(
    await send("/auth/login", {
      method: "POST",
      body: JSON.stringify({ company_code, username, password, client: "web" }),
    }),
    sessionSchema,
  );
  appStore.dispatch({
    type: "session",
    accessToken: result.access_token,
    user: result.user,
  });
  return result.user;
}
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  return decode(await authorizedSend(path, init), schema);
}
async function authorizedSend(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const sentToken = getToken();
  let response = await send(path, init);
  if (response.status === 401) {
    if (publicMode || appStore.getSnapshot().user?.public_access) {
      if (wikiMode) {
        if (getToken() === sentToken)
          await enterWiki().catch((error) => {
            clearSession();
            throw error;
          });
      } else if (passwordRequired) {
        if (getToken() === sentToken) clearSession();
        throw new ApiError("会话已到期，请重新输入访问密码", 401);
      }
      if (!wikiMode && getToken() === sentToken)
        await enterCompany().catch((error) => {
          clearSession();
          throw error;
        });
    } else if (getToken() === sentToken) await refreshSession();
    response = await send(path, init);
    if (response.status === 401) clearSession();
  }
  return response;
}
export async function upload<T>(
  path: string,
  schema: z.ZodType<T>,
  body: FormData,
): Promise<T> {
  return decode(await authorizedSend(path, { method: "POST", body }), schema);
}
export async function logout() {
  if (publicMode || appStore.getSnapshot().user?.public_access) {
    clearSession();
    return;
  }
  await request("/auth/logout", z.unknown(), "POST", { client: "web" });
  clearSession();
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}
