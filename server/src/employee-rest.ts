import type { Row } from './db';

export const MONTHLY_REST_DAYS = 4;
export interface RestEmployee {
  id: string;
  rest_start_month: string;
  left_on: string | null;
}
export interface RestBalance {
  employee_id: string;
  start_month: string;
  opening_days: number;
  quota_days: number;
  taken_days: number;
  current_unused_days: number;
  carry_remaining_days: number;
  unused_days: number;
  planned_rest_days: number;
  planned_unused_days: number;
  excess_rest_days: number;
}
function nextMonth(month: string): string {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1))
    .toISOString()
    .slice(0, 7);
}

/** 例休按整天单独计量；月额度仅发放一次，结余由明细计算，不写第二套余额。 */
export function restBalances(
  employees: readonly RestEmployee[],
  entries: readonly Row[],
  month: string,
  today: string,
): RestBalance[] {
  return employees.map((employee) => {
    const actual = new Map<string, Set<string>>();
    const planned = new Set<string>();
    for (const row of entries) {
      if (
        String(row.employee_id) !== employee.id ||
        row.deleted_at ||
        row.shift_kind !== 'rest' ||
        Number(row.overtime_minutes) !== 0
      )
        continue;
      const date = String(row.work_date).slice(0, 10);
      if (
        date < `${employee.rest_start_month}-01` ||
        (employee.left_on && date >= employee.left_on)
      )
        continue;
      if (date > today) {
        if (date.startsWith(month)) planned.add(date);
      } else {
        const key = date.slice(0, 7);
        const days = actual.get(key) ?? new Set<string>();
        days.add(date);
        actual.set(key, days);
      }
    }
    let carry = 0;
    const result: RestBalance = {
      employee_id: employee.id,
      start_month: employee.rest_start_month,
      opening_days: 0,
      quota_days: 0,
      taken_days: 0,
      current_unused_days: 0,
      carry_remaining_days: 0,
      unused_days: 0,
      planned_rest_days: planned.size,
      planned_unused_days: 0,
      excess_rest_days: 0,
    };
    const cutoff = month < today.slice(0, 7) ? month : today.slice(0, 7);
    for (let period = employee.rest_start_month; period <= cutoff; period = nextMonth(period)) {
      const quota = employee.left_on && employee.left_on <= `${period}-01` ? 0 : MONTHLY_REST_DAYS;
      const taken = actual.get(period)?.size ?? 0;
      const remaining = Math.max(0, carry + quota - taken);
      if (period === month) {
        result.opening_days = carry;
        result.quota_days = quota;
        result.taken_days = taken;
        result.current_unused_days = Math.max(0, quota - taken);
        result.carry_remaining_days = Math.max(0, carry - Math.max(0, taken - quota));
        result.excess_rest_days = Math.max(0, taken - carry - quota);
      }
      carry = remaining;
    }
    // 查看未来月份只显示已发放的累计额度，不提前发放未来月份的四天。
    if (month > today.slice(0, 7)) {
      result.opening_days = carry;
      result.carry_remaining_days = carry;
    }
    result.unused_days = carry;
    result.planned_unused_days = Math.max(0, carry - planned.size);
    return result;
  });
}
