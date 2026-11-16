import { z } from 'zod';
import { minute } from './validation';
export const todoFields = z
  .object({
    title: z.string().trim().min(1, '请填写待办事项').max(200),
    note: z.string().trim().max(2000).default(''),
    starts_at: minute,
    ends_at: minute,
    recurrence: z.enum(['once', 'monthly']),
    progress: z.union([z.literal(0), z.literal(100)], {
      errorMap: () => ({ message: '请选择未完成或已完成' }),
    }),
  })
  .strict();
export const todoCreate = todoFields.refine((v) => v.ends_at >= v.starts_at, {
  message: '截止时间不能早于开始时间',
  path: ['ends_at'],
});
export const todoUpdate = todoFields
  .extend({ version: z.number().int().positive() })
  .refine((v) => v.ends_at >= v.starts_at, {
    message: '截止时间不能早于开始时间',
    path: ['ends_at'],
  });
export function todoOverdue(progress: number, endsAt: string, current: string): boolean {
  return progress < 100 && endsAt.slice(0, 16) <= current.slice(0, 16);
}

// Treat the stored Beijing wall clock as UTC for arithmetic; no host-timezone/DST drift.
function minuteNumber(value: string): number {
  return Date.parse(value.slice(0, 16).replace(' ', 'T') + ':00Z');
}
export function restartTimes(startsAt: string, endsAt: string, current: string) {
  const duration = minuteNumber(endsAt) - minuteNumber(startsAt);
  if (!Number.isFinite(duration) || duration < 0) throw new Error('原待办起止时间无效');
  const end = new Date(minuteNumber(current) + duration);
  const ends = end.toISOString().slice(0, 16).replace('T', ' ');
  minute.parse(ends);
  return { starts_at: current.slice(0, 16), ends_at: ends };
}
export function monthlyTimes(anchorEnd: string, month: string) {
  const [year, m] = month.split('-').map(Number);
  const [anchorYear, anchorMonth, anchorDay] = anchorEnd.slice(0, 10).split('-').map(Number);
  const anchorLast = new Date(Date.UTC(anchorYear, anchorMonth, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const day = anchorDay === anchorLast ? last : Math.min(anchorDay, last);
  return {
    starts_at: `${month}-01 00:00`,
    ends_at: `${month}-${String(day).padStart(2, '0')} ${anchorEnd.slice(11, 16)}`,
  };
}
