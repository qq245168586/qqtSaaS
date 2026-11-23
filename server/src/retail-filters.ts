import { z } from 'zod';
import { id } from './validation';

const operator = z.enum(['include', 'exclude']);
const amount = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, '金额最多两位小数');
const employeeValues = z
  .array(z.union([id, z.literal('unset')]))
  .min(1)
  .max(100);
export const retailFiltersSchema = z
  .array(
    z.discriminatedUnion('field', [
      z
        .object({ field: z.literal('order_taker_employee_id'), operator, values: employeeValues })
        .strict(),
      z
        .object({ field: z.literal('assignee_employee_id'), operator, values: employeeValues })
        .strict(),
      z
        .object({
          field: z.literal('entry_progress'),
          operator,
          values: z
            .array(z.enum(['not_entered', 'entered']))
            .min(1)
            .max(2),
        })
        .strict(),
      z
        .object({
          field: z.literal('order_amount'),
          operator,
          min: amount.optional(),
          max: amount.optional(),
        })
        .strict(),
    ]),
  )
  .max(12)
  .superRefine((rules, ctx) => {
    rules.forEach((rule, index) => {
      if (rule.field !== 'order_amount') return;
      if (rule.min === undefined && rule.max === undefined)
        ctx.addIssue({ code: 'custom', path: [index], message: '请填写金额下限或上限' });
      if (rule.min !== undefined && rule.max !== undefined && Number(rule.min) > Number(rule.max))
        ctx.addIssue({ code: 'custom', path: [index], message: '金额下限不能大于上限' });
    });
  });

export function retailFilterPredicate(raw: unknown): { sql: string; params: unknown[] } {
  if (raw === undefined || raw === '') return { sql: '1=1', params: [] };
  const input = z
    .string()
    .max(16000)
    .transform((value, ctx): unknown => {
      try {
        return JSON.parse(value);
      } catch {
        ctx.addIssue({ code: 'custom', message: '过滤条件格式错误' });
        return z.NEVER;
      }
    })
    .pipe(retailFiltersSchema)
    .parse(raw);
  const params: unknown[] = [];
  const clauses = input.map((rule) => {
    // Column names only come from the strict field union; values are always bound parameters.
    const column = `t.${rule.field}`;
    let match: string;
    if (rule.field === 'order_amount') {
      const bounds = [`${column} IS NOT NULL`];
      if (rule.min !== undefined) {
        bounds.push(`${column}>=?`);
        params.push(rule.min);
      }
      if (rule.max !== undefined) {
        bounds.push(`${column}<=?`);
        params.push(rule.max);
      }
      match = `(${bounds.join(' AND ')})`;
    } else if (rule.field === 'entry_progress') {
      match = `COALESCE(NULLIF(${column},''),'not_entered') IN (${rule.values.map(() => '?').join(',')})`;
      params.push(...rule.values);
    } else {
      const ids = rule.values.filter((value) => value !== 'unset');
      const alternatives: string[] = [];
      if (rule.values.includes('unset')) alternatives.push(`${column} IS NULL`);
      if (ids.length) {
        alternatives.push(
          `(${column} IS NOT NULL AND ${column} IN (${ids.map(() => '?').join(',')}))`,
        );
        params.push(...ids);
      }
      match = `(${alternatives.join(' OR ')})`;
    }
    return rule.operator === 'exclude' ? `(NOT (${match}))` : `(${match})`;
  });
  return { sql: clauses.length ? clauses.join(' AND ') : '1=1', params };
}
