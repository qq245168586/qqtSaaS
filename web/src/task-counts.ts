import { z } from "zod";
import { request } from "./api";
import { pageSchema, statuses, type Status } from "./models";
export type TaskCounts = Record<Status, number>;
/** Count totals on the server instead of counting the currently loaded page. */
export async function loadTaskCounts(
  filters: Record<string, string>,
): Promise<TaskCounts> {
  const counts: TaskCounts = {
    todo: 0,
    doing: 0,
    waiting_ship: 0,
    shipped: 0,
    delivered: 0,
    canceled: 0,
  };
  await Promise.all(
    statuses.map(async (status) => {
      if (filters.status && filters.status !== status) return;
      const query = new URLSearchParams({ page: "1", page_size: "1" });
      for (const [key, value] of Object.entries(filters))
        if (value) query.set(key, value);
      query.set("status", status);
      const result = await request(`/tasks?${query}`, pageSchema(z.unknown()));
      counts[status] = result.total;
    }),
  );
  return counts;
}
