import { z } from 'zod';

export function businessToday(): string {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}
export const businessDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      value >= '2000-01-01' &&
      value <= '2099-12-31' &&
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, '日期无效，请填写2000至2099年的真实日期');
export function employeeAvailable(
  employee: Record<string, unknown>,
  date = businessToday(),
): boolean {
  if (employee.deleted_at != null) return false;
  if (employee.left_on) return date < String(employee.left_on).slice(0, 10);
  return employee.status !== 'left';
}
export function standardEnd(start: string): { time: string; next_day: boolean } {
  const [hour, minute] = start.split(':').map(Number);
  const total = hour * 60 + minute + 540;
  return {
    time: `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`,
    next_day: total >= 1440,
  };
}
