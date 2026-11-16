import { z } from 'zod';
const base = 'https://114.215.185.184/api';
const envelope = z.object({ code: z.number(), data: z.unknown(), message: z.string() });
async function request(path: string, token = '', body?: object) {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(90000),
  });
  const result = envelope.parse(await response.json());
  if (!response.ok || result.code !== 0)
    throw new Error(`HTTP ${response.status}: ${result.message}`);
  return result.data;
}
async function main() {
  const { access_token } = z
    .object({ access_token: z.string() })
    .parse(await request('/auth/enter', '', { client: 'desktop' }));
  const record = z.object({
    id: z.string(),
    product_summary: z.string().nullish(),
    delivery_address: z.string().nullish(),
    order_amount: z.union([z.string(), z.number()]).nullish(),
    delivery_fee: z.union([z.string(), z.number()]).nullish(),
  });
  const page = z.object({ items: z.array(record), total: z.number() });
  const first = page.parse(await request('/tasks?page_size=200&page=1', access_token));
  const tasks = [...first.items];
  for (let n = 2; tasks.length < first.total; n++) {
    const next = page.parse(await request(`/tasks?page_size=200&page=${n}`, access_token));
    if (!next.items.length) throw new Error('任务分页不完整');
    tasks.push(...next.items);
  }
  let repaired = 0;
  for (const task of tasks) {
    if (task.product_summary && task.delivery_address) continue;
    await request(`/ai/retail-details/${task.id}`, access_token, {});
    const after = record.parse(await request(`/tasks/${task.id}`, access_token));
    if (
      String(after.order_amount) !== String(task.order_amount) ||
      String(after.delivery_fee) !== String(task.delivery_fee)
    )
      throw new Error(`订单 ${task.id} 金额变化，停止`);
    repaired++;
    console.log(
      JSON.stringify({
        id: task.id,
        product_present: !!after.product_summary,
        address_present: !!after.delivery_address,
        amounts_unchanged: true,
      }),
    );
  }
  console.log(JSON.stringify({ total: tasks.length, processed: repaired }));
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '修复失败');
  process.exitCode = 1;
});
