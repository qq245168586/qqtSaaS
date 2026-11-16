import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPages, monthRange, unifiedTasks } from '../src/unified-tasks';
import { deliverySchema, taskSchema } from '../src/contracts';

test('总览汇集零售与正式送货单，供应链按送货日期09:00，保留双向来源且不改原数据', () => {
  const task = taskSchema.parse({
    id: '1',
    title: '蛋糕订单',
    order_channel: '微信',
    status: 'todo',
    priority: 'normal',
    task_type: 'order',
    expected_delivery_at: '2026-09-30 10:30',
    created_at: '2026-09-29 16:00',
    company_code: 'tri',
  });
  const note = deliverySchema.parse({
    id: '1',
    customer_name_snapshot: '一乐食堂',
    delivery_date: '2026-09-30',
    created_at: '2026-09-28 11:30',
    is_draft: 0,
    source_task_id: '1',
    source_task: { id: '1', title: task.title },
    items: [],
  });
  const before = JSON.stringify([task, note]);
  const rows = unifiedTasks([task], [note, { ...note, id: '2', is_draft: true }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].key, 'supply:1');
  assert.equal(rows[0].scheduledAt, '2026-09-30 09:00');
  assert.equal(rows[0].createdAt, '2026-09-28 11:30');
  assert.match(rows[0].title, /一乐食堂.*2026-09-30/);
  assert.equal(rows[0].sourceTaskId, '1');
  assert.equal(rows[1].key, 'retail:1');
  assert.equal(rows[1].orderChannel, '微信');
  assert.equal(rows[0].orderChannel, undefined);
  assert.equal(rows[1].scheduledAt, '2026-09-30 10:30');
  assert.equal(JSON.stringify([task, note]), before);
  assert.equal(unifiedTasks([task], []).length, 1); // source deletion reflected without orphan projection
});

test('月份按自然月取送货日期边界，包含闰年', () => {
  assert.deepEqual(monthRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(monthRange('2026-09'), { start: '2026-09-01', end: '2026-09-30' });
  assert.throws(() => monthRange('2026-13'));
});

test('总览读取全部分页，失败不返回不完整的成功列表', async () => {
  const pages: number[] = [];
  const rows = await collectPages(async (page) => {
    pages.push(page);
    return {
      items: Array.from({ length: page < 3 ? 200 : 1 }, (_, index) => (page - 1) * 200 + index),
      total: 401,
    };
  });
  assert.equal(rows.length, 401);
  assert.deepEqual(pages, [1, 2, 3]);
  await assert.rejects(
    collectPages(async () => ({ items: [], total: 1 })),
    /刷新/,
  );
  await assert.rejects(
    collectPages(async () => {
      throw new Error('离线');
    }),
    /离线/,
  );
});
