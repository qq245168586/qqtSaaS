import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import {
  buildDeliveryReport,
  normalizeCustomer,
  productFilterDescription,
  productFilterFileSuffix,
  type ReportFilters,
  type ReportSnapshot,
} from './delivery-report';
import { companies, type CompanyId } from './types';

// Retained column widths and formats from the two original 御牛纪202608 workbooks.
// Removed internal/tax columns are not recreated with fabricated values.
const formats = {
  tri: {
    summary: [28.6640625, 20, 8.83203125, 20.33203125],
    details: [
      14, 24.1640625, 35, 17.33203125, 15.5, 8.83203125, 12, 9.33203125, 13.1640625, 15.5, 35,
    ],
  },
  tmy: {
    summary: [36.83203125, 17.33203125, 8.83203125, 18.6640625],
    details: [
      14, 24.1640625, 28.6640625, 13.6640625, 15.5, 8.83203125, 12, 9.33203125, 13.33203125, 15.5,
      35,
    ],
  },
} satisfies Record<CompanyId, { summary: number[]; details: number[] }>;
const moneyFormat = '_(#,##0.00_);_(\\-#,##0.00_)';
const quantityFormat = '_(#,##0.00000_);_(\\-#,##0.00000_)';
const border: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  bottom: { style: 'thin' },
  left: { style: 'thin' },
  right: { style: 'thin' },
};
const detailColumns = [
  ['date', '单据日期'],
  ['number', '单据编号'],
  ['customer', '客户名称'],
  ['product', '商品名称'],
  ['spec', '规格'],
  ['unit', '单位'],
  ['quantity', '数量'],
  ['price', '单价'],
  ['amount', '金额'],
  ['note_amount', '单据金额'],
  ['remark', '备注'],
] as const;
const numericKeys = new Set(['quantity', 'price', 'amount', 'note_amount']);
type Value = string | number | null;
export interface DeliveryStatement {
  company: CompanyId;
  name: string;
  workbook: ExcelJS.Workbook;
}

