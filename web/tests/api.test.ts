import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
const user = {
  id: "1",
  company_id: "1",
  company_code: "tri",
  username: "u",
  real_name: "测试",
  role: "boss",
  must_change_password: false,
};
const success = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, message: "ok", data }), {
    status: 200,
  });
const unauthorized = () =>
  new Response(JSON.stringify({ code: 401, message: "失效", data: null }), {
    status: 401,
  });
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});
describe("认证请求", () => {
  it("并发401只刷新一次并携带HttpOnly cookie，之后重放请求", async () => {
    let refresh = 0;
    const mock = vi.fn(async (path: string, init: RequestInit) => {
      if (path.endsWith("/login"))
        return success({ access_token: "old", user });
      if (path.endsWith("/refresh")) {
        refresh++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(init.credentials).toBe("include");
        return success({ access_token: "new", user });
      }
      const headers = new Headers(init.headers);
      return headers.get("Authorization") === "Bearer new"
        ? success("done")
        : unauthorized();
    });
    vi.stubGlobal("fetch", mock);
    const api = await import("../src/api");
    await api.login("tri", "u", "p");
    expect(
      await Promise.all([
        api.request("/a", z.string()),
        api.request("/b", z.string()),
      ]),
    ).toEqual(["done", "done"]);
    expect(refresh).toBe(1);
  });
  it("第二次401不无限刷新，清除会话", async () => {
    let refresh = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path.endsWith("/refresh")) {
          refresh++;
          return success({ access_token: "bad", user });
        }
        return unauthorized();
      }),
    );
    const api = await import("../src/api");
    const observer = vi.fn();
    api.observeSession(observer);
    await expect(api.request("/tasks", z.array(z.unknown()))).rejects.toThrow(
      "失效",
    );
    expect(refresh).toBe(1);
    expect(observer).toHaveBeenLastCalledWith(null);
  });
  it("拒绝格式损坏的成功响应", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => success({ items: "wrong" })),
    );
    const api = await import("../src/api");
    await expect(api.request("/tasks", z.array(z.unknown()))).rejects.toThrow(
      "接口约定",
    );
  });
});
