import type { Delivery, Task } from './contracts';

export interface UnifiedTask {
  key: string;
  id: string;
  source: 'retail' | 'supply';
  orderChannel?: string | null;
  customer?: string | null;
  amount?: string | number | null;
  title: string;
  detail: string;
  company: string;
  scheduledAt: string | null;
  createdAt: string | null;
  person: string;
  sourceTaskId?: string;
  sourceTaskTitle?: string;
}

export function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('请选择有效月份');
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${last}` };
}

const companyName = (record: Task | Delivery) =>
  record.company_name ||
  (record.company_code === 'tri' ? '趣趣特' : record.company_code === 'tmy' ? '天美意' : '—');

export function unifiedTasks(tasks: Task[], notes: Delivery[]): UnifiedTask[] {
  const retail: UnifiedTask[] = tasks.map((task) => ({
    key: `retail:${task.id}`,
    orderChannel: task.order_channel,
    customer: task.customer_name,
    amount: task.order_amount,
    id: task.id,
    source: 'retail',
    title: task.title,
    detail: task.content || '',
    company: companyName(task),
    scheduledAt: task.expected_delivery_at || null,
    createdAt: task.created_at || null,
    person: task.assignee_name || '—',
  }));
  const supply: UnifiedTask[] = notes
    .filter((note) => !note.is_draft)
    .map((note) => ({
      key: `supply:${note.id}`,
      id: note.id,
      source: 'supply',
      customer: note.customer_name_snapshot,
      amount: note.total_amount,
      title: `${note.customer_name_snapshot} · ${note.delivery_date.slice(0, 10)} 送货`,
      detail: [
        note.note_number,
        note.items.map((item) => `${item.product_name} ${item.quantity}${item.unit}`).join('、'),
      ]
        .filter(Boolean)
        .join(' · '),
      company: companyName(note),
      scheduledAt: `${note.delivery_date.slice(0, 10)} 09:00`,
      createdAt: note.created_at || null,
      person: note.deliverer_name || '—',
      ...(note.source_task_id
        ? { sourceTaskId: note.source_task_id, sourceTaskTitle: note.source_task?.title }
        : {}),
    }));
  return [...retail, ...supply].sort(
    (a, b) =>
      (a.scheduledAt || '9999').localeCompare(b.scheduledAt || '9999') ||
      a.key.localeCompare(b.key, undefined, { numeric: true }),
  );
}

// Read every page, including months with more records than the server page limit.
export async function collectPages<T>(
  load: (page: number) => Promise<{ items: T[]; total: number }>,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const result = await load(page);
    items.push(...result.items);
    if (items.length >= result.total) return items;
    if (!result.items.length) throw new Error('列表数据已变化，请刷新后重试');
  }
}
