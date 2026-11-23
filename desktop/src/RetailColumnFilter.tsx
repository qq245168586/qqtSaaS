import { useState } from 'react';
import { Button, InputNumber, Popover, Select } from 'antd';
import { FilterOutlined, CloseOutlined } from '@ant-design/icons';
import { z } from 'zod';

const operator = z.enum(['include', 'exclude']);
const values = z.array(z.string()).min(1, '请选择过滤值').max(100);
const amount = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, '金额最多两位小数');
export const retailFiltersSchema = z
  .array(
    z.discriminatedUnion('field', [
      z.object({ field: z.literal('order_taker_employee_id'), operator, values }).strict(),
      z.object({ field: z.literal('assignee_employee_id'), operator, values }).strict(),
      z
        .object({
          field: z.literal('entry_progress'),
          operator,
          values: z
            .array(z.enum(['not_entered', 'entered']))
            .min(1, '请选择录入状态')
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
  .max(12, '最多设置12条过滤条件')
  .superRefine((rules, ctx) => {
    rules.forEach((rule, index) => {
      if (rule.field !== 'order_amount') return;
      if (rule.min === undefined && rule.max === undefined)
        ctx.addIssue({ code: 'custom', path: [index], message: '请填写金额下限或上限' });
      if (rule.min !== undefined && rule.max !== undefined && Number(rule.min) > Number(rule.max))
        ctx.addIssue({ code: 'custom', path: [index], message: '金额下限不能大于上限' });
    });
  });
export type RetailFilterRule = z.infer<typeof retailFiltersSchema>[number];
type Field = RetailFilterRule['field'];
export function readRetailFilters(raw?: string): RetailFilterRule[] {
  if (!raw) return [];
  try {
    return retailFiltersSchema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}
function emptyRule(field: Field): RetailFilterRule {
  return field === 'order_amount'
    ? { field, operator: 'include' }
    : { field, operator: 'include', values: [] };
}
export function RetailColumnFilter({
  field,
  title,
  rules,
  choices,
  onApply,
}: {
  field: Field;
  title: string;
  rules: RetailFilterRule[];
  choices?: Array<{ label: string; value: string }>;
  onApply: (rules: RetailFilterRule[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [valueDropdown, setValueDropdown] = useState<number | null>(null);
  const [draft, setDraft] = useState<RetailFilterRule[]>([]);
  const [error, setError] = useState('');
  const count = rules.filter((rule) => rule.field === field).length;
  const update = (index: number, rule: RetailFilterRule) => {
    setDraft((current) => current.map((old, i) => (i === index ? rule : old)));
    setError('');
  };
  const apply = (current: RetailFilterRule[]) => {
    const result = retailFiltersSchema.safeParse([
      ...rules.filter((rule) => rule.field !== field),
      ...current,
    ]);
    if (!result.success) {
      setError(result.error.issues[0]?.message || '请检查条件');
      return;
    }
    onApply(result.data);
    setOpen(false);
  };
  return (
    <span className="retail-filter-heading">
      {title}
      <Popover
        trigger="click"
        placement="bottomRight"
        open={open}
        onOpenChange={(value) => {
          setValueDropdown(null);
          if (value) {
            const selected = rules.filter((rule) => rule.field === field);
            setDraft(selected.length ? selected : [emptyRule(field)]);
            setError('');
          }
          setOpen(value);
        }}
        content={
          <div className="retail-filter-panel" aria-label={`${title}过滤条件`}>
            <strong>{title}过滤</strong>
            <p>同一条多选值满足任一个；各条条件以“与”连接。</p>
            {draft.map((rule, index) => (
              <div className="retail-filter-rule" key={index}>
                {index > 0 && <span className="retail-filter-and">与</span>}
                <div className="retail-filter-rule-inputs">
                  <Select
                    aria-label={`条件${index + 1}关系`}
                    value={rule.operator}
                    onChange={(value: 'include' | 'exclude') =>
                      update(index, { ...rule, operator: value })
                    }
                    options={[
                      { value: 'include', label: '包含' },
                      { value: 'exclude', label: '排除' },
                    ]}
                  />
                  {rule.field === 'order_amount' ? (
                    <div className="retail-filter-amount-range">
                      <InputNumber
                        stringMode
                        min="0"
                        max="9999999999.99"
                        aria-label="金额下限"
                        placeholder="最低金额"
                        value={rule.min}
                        onChange={(value) =>
                          update(index, {
                            ...rule,
                            min: value == null || value === '' ? undefined : String(value),
                          })
                        }
                      />
                      <span>至</span>
                      <InputNumber
                        stringMode
                        min="0"
                        max="9999999999.99"
                        aria-label="金额上限"
                        placeholder="最高金额"
                        value={rule.max}
                        onChange={(value) =>
                          update(index, {
                            ...rule,
                            max: value == null || value === '' ? undefined : String(value),
                          })
                        }
                      />
                    </div>
                  ) : (
                    <Select
                      mode="multiple"
                      open={valueDropdown === index}
                      onOpenChange={(value) => setValueDropdown(value ? index : null)}
                      onSelect={() => setValueDropdown(null)}
                      onDeselect={() => setValueDropdown(null)}
                      aria-label={`条件${index + 1}值`}
                      placeholder="选择过滤值"
                      value={rule.values}
                      optionFilterProp="label"
                      maxTagCount="responsive"
                      options={
                        rule.field === 'entry_progress'
                          ? [
                              { value: 'not_entered', label: '未录入' },
                              { value: 'entered', label: '已录入' },
                            ]
                          : [{ value: 'unset', label: '未填写' }, ...(choices ?? [])]
                      }
                      onChange={(selected: string[]) =>
                        update(
                          index,
                          rule.field === 'entry_progress'
                            ? {
                                ...rule,
                                values: z.array(z.enum(['not_entered', 'entered'])).parse(selected),
                              }
                            : { ...rule, values: selected },
                        )
                      }
                    />
                  )}
                  <Button
                    type="text"
                    aria-label={`删除条件${index + 1}`}
                    icon={<CloseOutlined />}
                    onClick={() => setDraft((current) => current.filter((_, i) => i !== index))}
                  />
                </div>
              </div>
            ))}
            <Button
              type="link"
              disabled={draft.length + rules.filter((rule) => rule.field !== field).length >= 12}
              onClick={() => setDraft((current) => [...current, emptyRule(field)])}
            >
              与 · 添加条件
            </Button>
            {error && (
              <div className="retail-filter-error" role="alert">
                {error}
              </div>
            )}
            <div className="retail-filter-actions">
              <Button onClick={() => apply([])}>清除此列</Button>
              <Button type="primary" onClick={() => apply(draft)}>
                应用过滤
              </Button>
            </div>
          </div>
        }
      >
        <button
          type="button"
          className={`retail-filter-trigger${count ? ' is-active' : ''}`}
          aria-label={`${title}过滤${count ? `，${count}个条件` : ''}`}
          title={`${title}过滤`}
        >
          <FilterOutlined />
          {count > 0 && <small>{count}</small>}
        </button>
      </Popover>
    </span>
  );
}
