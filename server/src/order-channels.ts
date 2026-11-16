import { EntityManager } from 'typeorm';
import { rows, db } from './db';
import type { User } from './auth';
import { companyFilter } from './company-scope';

export const DEFAULT_ORDER_CHANNELS = ['微信', '小程序', '小红书', '大众点评'] as const;
export interface ChannelUsage {
  name: string;
  usage_count: number;
  last_used_at: string;
}
export function rankChannels(usage: ChannelUsage[]) {
  const merged = new Map<string, ChannelUsage>(
    DEFAULT_ORDER_CHANNELS.map((name) => [name, { name, usage_count: 0, last_used_at: '' }]),
  );
  for (const item of usage) {
    const name = item.name.trim();
    if (!name) continue;
    const previous = merged.get(name);
    merged.set(name, {
      name,
      usage_count: (previous?.usage_count ?? 0) + item.usage_count,
      last_used_at: [previous?.last_used_at ?? '', item.last_used_at].sort().at(-1)!,
    });
  }
  const items = [...merged.values()].sort(
    (a, b) => b.usage_count - a.usage_count || b.last_used_at.localeCompare(a.last_used_at),
  );
  return { default_channel: items[0].name, items };
}
export async function orderChannels(user: User, manager: EntityManager = db.manager) {
  const scope = companyFilter(user);
  const params: unknown[] = [...scope.params];
  let filter = `${scope.sql} AND deleted_at IS NULL AND order_channel IS NOT NULL AND TRIM(order_channel)<>''`;
  if (user.role === 'employee') {
    filter += ' AND assignee_employee_id=?';
    params.push(user.employee_id ?? '0');
  }
  const usage = await rows(
    `SELECT TRIM(order_channel) name,COUNT(*) usage_count,MAX(updated_at) last_used_at FROM tasks WHERE ${filter} GROUP BY TRIM(order_channel) ORDER BY usage_count DESC,last_used_at DESC,name`,
    params,
    manager,
  );
  return rankChannels(
    usage.map((item) => ({
      name: String(item.name),
      usage_count: Number(item.usage_count),
      last_used_at: String(item.last_used_at ?? ''),
    })),
  );
}
