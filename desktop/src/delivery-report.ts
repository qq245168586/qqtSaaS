import Decimal from 'decimal.js';
import { z } from 'zod';
import { deliverySchema, lineSchema, type Resource } from './contracts';
import { companies } from './types';
import { matchesText } from './search';

// Read saved line amounts without changing the delivery editor's input contract.
export const reportNoteSchema = deliverySchema.extend({
  items: z.array(lineSchema.extend({ amount: z.union([z.string(), z.number()]).nullish() })),
});
export type ReportNote = z.infer<typeof reportNoteSchema>;
export type ReportMode = 'details' | 'customers' | 'categories' | 'products' | 'notes';
export interface ReportFilters {
  start: string;
  end: string;
  company: 'all' | 'tri' | 'tmy';
  customers: string[];
  category: string;
  keyword: string;
  products: string[];
  productRelation: 'include' | 'exclude';
  productLogic: 'all' | 'any';
  mode: ReportMode;
}
export interface ReportSnapshot {
  start: string;
  end: string;
  notes: ReportNote[];
  customers: Resource[];
  categories: Resource[];
}
export function defaultReportFilters(): ReportFilters {
  const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const [year, month] = date.split('-').map(Number);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return {
    start: date.slice(0, 7) + '-01',
    end,
    company: 'all',
    customers: [],
    category: '',
    keyword: '',
    products: [],
    productRelation: 'include',
    productLogic: 'any',
    mode: 'details',
  };
}
export const reportModes: Record<ReportMode, string> = {
  details: '销售明细（对账）',
  customers: '按客户汇总',
  categories: '按分类汇总',
  products: '按产品汇总',
  notes: '按单据汇总',
};
type Cell = string;
export interface ReportColumn {
  key: string;
  title: string;
  numeric?: boolean;
}
export interface ReportRow {
  key: string;
  cells: Record<string, Cell>;
}
export interface ReportTotal {
  company: string;
  customer?: string;
  count: number;
  amount: string;
}
export interface DeliveryReport {
  partialNoteCount: number;
  omittedItemCount: number;
  categoryLabel: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  noteCount: number;
  itemCount: number;
  total: string;
  lineTotal: string;
  quantity: string;
  companies: ReportTotal[];
  customers: ReportTotal[];
}
const titles: Record<string, string> = {
  company: '公司',
  date: '送货日期',
  number: '送货单号',
  customer: '客户名称',
  product: '商品名称',
  spec: '规格',
  unit: '单位',
  quantity: '数量',
  price: '单价',
  amount: '金额',
  note_amount: '单据金额',
  remark: '备注',
  category: '客户分类',
  note_count: '单据数',
  item_count: '品项数',
  customer_count: '客户数',
  last_date: '最后送货日期',
};
const modeKeys: Record<ReportMode, string[]> = {
  details: [
    'company',
    'date',
    'number',
    'customer',
    'product',
    'spec',
    'unit',
    'quantity',
    'price',
    'amount',
    'note_amount',
    'remark',
  ],
  notes: ['company', 'date', 'number', 'customer', 'category', 'item_count', 'quantity', 'amount'],
  customers: [
    'company',
    'customer',
    'category',
    'note_count',
    'item_count',
    'quantity',
    'amount',
    'last_date',
  ],
  categories: [
    'company',
    'category',
    'customer_count',
    'note_count',
    'item_count',
    'quantity',
    'amount',
  ],
  products: ['company', 'product', 'spec', 'unit', 'note_count', 'quantity', 'amount'],
};
const numericKeys = new Set([
  'price',
  'amount',
  'note_amount',
  'note_count',
  'item_count',
  'customer_count',
]);
export const normalizeCustomer = (value: string) =>
  value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
