import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { deliveryStatements } from '../src/delivery-statement';
import { reportNoteSchema, type ReportFilters, type ReportSnapshot } from '../src/delivery-report';

const filters: ReportFilters = {
  start: '2026-09-01',
  end: '2026-09-30',
  company: 'all',
  customers: ['御牛纪'],
  category: '',
  keyword: '',
  products: [],
  productRelation: 'include',
  productLogic: 'any',
  mode: 'details',
};
const note = (id: string, company: 'tri' | 'tmy', date: string, customer = '御牛纪') =>
  reportNoteSchema.parse({
    id,
    company_code: company,
    customer_name_snapshot: customer,
    delivery_date: date,
    note_number: `${company}-${id}`,
    total_amount: '478.01',
    is_draft: 0,
    items: [
      { product_name: '蛋糕', unit: '个', quantity: '16', unit_price: '10.5', amount: '168' },
      { product_name: '布丁', unit: '个', quantity: '10', unit_price: '16', amount: '160' },
      { product_name: '蛋糕', unit: '个', quantity: '10', unit_price: '15', amount: '150' },
    ],
  });
const snapshot: ReportSnapshot = {
  start: filters.start,
  end: filters.end,
  customers: [],
  categories: [],
  notes: [
    note('1', 'tri', '2026-09-20'),
    note('2', 'tmy', '2026-09-21'),
    note('3', 'tri', '2026-09-01'),
    note('4', 'tri', '2026-09-22', '其他客户'),
    { ...note('5', 'tri', '2026-09-22'), is_draft: 1 },
  ],
};
async function roundtrip(workbook: ExcelJS.Workbook) {
  const actual = new ExcelJS.Workbook();
  await actual.xlsx.load(await workbook.xlsx.writeBuffer());
  return actual;
}
test('each company has an independent Excel with exactly summary and details sheets', async () => {
  const files = deliveryStatements(snapshot, filters);
  assert.deepEqual(
    files.map((file) => file.company),
    ['tmy', 'tri'],
  );
  assert(files.every((file) => file.name.endsWith('.xlsx') && !file.name.includes('全部公司')));
  for (const file of files) {
    const workbook = await roundtrip(file.workbook);
    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      ['汇总', '明细'],
    );
    const count = file.company === 'tri' ? 2 : 1;
    const details = workbook.getWorksheet('明细')!;
    const summary = workbook.getWorksheet('汇总')!;
    assert.equal(details.rowCount, count * 3 + 4);
    assert.equal(summary.rowCount, 5);
    assert.equal(summary.getCell('D5').value, count * 478.01);
    assert.equal(details.getCell(`I${details.rowCount}`).value, count * 478);
    assert.equal(details.getCell(`J${details.rowCount}`).value, count * 478.01);
    const numbers = details.getColumn(2).values.slice(4, -1);
    assert(numbers.every((value) => typeof value === 'string' && value.startsWith(file.company)));
    assert(!JSON.stringify(workbook.model).includes('其他客户'));
    assert.equal(details.getCell('J5').value, null, '单据金额不能在各商品重复累加');
    assert.equal(details.getCell('A4').value, file.company === 'tri' ? '2026-09-01' : '2026-09-21');
  }
});
test('reference structure, retained widths, gray header, borders and numeric formats survive serialization', async () => {
  const [{ workbook }] = deliveryStatements(snapshot, { ...filters, company: 'tri' });
  const result = await roundtrip(workbook);
  const sheet = result.getWorksheet('明细')!;
  assert.equal(sheet.columnCount, 11);
  assert.deepEqual(sheet.getRow(3).values.slice(1), [
    '单据日期',
    '单据编号',
    '客户名称',
    '商品名称',
    '规格',
    '单位',
    '数量',
    '单价',
    '金额',
    '单据金额',
    '备注',
  ]);
  assert.deepEqual(sheet.model.merges, ['A1:K1', 'A2:K2']);
  assert.equal(sheet.getRow(1).height, 30);
  assert.equal(sheet.properties.defaultRowHeight, 15);
  assert.equal(sheet.getColumn(1).width, 14);
  assert.equal(sheet.getColumn(2).width, 24.1640625);
  assert.equal(sheet.getColumn(3).width, 35);
  assert.equal(sheet.getCell('A3').fill.type, 'pattern');
  assert.equal(sheet.getCell('A3').border.left?.style, 'thin');
  assert.equal(sheet.getCell('G4').type, ExcelJS.ValueType.Number);
  assert.match(sheet.getCell('G4').numFmt, /0\.00000/);
  assert.match(sheet.getCell('I4').numFmt, /0\.00/);
  assert(
    !sheet
      .getRow(3)
      .values.toString()
      .match(/审核|修改时间|商品编码|税额/),
  );
});
test('company/customer filters, summary view switching, normalized names and mixed units preserve actual totals', () => {
  const notes = [
    note('1', 'tri', '2026-09-01', '御牛纪'),
    note('2', 'tri', '2026-09-02', ' 御牛纪 '),
    note('3', 'tmy', '2026-09-01'),
  ];
  notes[1].items[0].unit = '斤';
  for (const mode of ['details', 'customers', 'categories', 'products', 'notes'] as const) {
    const files = deliveryStatements({ ...snapshot, notes }, { ...filters, mode, company: 'tri' });
    assert.equal(files.length, 1);
    const summary = files[0].workbook.getWorksheet('汇总')!;
    assert.equal(summary.rowCount, 5);
    assert.deepEqual(String(summary.getCell('B4').value).split(' / ').sort(), ['16 斤', '56 个']);
    assert.equal(summary.getCell('C4').value, null, '不同单位不能捏造平均单价');
    assert.equal(summary.getCell('D4').value, 956.02);
    assert.equal(files[0].workbook.getWorksheet('明细')!.rowCount, 10);
  }
});
test('custom names are Excel strings, never formulas; negative amounts remain numeric; empty companies omitted', async () => {
  const source = note('1', 'tri', '2026-09-01', '=CMD()');
  source.items = [
    {
      product_name: '+危险',
      unit: '个',
      quantity: '-1',
      unit_price: '2',
      amount: '-2',
      remark: '逗号,双引号"\n换行',
    },
  ];
  source.total_amount = '-2';
  const files = deliveryStatements({ ...snapshot, notes: [source] }, { ...filters, customers: [] });
  assert.equal(files.length, 1);
  const actual = await roundtrip(files[0].workbook);
  const details = actual.getWorksheet('明细')!;
  assert.equal(details.getCell('C4').value, '=CMD()');
  assert.equal(details.getCell('C4').type, ExcelJS.ValueType.String);
  assert.equal(details.getCell('D4').value, '+危险');
  assert.equal(details.getCell('I4').value, -2);
  assert.equal(details.getCell('K4').value, '逗号,双引号"\n换行');
  assert.deepEqual(deliveryStatements({ ...snapshot, notes: [] }, filters), []);
});

