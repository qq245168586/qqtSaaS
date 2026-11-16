import { z } from 'zod';
import { deliverySchema, taskSchema, emptyTask, type Task, type DeliveryInput } from './contracts';
export const assistantModules = ['auto', 'retail', 'delivery', 'schedule', 'todo'] as const;
export type AssistantModule = (typeof assistantModules)[number];
export const assistantLabels = {
  auto: '自动判断',
  retail: '零售订单',
  delivery: '送货单',
  schedule: '员工排班',
  todo: '待办事项',
};
export const scheduleDraftSchema = z.object({
  employee_id: z.string().nullable(),
  employee_name: z.string(),
  work_date: z.string().nullable(),
  shift_kind: z.enum(['work', 'rest', 'comp_leave']),
  start_time: z.string().nullable(),
  overtime_minutes: z.number().int().nonnegative(),
  timeoff_minutes: z.number().int().nonnegative(),
  note: z.string(),
});
export type ScheduleDraft = z.infer<typeof scheduleDraftSchema>;
export const todoDraftSchema = z.object({
  recurrence: z.enum(['once', 'monthly']).default('once'),
  title: z.string(),
  note: z.string(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  progress: z
    .number()
    .int()
    .min(0)
    .max(100)
    .transform(() => 0),
});
const common = { warnings: z.array(z.string()), source_text: z.string() };
export const assistantResponseSchema = z.object({
  clarification: z.string(),
  items: z
    .array(
      z.discriminatedUnion('module', [
        z.object({ ...common, module: z.literal('todo'), value: todoDraftSchema }),
        z.object({
          ...common,
          module: z.literal('retail'),
          value: taskSchema
            .omit({ id: true })
            .extend({ status: z.literal('todo').default('todo') }),
        }),
        z.object({
          ...common,
          module: z.literal('delivery'),
          value: deliverySchema.omit({ id: true }),
        }),
        z.object({ ...common, module: z.literal('schedule'), value: scheduleDraftSchema }),
      ]),
    )
    .max(50),
});
export type AssistantDraft = (
  | { module: 'retail'; value: Omit<Task, 'id'> | Task }
  | { module: 'delivery'; value: DeliveryInput }
  | { module: 'schedule'; value: ScheduleDraft }
  | { module: 'todo'; value: z.infer<typeof todoDraftSchema> }
) & { key: string; warnings: string[]; source_text: string; saved: boolean };
export interface AssistantState {
  text: string;
  module: AssistantModule;
  drafts: AssistantDraft[];
  clarification: string;
}
export function emptyAssistant(): AssistantState {
  return { text: '', module: 'auto', drafts: [], clarification: '' };
}
export function assistantDrafts(
  response: z.infer<typeof assistantResponseSchema>,
  key: () => string,
): AssistantDraft[] {
  return response.items.map((item) =>
    item.module === 'retail'
      ? {
          ...item,
          key: key(),
          saved: false,
          value: { ...emptyTask(), ...item.value, status: 'todo' },
        }
      : { ...item, key: key(), saved: false },
  );
}
export function assistantSummary(draft: AssistantDraft): {
  title: string;
  details: string;
  date: string;
} {
  if (draft.module === 'todo')
    return {
      title: draft.value.title,
      details: `${draft.value.recurrence === 'monthly' ? '月度任务' : '一次性任务'} · 状态：${draft.value.progress === 100 ? '已完成' : '未完成'}${draft.value.note ? ' · ' + draft.value.note : ''}`,
      date: `${draft.value.starts_at || '待补开始时间'} → ${draft.value.ends_at || '待补截止时间'}`,
    };
  if (draft.module === 'retail')
    return {
      title: draft.value.title,
      details: draft.value.content ?? '',
      date: draft.value.expected_delivery_at ?? '待补交付日期',
    };
  if (draft.module === 'delivery')
    return {
      title: draft.value.customer_name_snapshot || '待填写客户',
      details: draft.value.items
        .map(
          (line) =>
            `${line.product_name} ${line.quantity || '待填数量'}${line.unit} × ${line.unit_price === '' ? '待填单价' : line.unit_price}元`,
        )
        .join('；'),
      date: draft.value.delivery_date || '待补送货日期',
    };
  return {
    title: draft.value.employee_name || '待选择员工',
    details: `${{ work: '工作', rest: '例休', comp_leave: '调休' }[draft.value.shift_kind]}${draft.value.start_time ? ' · ' + draft.value.start_time + ' 开始' : ''} · 加班 ${draft.value.overtime_minutes / 60}小时 · 调休 ${draft.value.timeoff_minutes / 60}小时`,
    date: draft.value.work_date || '待补排班日期',
  };
}
