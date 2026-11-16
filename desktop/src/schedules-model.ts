import { z } from 'zod';
export const scheduleRowSchema = z.object({
  id: z.string(),
  employee_id: z.string(),
  work_date: z.string(),
  shift_kind: z.enum(['work', 'rest', 'comp_leave']),
  start_time: z.string().nullable(),
  overtime_minutes: z.number(),
  timeoff_minutes: z.number(),
  note: z.string(),
  version: z.number(),
  deleted_at: z.string().nullish(),
  standard_end: z.string().nullable(),
  end_next_day: z.boolean(),
});
export type ScheduleRow = z.infer<typeof scheduleRowSchema>;
export const scheduleSnapshotSchema = z.object({
  today: z.string(),
  month: z.string(),
  days: z.number().int().min(28).max(31),
  employees: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      department_id: z.string(),
      department_name: z.string().nullish(),
      status: z.string(),
      left_on: z.string().nullish(),
    }),
  ),
  items: z.array(scheduleRowSchema),
  balances: z.array(
    z.object({
      employee_id: z.string(),
      opening_minutes: z.number(),
      overtime_minutes: z.number(),
      timeoff_minutes: z.number(),
      balance_minutes: z.number(),
      planned_net_minutes: z.number(),
    }),
  ),
  rest_monthly_quota_days: z.number().int().positive().optional(),
  rest_balances: z
    .array(
      z.object({
        employee_id: z.string(),
        start_month: z.string(),
        opening_days: z.number().int().nonnegative(),
        quota_days: z.number().int().nonnegative(),
        taken_days: z.number().int().nonnegative(),
        current_unused_days: z.number().int().nonnegative(),
        carry_remaining_days: z.number().int().nonnegative(),
        unused_days: z.number().int().nonnegative(),
        planned_rest_days: z.number().int().nonnegative(),
        planned_unused_days: z.number().int().nonnegative(),
        excess_rest_days: z.number().int().nonnegative(),
      }),
    )
    .optional(),
});
export type ScheduleSnapshot = z.infer<typeof scheduleSnapshotSchema>;
export function displayMinutes(minutes: number): string {
  const n = Math.abs(minutes);
  return `${minutes < 0 ? '−' : minutes > 0 ? '+' : ''}${Math.floor(n / 60)}小时${n % 60 ? `${n % 60}分` : ''}`;
}