export function validateReportDates(start: string, end: string) {
  for (const value of [start, end]) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value
    )
      throw new Error('请选择有效的开始和结束日期');
  }
  if (start > end) throw new Error('开始日期不能晚于结束日期');
}
function decimal(value: string | number | undefined | null, label: string): Decimal {
  if (value === null || value === undefined || String(value).trim() === '')
    throw new Error(`${label}缺失，请检查原送货单`);
  try {
    const amount = new Decimal(value);
    if (!amount.isFinite()) throw new Error();
    return amount;
  } catch {
    throw new Error(`${label}不是有效数字，请检查原送货单`);
  }
}
function lineAmount(line: ReportNote['items'][number]) {
  return line.amount != null
    ? decimal(line.amount, '商品金额')
    : decimal(line.quantity, '数量').times(decimal(line.unit_price, '单价')).toDecimalPlaces(2);
}
function categoryOf(note: ReportNote, snapshot: ReportSnapshot): Resource | undefined {
  const customer = snapshot.customers.find((row) =>
    note.customer_id
      ? row.id === note.customer_id
      : row.company_code === note.company_code &&
        normalizeCustomer(row.name) === normalizeCustomer(note.customer_name_snapshot),
  );
  return snapshot.categories.find((row) => row.id === customer?.category_id);
}
function quantities(lines: ReportNote['items']): string {
  const units = new Map<string, Decimal>();
  for (const line of lines)
    units.set(
      line.unit,
      (units.get(line.unit) ?? new Decimal(0)).plus(decimal(line.quantity, '数量')),
    );
  return [...units].map(([unit, quantity]) => `${quantity.toString()} ${unit}`).join(' / ');
}
export function buildDeliveryReport(
  snapshot: ReportSnapshot,
  filters: ReportFilters,
): DeliveryReport {
  validateReportDates(filters.start, filters.end);
  if (snapshot.start !== filters.start || snapshot.end !== filters.end)
    throw new Error('正在加载所选日期的送货单');
  const selectedCustomers = filters.customers.map(normalizeCustomer).filter(Boolean);
  const products = filters.products.map((value) => value.trim()).filter(Boolean);
  const filteringProducts = products.length > 0;
  let partialNoteCount = 0;
  let omittedItemCount = 0;
  const notes = snapshot.notes
    .filter((note) => {
      if (note.is_draft || note.delivery_date < filters.start || note.delivery_date > filters.end)
        return false;
      if (filters.company !== 'all' && note.company_code !== filters.company) return false;
      // Customer IDs differ between companies: match the saved name across both catalogs.
      if (
        selectedCustomers.length &&
        !selectedCustomers.some((name) => matchesText(note.customer_name_snapshot, name))
      )
        return false;
      const category = categoryOf(note, snapshot);
      if (
        filters.category &&
        (filters.category === 'uncategorized'
          ? Boolean(category)
          : category?.id !== filters.category)
      )
        return false;
      return (
        !filters.keyword.trim() ||
        matchesText(
          [
            note.customer_name_snapshot,
            note.note_number,
            ...note.items.flatMap((line) => [line.product_name, line.spec]),
          ].join(' '),
          filters.keyword,
        )
      );
    })
    .flatMap((note) => {
      if (!filteringProducts) return [note];
      const items = note.items.filter((line) => {
        const matches = (value: string) => matchesText(line.product_name, value);
        const matched =
          filters.productLogic === 'all' ? products.every(matches) : products.some(matches);
        return filters.productRelation === 'include' ? matched : !matched;
      });
      omittedItemCount += note.items.length - items.length;
      if (!items.length) return [];
      if (items.length === note.items.length) return [note];
      partialNoteCount++;
      // Partial documents use retained saved line amounts; never count the removed goods.
      // A full retained document still uses its original saved header amount.
      return [
        {
          ...note,
          items,
          total_amount: items
            .reduce((sum, line) => sum.plus(lineAmount(line)), new Decimal(0))
            .toFixed(2),
        },
      ];
    })
    .sort(
      (a, b) =>
        (a.company_code ?? '').localeCompare(b.company_code ?? '') ||
        a.customer_name_snapshot.localeCompare(b.customer_name_snapshot, 'zh-CN') ||
        a.delivery_date.localeCompare(b.delivery_date) ||
        (a.note_number ?? '').localeCompare(b.note_number ?? '') ||
        a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
  const rows: ReportRow[] = [];
  const companyTotals = new Map<string, ReportTotal>();
  const customerTotals = new Map<string, ReportTotal>();
  const groups = new Map<
    string,
    {
      cells: Record<string, string>;
      amount: Decimal;
      lines: ReportNote['items'];
      noteIds: Set<string>;
      customers: Set<string>;
    }
  >();
  let total = new Decimal(0);
  let lineTotal = new Decimal(0);
  const allLines: ReportNote['items'] = [];
  const addTotal = (
    map: Map<string, ReportTotal>,
    key: string,
    company: string,
    amount: Decimal,
    customer?: string,
  ) => {
    const previous = map.get(key);
    map.set(key, {
      company,
      customer,
      count: (previous?.count ?? 0) + 1,
      amount: new Decimal(previous?.amount ?? 0).plus(amount).toFixed(2),
    });
  };
  for (const note of notes) {
    if (!note.company_code)
      throw new Error(`送货单 ${note.note_number ?? note.id} 缺少公司，请补全后导出`);
    const company = companies[note.company_code].name;
    const category = categoryOf(note, snapshot)?.name ?? '未分类';
    const itemTotal = note.items.reduce((sum, line) => sum.plus(lineAmount(line)), new Decimal(0));
    const amount = decimal(note.total_amount, `送货单 ${note.note_number ?? note.id} 的金额`);
    total = total.plus(amount);
    lineTotal = lineTotal.plus(itemTotal);
    allLines.push(...note.items);
    addTotal(companyTotals, company, company, amount);
    addTotal(
      customerTotals,
      JSON.stringify([company, normalizeCustomer(note.customer_name_snapshot)]),
      company,
      amount,
      note.customer_name_snapshot,
    );
    const base = {
      company,
      customer: note.customer_name_snapshot,
      category,
      date: note.delivery_date,
      number: note.note_number ?? '',
      item_count: String(note.items.length),
      quantity: quantities(note.items),
      amount: amount.toFixed(2),
      last_date: note.delivery_date,
    };
    if (filters.mode === 'notes') rows.push({ key: note.id, cells: base });
    else if (filters.mode === 'details') {
      // A header total is present only on the first item row, never repeated per product.
      const lines = note.items.length ? note.items : [null];
      lines.forEach((line, index) =>
        rows.push({
          key: `${note.id}:${index}`,
          cells: {
            ...base,
            product: line?.product_name ?? '',
            spec: line?.spec ?? '',
            unit: line?.unit ?? '',
            quantity: line ? decimal(line.quantity, '数量').toString() : '',
            price: line ? decimal(line.unit_price, '单价').toString() : '',
            amount: line ? lineAmount(line).toFixed(2) : '',
            note_amount: index === 0 ? amount.toFixed(2) : '',
            remark: line?.remark ?? '',
          },
        }),
      );
    } else {
      const addGroup = (
        key: string,
        cells: Record<string, string>,
        lines: ReportNote['items'],
        groupAmount: Decimal,
      ) => {
        const group = groups.get(key) ?? {
          cells,
          amount: new Decimal(0),
          lines: [],
          noteIds: new Set<string>(),
          customers: new Set<string>(),
        };
        group.amount = group.amount.plus(groupAmount);
        group.lines.push(...lines);
        group.noteIds.add(note.id);
        group.customers.add(normalizeCustomer(note.customer_name_snapshot));
        if ((group.cells.last_date ?? '') < note.delivery_date)
          group.cells.last_date = note.delivery_date;
        groups.set(key, group);
      };
      if (filters.mode === 'products')
        for (const line of note.items)
          addGroup(
            JSON.stringify([company, line.product_name, line.spec ?? '', line.unit]),
            { ...base, product: line.product_name, spec: line.spec ?? '', unit: line.unit },
            [line],
            lineAmount(line),
          );
      else
        addGroup(
          JSON.stringify([
            company,
            filters.mode === 'customers' ? normalizeCustomer(base.customer) : category,
          ]),
          base,
          note.items,
          amount,
        );
    }
  }
  for (const [key, group] of groups)
    rows.push({
      key,
      cells: {
        ...group.cells,
        note_count: String(group.noteIds.size),
        customer_count: String(group.customers.size),
        item_count: String(group.lines.length),
        quantity:
          filters.mode === 'products'
            ? group.lines
                .reduce((sum, line) => sum.plus(decimal(line.quantity, '数量')), new Decimal(0))
                .toString()
            : quantities(group.lines),
        amount: group.amount.toFixed(2),
      },
    });
  return {
    partialNoteCount,
    omittedItemCount,
    categoryLabel:
      filters.category === 'uncategorized'
        ? '未分类'
        : (snapshot.categories.find((row) => row.id === filters.category)?.name ?? ''),
    columns: modeKeys[filters.mode].map((key) => ({
      key,
      title: titles[key],
      numeric:
        numericKeys.has(key) ||
        (filters.mode === 'details' && key === 'quantity') ||
        (filters.mode === 'products' && key === 'quantity'),
    })),
    rows,
    noteCount: notes.length,
    itemCount: allLines.length,
    total: total.toFixed(2),
    lineTotal: lineTotal.toFixed(2),
    quantity: quantities(allLines),
    companies: [...companyTotals.values()],
    customers: [...customerTotals.values()],
  };
}

export function productFilterDescription(filters: ReportFilters): string {
  const products = filters.products.map((value) => value.trim()).filter(Boolean);
  if (!products.length) return '';
  const relation = filters.productRelation === 'include' ? '包含' : '排除';
  const logic =
    products.length > 1
      ? `（${filters.productLogic === 'all' ? '与：同时命中全部词' : '或：命中任一词'}）`
      : '';
  return `商品${relation}：${products.join('、')}${logic}；部分单据按保留明细金额汇总`;
}

export function productFilterFileSuffix(filters: ReportFilters): string {
  const products = filters.products.map((value) => value.trim()).filter(Boolean);
  if (!products.length) return '';
  const relation = filters.productRelation === 'include' ? '包含' : '排除';
  const label = `${relation}${products.join(filters.productLogic === 'all' ? '与' : '或')}`;
  return '-' + label.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 45);
}

