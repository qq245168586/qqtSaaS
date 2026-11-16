import { describe, expect, it } from "vitest";
import { createAppStore } from "../src/store";
import type { User } from "../src/models";
const user: User = {
  id: "1",
  company_id: "1",
  company_code: "tri",
  username: "test",
  real_name: "测试",
  role: "boss",
  must_change_password: false,
};
describe("RxJS scan + reducer共享状态", () => {
  it("同步分发与部门变化清空执行人", () => {
    const store = createAppStore();
    store.dispatch({ type: "filter", key: "assignee_employee_id", value: "7" });
    store.dispatch({ type: "filter", key: "department_id", value: "3" });
    expect(store.getSnapshot().filters.assignee_employee_id).toBe("");
    expect(store.getSnapshot().filters.department_id).toBe("3");
    store.destroy();
  });
  it("同账号刷新保留筛选，换公司清除前公司数据", () => {
    const store = createAppStore();
    store.dispatch({ type: "session", user, accessToken: "one" });
    store.dispatch({ type: "filter", key: "keyword", value: "私有订单" });
    store.dispatch({
      type: "catalog",
      catalog: {
        departments: [{ id: "1", name: "私有部门" }],
        employees: [],
        categories: [],
      },
    });
    store.dispatch({ type: "session", user, accessToken: "two" });
    expect(store.getSnapshot().filters.keyword).toBe("私有订单");
    store.dispatch({
      type: "session",
      user: { ...user, company_id: "2", company_code: "tmy" },
      accessToken: "three",
    });
    expect(store.getSnapshot().filters.keyword).toBe("");
    expect(store.getSnapshot().catalog.departments).toEqual([]);
    store.destroy();
  });
  it("退出清令牌与数据，订阅可释放", () => {
    const store = createAppStore();
    let count = 0;
    const unsubscribe = store.subscribe(() => count++);
    store.dispatch({ type: "session", user, accessToken: "memory-only" });
    const seen = count;
    unsubscribe();
    store.dispatch({ type: "logout" });
    expect(count).toBe(seen);
    expect(store.getSnapshot().accessToken).toBeNull();
    expect(store.getSnapshot().user).toBeNull();
    store.destroy();
  });
});
