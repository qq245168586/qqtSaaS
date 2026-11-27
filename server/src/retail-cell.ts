import { ConflictException } from '@nestjs/common';
import { z } from 'zod';
import { taskSchema, id, orderAmount } from './validation';
export const retailCellSchema = z
  .object({
    field: z.enum([
      'title',
      'product_summary',
      'delivery_address',
      'customer_name',
      'content',
      'note',
      'order_amount',
      'delivery_fee',
      'expected_delivery_at',
      'assignee_employee_id',
      'order_taker_employee_id',
      'priority',
      'order_channel',
    ]),
    value: z.union([z.string().max(20000), z.number().finite(), z.null()]),
    previous: z.union([z.string().max(20000), z.number().finite(), z.null()]),
  })
  .strict();
export type RetailCell = z.infer<typeof retailCellSchema>;
export function cellValue(field: RetailCell['field'], value: unknown): string {
  if (value == null || value === '') return '';
  if (field === 'order_amount' || field === 'delivery_fee') return orderAmount.parse(value);
  if (field === 'expected_delivery_at') return String(value).slice(0, 16).replace('T', ' ');
  return String(value);
}
export function cellPatch(
  input: RetailCell,
  current: Record<string, unknown>,
): Record<string, unknown> {
  if (cellValue(input.field, current[input.field]) !== cellValue(input.field, input.previous))
    throw new ConflictException('这一格已被其他人修改，请刷新后核对；你的输入仍保留');
  const value =
    input.field === 'assignee_employee_id' || input.field === 'order_taker_employee_id'
      ? id.nullable().parse(input.value)
      : taskSchema.shape[input.field].parse(input.value);
  return {
    [input.field === 'content' ? 'detail' : input.field === 'note' ? 'remark' : input.field]: value,
  };
}
