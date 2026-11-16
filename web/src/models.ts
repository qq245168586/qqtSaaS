import { z } from "zod";
export const id = z.string().regex(/^\d+$/);
export const statuses = [
  "todo",
  "doing",
  "waiting_ship",
  "shipped",
  "delivered",
  "canceled",
] as const;
export type Status = (typeof statuses)[number];
export const statusLabels: Record<Status, string> = {
  todo: "未开始",
  doing: "进行中",
  waiting_ship: "待发货",
  shipped: "已发货",
  delivered: "已交付",
  canceled: "已取消",
};
export const priorities = ["low", "normal", "high", "urgent"] as const;
export const priorityLabels = {
  low: "低",
  normal: "普通",
  high: "高",
  urgent: "紧急",
};
export const userSchema = z.object({
  id,
  company_id: id,
  company_code: z.enum(["tri", "tmy"]),
  username: z.string(),
  real_name: z.string(),
  role: z.enum(["boss", "admin", "employee"]),
  public_access: z.boolean().optional(),
  must_change_password: z.union([z.boolean(), z.number()]).transform(Boolean),
});
export type User = z.infer<typeof userSchema>;
export const sessionSchema = z.object({
  access_token: z.string().min(1),
  user: userSchema,
});
export const resourceSchema = z.object({
  left_on: z.string().nullish(),
  id,
  company_id: id.optional(),
  company_code: z.enum(["tri", "tmy"]).optional(),
  code: z.enum(["tri", "tmy"]).optional(),
  name: z.string(),
  department_id: id.optional(),
  department_name: z.string().optional(),
  status: z.enum(["active", "left"]).optional(),
  phone: z.string().nullable().optional(),
  sort: z.number().optional(),
});
export type Resource = z.infer<typeof resourceSchema>;
export function validMinute(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    year < 1000
  )
    return false;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute
  );
}
export const taskFields = z.object({
  company_code: z.enum(["tri", "tmy"]).optional(),
  title: z.string().trim().min(1, "请输入任务标题").max(200),
  content: z.string().max(20000).default(""),
  source_text: z.string().max(50000).default(""),
  category_id: id.nullable().default(null),
  department_id: id,
  assignee_employee_id: id,
  status: z.enum(statuses),
  priority: z.enum(priorities),
  expected_delivery_at: z
    .string()
    .refine(validMinute, "请选择有效且精确到分钟的时间")
    .nullable(),
  task_type: z.enum(["order", "production", "shipping", "change"]),
  note: z.string().max(10000).default(""),
});
export type TaskInput = z.infer<typeof taskFields>;
export const deliveryNoteSummarySchema = z.object({
  id,
  source_task_id: id,
  note_number: z.string().nullable(),
  delivery_date: z.string(),
  is_draft: z.union([z.literal(0), z.literal(1)]),
  company_code: z.enum(["tri", "tmy"]),
  company_name: z.string(),
});
export const companyMatchSchema = z.object({
  source: z.enum(["learned", "default", "fallback"]),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  keyword: z.string().nullable(),
  sample_count: z.number().int().nonnegative(),
  agreement: z.number().min(0).max(1),
});
export const taskSchema = taskFields.extend({
  id,
  department_name: z.string().nullable().optional(),
  assignee_name: z.string().nullable().optional(),
  category_name: z.string().nullable().optional(),
  created_at: z.string().optional(),
  delivery_note_count: z.number().int().nonnegative().default(0),
  delivery_notes: z.array(deliveryNoteSummarySchema).default([]),
});
export type Task = z.infer<typeof taskSchema>;
export const draftSchema = taskFields
  .omit({ department_id: true, assignee_employee_id: true, status: true })
  .extend({
    department_id: id.nullable().optional(),
    assignee_employee_id: id.nullable().optional(),
    company_match: companyMatchSchema.optional(),
  });
export type Draft = z.infer<typeof draftSchema>;
export const imageSchema = z.object({
  id,
  task_id: id,
  file_name: z.string(),
  url: z.string().url(),
  thumbnail_url: z.string().url(),
});
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    page_size: z.number().int().positive(),
  });
export function nextStatuses(status: Status): Status[] {
  const index = statuses.indexOf(status);
  return status === "canceled"
    ? []
    : status === "delivered"
      ? ["canceled"]
      : [statuses[index + 1] ?? "canceled", "canceled"];
}
export const emptyTask = (): TaskInput => ({
  title: "",
  content: "",
  source_text: "",
  category_id: null,
  department_id: "",
  assignee_employee_id: "",
  status: "todo",
  priority: "normal",
  expected_delivery_at: null,
  task_type: "order",
  note: "",
});