export function reportCsv(report: DeliveryReport, filters: ReportFilters): string {
  const quote = (value: string, numeric = false) => {
    // Customer-controlled text must not execute Excel formulas. Negative money stays numeric.
    const safe = !numeric && /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const width = report.columns.length;
  const row = (values: string[], numericIndices: number[] = []) =>
    Array.from({ length: width }, (_, index) =>
      quote(values[index] ?? '', numericIndices.includes(index)),
    ).join(',');
  const company =
    filters.company === 'all' ? '全部公司（分别汇总）' : companies[filters.company].name;
  const lines = [
    row([filters.mode === 'details' ? '销售明细对账单' : reportModes[filters.mode]]),
    row([
      `送货日期：${filters.start} 至 ${filters.end}；公司：${company}；客户：${filters.customers.join('、') || '全部'}${filters.keyword ? `；整单检索：${filters.keyword}` : ''}${filters.category ? `；客户分类：${report.categoryLabel}` : ''}${productFilterDescription(filters) ? '；' + productFilterDescription(filters) : ''}`,
    ]),
    row(report.columns.map((col) => col.title)),
    ...report.rows.map(({ cells }) =>
      report.columns.map((col) => quote(cells[col.key] ?? '', col.numeric)).join(','),
    ),
  ];
  const amountIndex = report.columns.findIndex(
    (col) => col.key === (filters.mode === 'details' ? 'note_amount' : 'amount'),
  );
  const totalRow = (label: string, amount: string) => {
    const values = Array<string>(width).fill('');
    values[0] = label;
    values[amountIndex] = amount;
    return row(values, [amountIndex]);
  };
  lines.push(row([]));
  for (const value of report.customers)
    lines.push(
      totalRow(`${value.company} / ${value.customer} 小计（${value.count} 单）`, value.amount),
    );
  for (const value of report.companies)
    lines.push(totalRow(`${value.company} 合计（${value.count} 单）`, value.amount));
  lines.push(totalRow(`对账总额（${report.noteCount} 单）`, report.total));
  if (filters.mode === 'details') {
    const values = Array<string>(width).fill('');
    values[0] = '商品明细金额合计';
    const index = report.columns.findIndex((col) => col.key === 'amount');
    values[index] = report.lineTotal;
    lines.push(row(values, [index]));
  }
  return '\uFEFF' + lines.join('\r\n');
}

export async function readReportPages(
  load: (page: number) => Promise<{ items: ReportNote[]; total: number }>,
): Promise<ReportNote[]> {
  const notes: ReportNote[] = [];
  const ids = new Set<string>();
  let expected: number | undefined;
  for (let page = 1; ; page++) {
    const result = await load(page);
    expected ??= result.total;
    if (expected !== result.total || expected < 0 || !Number.isInteger(expected))
      throw new Error('送货单在加载期间发生变化，请重新汇总');
    for (const note of result.items) {
      if (ids.has(note.id)) throw new Error('分页送货单发生变化，请重新汇总');
      ids.add(note.id);
      notes.push(note);
    }
    if (notes.length === expected) return notes;
    if (!result.items.length || notes.length > expected)
      throw new Error('送货单分页不完整，请重新汇总');
  }
}

export function reportFileName(filters: ReportFilters): string {
  const customer = (filters.customers.join('、') || '全部客户')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .slice(0, 26);
  const company = filters.company === 'all' ? '全部公司' : companies[filters.company].shortName;
  return `${filters.mode === 'details' ? '销售明细对账单' : reportModes[filters.mode]}-${company}-${customer}-${filters.start}-${filters.end}${productFilterFileSuffix(filters)}.csv`;
}
