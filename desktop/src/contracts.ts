import { z } from 'zod';
export const userSchema = z.object({
  id: z.string(),
  company_id: z.string(),
  company_code: z.enum(['tri', 'tmy']),
  username: z.string(),
  real_name: z.string(),
  role: z.enum(['boss', 'admin', 'employee']),
  must_change_password: z.union([z.boolean(), z.number()]).transform(Boolean),
  public_access: z.boolean().optional(),
});
export type User = z.infer<typeof userSchema>;
export const sessionSchema = z.object({ access_token: z.string(), user: userSchema });
export type Session = z.infer<typeof sessionSchema>;
export const states = {
  todo: '未开始',
  doing: '进行中',
  waiting_ship: '待发货',
  shipped: '已发货',
  delivered: '已交付',
  canceled: '已取消',
} as const;
export type Status = keyof typeof states;
export const companyMatchSchema = z.object({
  source: z.enum(['learned', 'default', 'fallback']),
  reason: z.string(),
  confidence: z.number().optional(),
  keyword: z.string().nullish(),
  sample_count: z.number().optional(),
  agreement: z.number().optional(),
});
export const deliveryLinkSchema = z.object({
  id: z.string(),
  note_number: z.string().nullish(),
  delivery_date: z.string().optional(),
  is_draft: z.union([z.boolean(), z.number()]).optional(),
});
export const channelSuggestionsSchema = z.object({
  default_channel: z.string(),
  items: z.array(z.object({ name: z.string(), usage_count: z.number(), last_used_at: z.string() })),
});
export const taskSchema = z.object({
  customer_name: z.string().nullish(),
  product_summary: z.string().nullish(),
  delivery_address: z.string().nullish(),
  order_amount: z.union([z.string(), z.number()]).nullish(),
  delivery_fee: z.union([z.string(), z.number()]).default('0.00'),
  order_channel: z.string().nullish(),
  entry_progress: z.enum(['not_entered', 'entered']).default('not_entered'),
  id: z.string(),
  created_at: z.string().nullish(),
  company_code: z.enum(['tri', 'tmy']).optional(),
  company_name: z.string().optional(),
  company_match: companyMatchSchema.optional(),
  delivery_note_count: z.coerce.number().optional(),
  delivery_notes: z.array(deliveryLinkSchema).optional(),
  title: z.string(),
  content: z.string().nullish(),
  source_text: z.string().nullish(),
  category_id: z.string().nullish(),
  department_id: z.string().nullish(),
  assignee_employee_id: z.string().nullish(),
  order_taker_employee_id: z.string().nullish(),
  category_name: z.string().nullish(),
  department_name: z.string().nullish(),
  assignee_name: z.string().nullish(),
  order_taker_name: z.string().nullish(),
  status: z.enum(['todo', 'doing', 'waiting_ship', 'shipped', 'delivered', 'canceled']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  expected_delivery_at: z.string().nullish(),
  task_type: z.enum(['order', 'production', 'shipping', 'change']),
  note: z.string().nullish(),
});
export type Task = z.infer<typeof taskSchema>;
export type TaskInput = Omit<
  Task,
  | 'id'
  | 'created_at'
  | 'company_name'
  | 'category_name'
  | 'department_name'
  | 'assignee_name'
  | 'order_taker_name'
  | 'delivery_note_count'
  | 'delivery_notes'
>;
export const resourceSchema = z.object({
  left_on: z.string().nullish(),
  id: z.string(),
  company_code: z.enum(['tri', 'tmy']).optional(),
  company_name: z.string().optional(),
  name: z.string(),
  code: z.string().nullish(),
  sort: z.number().optional(),
  active: z.union([z.number(), z.boolean()]).optional(),
  created_at: z.string().optional(),
  department_id: z.string().nullish(),
  status: z.string().optional(),
  category_id: z.string().nullish(),
  address: z.string().nullish(),
  phone: z.string().nullish(),
  contact: z.string().nullish(),
  spec: z.string().nullish(),
  unit: z.string().optional(),
  default_price: z.union([z.string(), z.number()]).optional(),
  role_type: z.string().optional(),
});
export type Resource = z.infer<typeof resourceSchema>;
export const imageSchema = z.object({
  id: z.string(),
  oss_url: z.string().optional(),
  url: z.string().optional(),
  thumbnail_url: z.string().optional(),
  file_name: z.string().optional(),
});
export type TaskImage = z.infer<typeof imageSchema>;
export const lineSchema = z.object({
  id: z.string().optional(),
  product_id: z.string().nullish(),
  product_name: z.string(),
  spec: z.string().nullish(),
  unit: z.string(),
  quantity: z.union([z.string(), z.number()]),
  unit_price: z.union([z.string(), z.number()]),
  remark: z.string().nullish(),
});
export const deliverySchema = z.object({
  id: z.string(),
  created_at: z.string().nullish(),
  company_code: z.enum(['tri', 'tmy']).optional(),
  company_name: z.string().optional(),
  note_number: z.string().nullish(),
  delivery_date: z.string(),
  customer_id: z.string().nullish(),
  customer_name_snapshot: z.string(),
  customer_address_snapshot: z.string().nullish(),
  customer_phone_snapshot: z.string().nullish(),
  maker_name: z.string().nullish(),
  warehouse_name: z.string().nullish(),
  sales_name: z.string().nullish(),
  deliverer_name: z.string().nullish(),
  source_task_id: z.string().nullish(),
  source_task: z.object({ id: z.string(), title: z.string() }).nullish(),
  is_draft: z.union([z.boolean(), z.number()]),
  printed_at: z.string().nullish(),
  total_amount: z.union([z.string(), z.number()]).optional(),
  items: z.array(lineSchema).default([]),
});
export type Delivery = z.infer<typeof deliverySchema>;
export type DeliveryInput = Omit<
  Delivery,
  | 'id'
  | 'created_at'
  | 'company_name'
  | 'note_number'
  | 'printed_at'
  | 'total_amount'
  | 'source_task'
>;
const personnelHabitSchema = z.object({
  name: z.string(),
  score: z.number(),
  usage_count: z.number(),
  customer_matches: z.number(),
  product_matches: z.number(),
  last_used_at: z.string(),
});
const personnelDefaultsSchema = z.object({
  maker_name: z.string().nullable(),
  warehouse_name: z.string().nullable(),
  sales_name: z.string().nullable(),
  deliverer_name: z.string().nullable(),
});
export const deliveryPersonnelSuggestionSchema = z.object({
  defaults: personnelDefaultsSchema,
  options: z.object({
    maker_name: z.array(personnelHabitSchema),
    warehouse_name: z.array(personnelHabitSchema),
    sales_name: z.array(personnelHabitSchema),
    deliverer_name: z.array(personnelHabitSchema),
  }),
});
export type DeliveryPersonnelSuggestion = z.infer<typeof deliveryPersonnelSuggestionSchema>;
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number(), page: z.number(), page_size: z.number() });
export function nextStates(status: Status): Status[] {
  const chain: Status[] = ['todo', 'doing', 'waiting_ship', 'shipped', 'delivered'];
  const next = chain[chain.indexOf(status) + 1];
  return status === 'canceled' ? ['canceled'] : [status, ...(next ? [next] : []), 'canceled'];
}
export function emptyTask(): TaskInput {
  return {
    title: '',
    content: '',
    source_text: '',
    entry_progress: 'not_entered',
    product_summary: '',
    delivery_address: '',
    delivery_fee: '0.00',
    category_id: null,
    department_id: null,
    assignee_employee_id: null,
    order_taker_employee_id: null,
    status: 'todo',
    priority: 'normal',
    expected_delivery_at: null,
    task_type: 'order',
    note: '',
  };
}
