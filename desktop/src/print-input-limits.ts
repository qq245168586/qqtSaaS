import { useEffect, useRef, useState } from 'react';
import type { PrintTemplate } from '../electron/print-template-model';
import type { DeliveryNote } from './types';

const headFields = {
  customerName: ['customer', '客户名称：'],
  customerAddress: ['address', '收货地址：'],
  customerPhone: ['phone', '客户电话：'],
  maker: ['maker', '制单：'],
  keeper: ['keeper', '仓管：'],
  salesperson: ['salesperson', '业务：'],
  deliveryPerson: ['deliveryPerson', '送货：'],
} as const;
export type HeadInputField = keyof typeof headFields;
export type LineInputField =
  'productName' | 'specification' | 'unit' | 'quantity' | 'unitPrice' | 'remark';
type InputField = HeadInputField | LineInputField;
type RelatedLine = { productName?: string; specification?: string };
const labels: Record<InputField, string> = {
  customerName: '客户名称',
  customerAddress: '收货地址',
  customerPhone: '客户电话',
  maker: '制单人',
  keeper: '仓管',
  salesperson: '业务',
  deliveryPerson: '送货人',
  productName: '产品名称',
  specification: '规格',
  unit: '单位',
  quantity: '数量',
  unitPrice: '单价',
  remark: '备注',
};

// The real template is mounted off-screen at 1:1, with the same font, grid,
// padding, borders and labels as printing. No approximate character counts.
function fitsNode(node: HTMLElement): boolean {
  return (
    node.clientWidth > 0 &&
    node.clientHeight > 0 &&
    node.scrollWidth <= node.clientWidth + 1 &&
    node.scrollHeight <= node.clientHeight + 1
  );
}
export function longestFittingPrefix(value: string, fits: (text: string) => boolean): string {
  if (fits(value)) return value;
  // Grapheme boundaries preserve surrogate pairs, combining marks and emoji.
  const segments = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value),
    (s) => s.segment,
  );
  let low = 0,
    high = segments.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(segments.slice(0, mid).join(''))) low = mid;
    else high = mid - 1;
  }
  return segments.slice(0, low).join('');
}
export function usePrintInputLimits(template: PrintTemplate | null, note: DeliveryNote) {
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    setReady(false);
    void document.fonts.ready.then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [template]);
  function fieldTarget(field: InputField, row?: number) {
    if (row === undefined)
      return root.current?.querySelector<HTMLElement>(
        `[data-element="${headFields[field as HeadInputField]?.[0]}"] .tpl-text`,
      );
    const columns = [
      'sequence',
      'orderNumber',
      'productName',
      ...(template?.table.columnWeights.length === 9 ? ['specification'] : []),
      'unit',
      'quantity',
      'unitPrice',
      'amount',
      'remark',
    ];
    const column = columns.indexOf(
      field === 'specification' && template?.table.columnWeights.length === 8
        ? 'productName'
        : field,
    );
    return root.current?.querySelector<HTMLElement>(`[data-row="${row}"][data-column="${column}"]`);
  }
  function fits(field: InputField, value: string, row?: number, related?: RelatedLine): boolean {
    if (!template) return true;
    const node = fieldTarget(field, row);
    if (!node || !ready) return false; // never bypass a missing/unready measurement
    let text = value;
    if (row === undefined) text = headFields[field as HeadInputField][1] + value;
    else if (
      template?.table.columnWeights.length === 8 &&
      (field === 'productName' || field === 'specification')
    ) {
      const name =
        field === 'productName' ? value : (related?.productName ?? note.items[row]?.name ?? '');
      const spec =
        field === 'specification'
          ? value
          : (related?.specification ?? note.items[row]?.specification ?? '');
      text = [name, spec].filter(Boolean).join(' ');
    } else if (field === 'quantity' || field === 'unitPrice') text = String(Number(value) || 0);
    else if (field === 'unit') text = value || '个';
    const original = node.textContent;
    try {
      node.textContent = text;
      return fitsNode(node);
    } finally {
      node.textContent = original;
    }
  }
  function reject(message: string) {
    setMessage(message);
  }
  function limit(
    field: InputField,
    value: string,
    previous: string,
    row?: number,
    related?: RelatedLine,
  ): string {
    if (
      (field === 'quantity' || field === 'unitPrice') &&
      value &&
      (!Number.isFinite(Number(value)) || Number(value) < 0)
    ) {
      reject(`${labels[field]}必须是有效的非负数，本次输入未接受。`);
      return previous;
    }
    if (!template) return value;
    if (!ready) {
      reject('正在加载模板字体，请稍后输入。');
      return previous;
    }
    if (fits(field, value, row, related)) {
      setMessage('');
      return value;
    }
    const label = `${row === undefined ? '' : `第 ${row + 1} 行`}${labels[field]}`;
    if (field === 'quantity' || field === 'unitPrice') {
      reject(`${label}超出模板空间，本次输入未接受；不会截断数字或改变金额，请加宽对应列。`);
      return previous;
    }
    const result = longestFittingPrefix(value, (candidate) => fits(field, candidate, row, related));
    reject(
      `${label}已达到模板容量，超出的文字未录入。需要更长内容时，请放大模板元素或调整字号、行高。`,
    );
    return result;
  }
  function errors(): string[] {
    if (!template) return [];
    if (!ready || !root.current) return ['模板尚未加载完成'];
    const result: string[] = [];
    Object.keys(headFields).forEach((key) => {
      const field = key as HeadInputField;
      if (!fits(field, note[field] || '')) result.push(labels[field]);
    });
    note.items.forEach((item, row) => {
      if (!item.name.trim()) return;
      const values = {
        productName: item.name,
        specification: item.specification || '',
        unit: item.unit,
        quantity: String(item.quantity),
        unitPrice: String(item.unitPrice),
        remark: item.remark || '',
      };
      Object.entries(values).forEach(([field, value]) => {
        if (!fits(field as LineInputField, value, row))
          result.push(`第 ${row + 1} 行${labels[field as LineInputField]}`);
      });
      const amount = root.current?.querySelector<HTMLElement>(
        `[data-row="${row}"][data-column="${template?.table.columnWeights.length === 9 ? 7 : 6}"]`,
      );
      if (amount && !fitsNode(amount)) result.push(`第 ${row + 1} 行金额`);
    });
    for (const [id, label] of [
      ['number', '自动单号'],
      ['date', '日期'],
      ['total', '金额合计'],
    ]) {
      const node = root.current.querySelector<HTMLElement>(
        `[data-element="${id}"] ${id === 'total' ? '.tpl-total-content' : '.tpl-text'}`,
      );
      // Flex totals have line-height:1; a span's glyph descent may extend its
      // line box while still fitting comfortably inside the enclosing element.
      if (node && !fitsNode(node)) result.push(label);
    }
    return result;
  }
  return { root, ready: !template || ready, message, reject, fits, limit, errors };
}