function sheet(
  workbook: ExcelJS.Workbook,
  name: string,
  title: string,
  condition: string,
  headers: string[],
  widths: number[],
) {
  const result = workbook.addWorksheet(name);
  result.properties.defaultRowHeight = 15;
  result.properties.defaultColWidth = 8.83203125;
  widths.forEach((width, index) => {
    result.getColumn(index + 1).width = width;
  });
  result.mergeCells(1, 1, 1, headers.length);
  result.mergeCells(2, 1, 2, headers.length);
  const titleCell = result.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: 'Calibri', size: 11, bold: true, family: 2 };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  titleCell.border = border;
  titleCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  result.getRow(1).height = 30;
  const conditionCell = result.getCell(2, 1);
  conditionCell.value = condition;
  conditionCell.font = { name: 'Calibri', size: 11, family: 2, color: { argb: 'FF0000FF' } };
  conditionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  conditionCell.border = border;
  conditionCell.alignment = { wrapText: true };
  // Excel cannot auto-fit merged cells: reserve enough lines to show the selected period/company.
  result.getRow(2).height = name === '汇总' ? 45 : 30;
  const header = result.getRow(3);
  headers.forEach((value, index) => {
    const cell = header.getCell(index + 1);
    cell.value = value;
    cell.font = { name: '等线', size: 11, family: 2, color: { argb: 'FF000000' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF969696' } };
    cell.border = border;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  return result;
}
function addRow(sheet: ExcelJS.Worksheet, values: Value[], numbers: Map<number, string>) {
  const row = sheet.addRow(values);
  for (let index = 1; index <= values.length; index++) {
    const cell = row.getCell(index);
    cell.font = { name: '等线', size: 11, family: 2, color: { argb: 'FF000000' } };
    cell.border = border;
    cell.numFmt = numbers.get(index) ?? '@';
  }
  return row;
}
function numeric(value: string): number | null {
  if (value === '') return null;
  const result = new Decimal(value).toNumber();
  if (!Number.isFinite(result)) throw new Error('对账数值超出 Excel 支持范围');
  return result;
}
function totalQuantity(rows: { quantity: string; unit: string }[]): Value {
  const units = new Map<string, Decimal>();
  for (const row of rows) {
    if (!row.quantity) continue;
    units.set(row.unit, (units.get(row.unit) ?? new Decimal(0)).plus(row.quantity));
  }
  if (units.size === 1) return [...units.values()][0].toNumber();
  return [...units].map(([unit, amount]) => `${amount.toString()} ${unit}`).join(' / ');
}

export function deliveryStatements(
  snapshot: ReportSnapshot,
  filters: ReportFilters,
): DeliveryStatement[] {
  return (['tmy', 'tri'] as const).flatMap((company) => {
    if (filters.company !== 'all' && filters.company !== company) return [];
    const selected = { ...filters, company, mode: 'details' as const };
    const report = buildDeliveryReport(snapshot, selected);
    if (!report.noteCount) return [];
    const workbook = new ExcelJS.Workbook();
    const condition = `日期：【${filters.start}  ${filters.end}】;  公司：${companies[company].name};  客户：${filters.customers.join('、') || '全部'}${filters.category ? `;  客户分类：${report.categoryLabel}` : ''}${filters.keyword ? `;  检索：${filters.keyword}` : ''}${productFilterDescription(filters) ? ';  ' + productFilterDescription(filters) : ''}`;
    const summary = sheet(
      workbook,
      '汇总',
      '销售汇总表',
      condition,
      ['客户名称', '销售数量（按单位）', '销售单价', '金额'],
      formats[company].summary,
    );
    const summaryNumbers = new Map([
      [2, quantityFormat],
      [3, moneyFormat],
      [4, moneyFormat],
    ]);
    for (const customer of report.customers) {
      const rows = report.rows.filter(
        (row) =>
          normalizeCustomer(row.cells.customer) === normalizeCustomer(customer.customer ?? ''),
      );
      const quantity = totalQuantity(
        rows.map(({ cells }) => ({ quantity: cells.quantity, unit: cells.unit })),
      );
      // The original summary price is a weighted average. Mixed units cannot have one price.
      const price =
        typeof quantity === 'number' && quantity !== 0
          ? new Decimal(customer.amount).div(quantity).toDecimalPlaces(2).toNumber()
          : null;
      addRow(
        summary,
        [customer.customer ?? '', quantity, price, numeric(customer.amount)],
        summaryNumbers,
      );
    }
    addRow(
      summary,
      [
        '合计',
        totalQuantity(
          report.rows.map(({ cells }) => ({ quantity: cells.quantity, unit: cells.unit })),
        ),
        null,
        numeric(report.total),
      ],
      summaryNumbers,
    );
    const details = sheet(
      workbook,
      '明细',
      '销售明细表',
      condition,
      detailColumns.map(([, title]) => title),
      formats[company].details,
    );
    if (productFilterDescription(filters)) {
      summary.getRow(2).height = 75;
      details.getRow(2).height = 45;
    }
    const detailNumbers = new Map(
      detailColumns.flatMap(([key], index) =>
        numericKeys.has(key)
          ? [[index + 1, key === 'quantity' ? quantityFormat : moneyFormat] as const]
          : [],
      ),
    );
    const rows = [...report.rows].sort(
      (a, b) =>
        a.cells.date.localeCompare(b.cells.date) ||
        a.cells.number.localeCompare(b.cells.number) ||
        a.key.localeCompare(b.key, undefined, { numeric: true }),
    );
    for (const { cells } of rows)
      addRow(
        details,
        detailColumns.map(([key]) => (numericKeys.has(key) ? numeric(cells[key]) : cells[key])),
        detailNumbers,
      );
    const totals: Value[] = Array<Value>(detailColumns.length).fill(null);
    totals[3] = '合计';
    totals[6] = totalQuantity(
      rows.map(({ cells }) => ({ quantity: cells.quantity, unit: cells.unit })),
    );
    totals[8] = numeric(report.lineTotal);
    totals[9] = numeric(report.total);
    addRow(details, totals, detailNumbers);
    const customer = (filters.customers.join('、') || '全部客户')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .slice(0, 26);
    return [
      {
        company,
        name: `销售对账单-${companies[company].shortName}-${customer}-${filters.start}-${filters.end}${productFilterFileSuffix(filters)}.xlsx`,
        workbook,
      },
    ];
  });
}
