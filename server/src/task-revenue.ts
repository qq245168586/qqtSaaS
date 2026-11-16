import { z } from 'zod';
import { db, rows, type Row } from './db';
import { companyFilter } from './company-scope';
import type { User } from './auth';
import { date, pageSchema } from './validation';

const selection = z
  .string()
  .max(12000)
  .transform((raw, context) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: '筛选格式无效' });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.string().max(100)).max(50));
export const revenueQuery = pageSchema
  .extend({
    start_date: date.optional(),
    end_date: date.optional(),
    source: z.enum(['all', 'retail', 'supply']).default('all'),
    customers: selection.optional(),
    channels: selection.optional(),
  })
  .refine(
    (value) => !value.start_date || !value.end_date || value.start_date <= value.end_date,
    '开始日期不能晚于结束日期',
  );

export function revenueBase(user: User): { sql: string; params: unknown[] } {
  const retail = companyFilter(user, 't.company_id');
  const supply = companyFilter(user, 'd.company_id');
  const own = user.role === 'employee' ? ' AND t.assignee_employee_id=?' : '';
  const params: unknown[] = [...retail.params, ...(own ? [user.employee_id ?? '0'] : [])];
  let sql = `SELECT t.id,'retail' source,t.title,COALESCE(t.customer_name,'') customer_name,
    COALESCE(t.order_channel,'') order_channel,t.order_amount amount,
    DATE(COALESCE(t.expected_delivery_at,t.created_at)) revenue_date,
    CASE WHEN t.expected_delivery_at IS NULL THEN 'created' ELSE 'delivery' END date_basis
    FROM tasks t WHERE ${retail.sql} AND t.deleted_at IS NULL AND t.status<>'canceled'${own}`;
  if (user.role !== 'employee') {
    sql += ` UNION ALL SELECT d.id,'supply' source,COALESCE(d.note_number,'送货单') title,
      d.customer_name_snapshot customer_name,'' order_channel,d.total_amount amount,
      d.delivery_date revenue_date,'delivery' date_basis FROM delivery_notes d
      WHERE ${supply.sql} AND d.deleted_at IS NULL AND d.is_draft=0 AND d.source_task_id IS NULL`;
    params.push(...supply.params);
  }
  return { sql, params };
}
export async function taskRevenue(user: User, query: Record<string, unknown>): Promise<Row> {
  const q = revenueQuery.parse(query);
  return db.transaction(async (manager) => {
    const read = (sql: string, params: unknown[]) => rows(sql, params, manager);
    const base = revenueBase(user);
    const where: string[] = ['1=1'];
    const params: unknown[] = [...base.params];
    if (q.start_date) {
      where.push('r.revenue_date>=?');
      params.push(q.start_date);
    }
    if (q.end_date) {
      where.push('r.revenue_date<=?');
      params.push(q.end_date);
    }
    if (q.source !== 'all') {
      where.push('r.source=?');
      params.push(q.source);
    }
    for (const [key, values] of [
      ['customer_name', q.customers],
      ['order_channel', q.channels],
    ] as const) {
      if (values?.length) {
        where.push(`r.${key} IN (${values.map(() => '?').join(',')})`);
        params.push(...values);
      }
    }
    if (q.channels?.length) where.push("r.source='retail'");
    const from = `FROM (${base.sql}) r WHERE ${where.join(' AND ')}`;
    const aggregate = `COUNT(*) task_count,SUM(CASE WHEN amount IS NULL THEN 1 ELSE 0 END) missing_amount_count,COALESCE(SUM(amount),0) total_amount`;
    const [totals] = await read(
      `SELECT ${aggregate},COALESCE(SUM(CASE WHEN source='retail' THEN amount ELSE 0 END),0) retail_amount,COALESCE(SUM(CASE WHEN source='supply' THEN amount ELSE 0 END),0) supply_amount ${from}`,
      params,
    );
    const items = await read(
      `SELECT * ${from} ORDER BY revenue_date DESC,id DESC,source LIMIT ? OFFSET ?`,
      [...params, q.page_size, (q.page - 1) * q.page_size],
    );
    const groups = await Promise.all(
      ['customer_name', 'order_channel', 'revenue_month'].map((key) => {
        const expression = key === 'revenue_month' ? 'SUBSTR(revenue_date,1,7)' : key;
        return read(
          `SELECT ${expression} name,${aggregate} ${from}${key === 'order_channel' ? " AND source='retail'" : ''} GROUP BY ${expression} ORDER BY ${key === 'revenue_month' ? 'name DESC' : 'total_amount DESC,name'}`,
          params,
        );
      }),
    );
    const options = await read(
      `SELECT DISTINCT customer_name,order_channel,source FROM (${base.sql}) options ORDER BY customer_name,order_channel`,
      base.params,
    );
    return {
      items,
      total: Number(totals.task_count),
      page: q.page,
      page_size: q.page_size,
      totals,
      by_customer: groups[0],
      by_channel: groups[1],
      by_month: groups[2],
      customers: [...new Set(options.map((row) => String(row.customer_name)))],
      channels: [
        ...new Set(
          options.filter((row) => row.source === 'retail').map((row) => String(row.order_channel)),
        ),
      ],
    };
  });
}
