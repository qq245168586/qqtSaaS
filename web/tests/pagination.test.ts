import { beforeEach, describe, expect, it, vi } from "vitest";
import { allResources } from "../src/catalog";
import { loadTaskCounts } from "../src/task-counts";
vi.mock("../src/api", () => ({ request: vi.fn() }));
import { request } from "../src/api";
const mock = vi.mocked(request);
beforeEach(() => {
  mock.mockReset();
});
describe("跨页与看板统计", () => {
  it("选择器读取超过100条后的下一页，直至总数", async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({
      id: String(index + 1),
      name: `员工${index + 1}`,
    }));
    mock
      .mockResolvedValueOnce({
        items: first,
        total: 101,
        page: 1,
        page_size: 100,
      })
      .mockResolvedValueOnce({
        items: [{ id: "101", name: "最后员工" }],
        total: 101,
        page: 2,
        page_size: 100,
      });
    const result = await allResources("employees");
    expect(result).toHaveLength(101);
    expect(result.at(-1)?.name).toBe("最后员工");
    expect(mock.mock.calls[1]?.[0]).toContain("page=2");
  });
  it("空页但未达到总数时不假装完整", async () => {
    mock.mockResolvedValueOnce({
      items: [],
      total: 101,
      page: 1,
      page_size: 100,
    });
    await expect(allResources("employees")).rejects.toThrow("不完整");
  });
  it("看板从服务器total计数而非单页items，并保留月份分类筛选", async () => {
    mock.mockImplementation(async (path) => {
      const query = new URL(path, "https://example.test").searchParams;
      expect(query.get("category_id")).toBe("3");
      expect(query.get("month")).toBe("2026-09");
      return {
        items: [{}],
        total: query.get("status") === "todo" ? 43 : 7,
        page: 1,
        page_size: 1,
      };
    });
    const counts = await loadTaskCounts({
      month: "2026-09",
      category_id: "3",
      status: "",
    });
    expect(counts.todo).toBe(43);
    expect(counts.shipped).toBe(7);
    expect(mock).toHaveBeenCalledTimes(6);
  });
  it("显式状态筛选保留一致语义，其他列0条", async () => {
    mock.mockResolvedValue({ items: [], total: 88, page: 1, page_size: 1 });
    const counts = await loadTaskCounts({ status: "shipped" });
    expect(counts.shipped).toBe(88);
    expect(counts.todo).toBe(0);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
