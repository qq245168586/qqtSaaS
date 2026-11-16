import { z } from 'zod';
import Decimal from 'decimal.js';
export const id = z.string().regex(/^[1-9]\d{0,19}$/, 'ID 必须为正整数字符串');
export const statuses = [
  'todo',
  'doing',
  'waiting_ship',
  'shipped',
  'delivered',
  'canceled',
] as const;
export type Status = (typeof statuses)[number];
export function canTransition(from: Status, to: Status): boolean {
  return (
    from === to ||
    (from !== 'canceled' &&
      (to === 'canceled' || statuses.indexOf(to) === statuses.indexOf(from) + 1))
  );
}
export const minute = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '时间需精确到分钟')
  .refine((s) => {
    const d = new Date(s.replace(' ', 'T') + ':00Z');
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 16).replace('T', ' ') === s;
  }, '无效时间');
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
export const orderAmount = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine((value) => /^\d{1,10}(\.\d{1,2})?$/.test(value), '金额必须为非负数，最多两位小数')
  .transform((value) => new Decimal(value).toFixed(2));
export const taskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    customer_name: z.string().trim().max(100).nullable().optional(),
    product_summary: z.string().trim().max(500).nullable().optional(),
    delivery_address: z.string().trim().max(500).nullable().optional(),
    order_amount: orderAmount.nullable().optional(),
    delivery_fee: orderAmount.default('0.00'),
    order_channel: z.string().trim().min(1).max(50).nullable().optional(),
    entry_progress: z.enum(['not_entered', 'entered']).default('not_entered'),
    content: z.string().max(20000).default(''),
    source_text: z.string().max(50000).default(''),
    category_id: id.nullable().default(null),
    department_id: id,
    assignee_employee_id: id,
    order_taker_employee_id: id.nullable().default(null),
    status: z.enum(statuses).default('todo'),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    expected_delivery_at: minute.nullable().default(null),
    task_type: z.enum(['order', 'production', 'shipping', 'change']).default('order'),
    note: z.string().max(10000).default(''),
  })
  .strict();
export const decimal = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine((s) => /^\d{1,10}(\.\d{1,2})?$/.test(s), '数量与金额必须为非负、最多两位小数');
export const itemSchema = z
  .object({
    product_name: z.string().trim().min(1).max(100),
    spec: z.string().max(100).default(''),
    unit: z.string().trim().min(1).max(20),
    quantity: decimal,
    unit_price: decimal,
    remark: z.string().max(255).default(''),
  })
  .strict();
export const deliverySchema = z
  .object({
    delivery_date: date,
    customer_id: id.nullable().default(null),
    customer_name_snapshot: z.string().trim().max(100),
    customer_address_snapshot: z.string().max(255).default(''),
    customer_phone_snapshot: z.string().max(30).default(''),
    maker_name: z.string().max(50).default(''),
    warehouse_name: z.string().max(50).default(''),
    sales_name: z.string().max(50).default(''),
    deliverer_name: z.string().max(50).default(''),
    is_draft: z
      .union([z.literal(0), z.literal(1), z.boolean()])
      .transform((v) => (v ? 1 : 0))
      .default(0),
    items: z.array(itemSchema).max(5),
  })
  .strict()
  .refine(
    (v) => v.is_draft === 1 || (v.customer_name_snapshot.length > 0 && v.items.length > 0),
    '正式送货单必须有客户和至少一行明细',
  );
export function amounts(items: ReadonlyArray<{ quantity: string; unit_price: string }>): {
  lines: string[];
  total: string;
} {
  const lines = items.map((i) =>
    new Decimal(i.quantity).mul(i.unit_price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
  );
  const total = lines.reduce((a, b) => a.plus(b), new Decimal(0));
  if (lines.some((n) => n.gt('9999999999.99')) || total.gt('9999999999.99'))
    throw new Error('金额超出 DECIMAL(12,2)');
  return { lines: lines.map((n) => n.toFixed(2)), total: total.toFixed(2) };
}
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(20),
});