test('both Excel sheets and filenames reflect product filters and retained-line totals', async () => {
  const mixed = note('1', 'tri', '2026-09-01');
  mixed.items[0].product_name = '月饼礼盒';
  const files = deliveryStatements(
    { ...snapshot, notes: [mixed, note('2', 'tmy', '2026-09-01')] },
    { ...filters, products: ['月饼'], productRelation: 'exclude' },
  );
  assert.equal(files.length, 2);
  for (const file of files) {
    assert.match(file.name, /排除月饼\.xlsx$/);
    const actual = await roundtrip(file.workbook);
    const summary = actual.getWorksheet('汇总')!;
    const details = actual.getWorksheet('明细')!;
    assert.match(String(summary.getCell('A2').value), /商品排除：月饼/);
    assert.match(String(details.getCell('A2').value), /部分单据按保留明细金额汇总/);
    const expected = file.company === 'tri' ? 310 : 478.01;
    assert.equal(summary.getCell('D5').value, expected);
    assert.equal(details.getCell(`J${details.rowCount}`).value, expected);
    const products = details.getColumn(4).values.slice(4, -1).map(String);
    assert(!products.some((value) => value.includes('月饼')));
    assert.equal(details.rowCount, (file.company === 'tri' ? 2 : 3) + 4);
  }
});

test('Excel identifies AND/OR rules in both sheets and exported filename', async () => {
  const mixed = note('1', 'tri', '2026-09-01');
  mixed.items[0].product_name = '蛋黄月饼';
  mixed.items[1].product_name = '红豆月饼';
  for (const productLogic of ['all', 'any'] as const) {
    const files = deliveryStatements(
      { ...snapshot, notes: [mixed] },
      {
        ...filters,
        products: ['月饼', '蛋黄'],
        productRelation: 'exclude',
        productLogic,
      },
    );
    assert.equal(files.length, 1);
    assert.match(files[0].name, productLogic === 'all' ? /排除月饼与蛋黄/ : /排除月饼或蛋黄/);
    const workbook = await roundtrip(files[0].workbook);
    for (const name of ['汇总', '明细']) {
      assert.match(
        String(workbook.getWorksheet(name)!.getCell('A2').value),
        productLogic === 'all' ? /与：同时命中全部词/ : /或：命中任一词/,
      );
    }
    assert.equal(
      workbook.getWorksheet('汇总')!.getCell('D5').value,
      productLogic === 'all' ? 310 : 150,
    );
  }
});
