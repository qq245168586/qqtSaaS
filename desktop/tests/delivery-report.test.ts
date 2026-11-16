import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeliveryReport,
  readReportPages,
  reportCsv,
  reportNoteSchema,
  validateReportDates,
  type ReportFilters,
  type ReportNote,
  type ReportSnapshot,
} from '../src/delivery-report';
const filters: ReportFilters = {
  start: '2026-09-01',
  end: '2026-09-30',
  company: 'all',
  customers: [],
  category: '',
  keyword: '',
  products: [],
  productRelation: 'include',
  productLogic: 'any',
  mode: 'details',
};
const make = (
  id: string,
  company: 'tmy' | 'tri',
  customer: string,
  overrides: Partial<ReportNote> = {},
): ReportNote =>
  reportNoteSchema.parse({
    id,
    company_code: company,
    customer_id: company === 'tmy' ? '11' : '12',
    customer_name_snapshot: customer,
    delivery_date: '2026-09-20',
    note_number: `${company}${id}`,
    total_amount: '478.00',
    is_draft: 0,
    items: [
      {
        product_name: '红心意面',
        quantity: '16',
        unit_price: '10.5',
        amount: '168.00',
        unit: '斤',
        spec: '',
        remark: '',
      },
      { product_name: '布丁', quantity: '10', unit_price: '16', amount: '160.00', unit: '个' },
      { product_name: '蛋糕', quantity: '10', unit_price: '15', amount: '150.00', unit: '个' },
    ],
    ...overrides,
  });
const snapshot: ReportSnapshot = {
  start: filters.start,
  end: filters.end,
  notes: [
    make('1', 'tmy', '御牛纪'),
    make('2', 'tri', '御牛纪'),
    make('3', 'tri', '一乐食堂'),
    make('4', 'tri', '御牛纪', { is_draft: 1 }),
  ],
  customers: [
    { id: '11', company_code: 'tmy', name: '御牛纪', category_id: '21' },
    { id: '12', company_code: 'tri', name: '御牛纪', category_id: '22' },
  ],
  categories: [
    { id: '21', name: '餐厅', company_code: 'tmy' },
    { id: '22', name: '门店', company_code: 'tri' },
  ],
};
function csvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const text = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n' && !quoted) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}
test('customer alone includes both companies; company and customer use intersection; drafts excluded', () => {
  const all = buildDeliveryReport(snapshot, { ...filters, customers: ['御牛纪'] });
  assert.equal(all.noteCount, 2);
  assert.equal(all.total, '956.00');
  assert.equal(all.companies.length, 2);
  const single = buildDeliveryReport(snapshot, {
    ...filters,
    company: 'tri',
    customers: ['御牛纪'],
  });
  assert.equal(single.noteCount, 1);
  assert.equal(single.total, '478.00');
  assert.equal(buildDeliveryReport(snapshot, filters).noteCount, 3);
});
test('detail amounts and document total counted once, with quantities separated by unit', () => {
  const report = buildDeliveryReport({ ...snapshot, notes: [snapshot.notes[0]] }, filters);
  assert.equal(report.rows.length, 3);
  assert.deepEqual(
    report.rows.map((r) => r.cells.note_amount),
    ['478.00', '', ''],
  );
  assert.deepEqual(
    report.rows.map((r) => r.cells.amount),
    ['168.00', '160.00', '150.00'],
  );
  assert.equal(report.total, '478.00');
  assert.equal(report.lineTotal, '478.00');
  assert.equal(report.quantity, '16 斤 / 20 个');
});
test('preserve stored historical line/header amounts and rounding; never use catalog prices', () => {
  const note = make('5', 'tri', '客户', {
    total_amount: '10.01',
    items: [
      { product_name: '礼品', quantity: '3', unit_price: '3.333', amount: '10.00', unit: '个' },
      { product_name: '赠品', quantity: '1', unit_price: '0', amount: '0', unit: '个' },
    ],
  });
  const report = buildDeliveryReport({ ...snapshot, notes: [note] }, filters);
  assert.equal(report.rows[0].cells.amount, '10.00');
  assert.equal(report.total, '10.01');
  assert.equal(report.lineTotal, '10.00');
  assert.equal(report.rows[1].cells.amount, '0.00');
});
test('fallback only for missing saved line amount; header invalid is a visible error', () => {
  const note = make('6', 'tmy', '客户', {
    items: [{ product_name: '意面', quantity: '2.5', unit_price: '13.5', unit: '斤' }],
    total_amount: '33.75',
  });
  assert.equal(buildDeliveryReport({ ...snapshot, notes: [note] }, filters).lineTotal, '33.75');
  assert.throws(
    () =>
      buildDeliveryReport({ ...snapshot, notes: [{ ...note, total_amount: undefined }] }, filters),
    /金额缺失/,
  );
  assert.throws(
    () => buildDeliveryReport({ ...snapshot, notes: [{ ...note, total_amount: 'NaN' }] }, filters),
    /有效数字/,
  );
});
test('keyword matches Chinese/pinyin/initials and preserves whole document', () => {
  const report = buildDeliveryReport(snapshot, { ...filters, keyword: 'b uding'.replace(' ', '') });
  assert.equal(report.noteCount, 3);
  assert.equal(report.rows.length, 9);
  assert.equal(
    buildDeliveryReport(snapshot, { ...filters, keyword: 'h x y m'.replaceAll(' ', '') }).noteCount,
    3,
  );
  assert.equal(buildDeliveryReport(snapshot, { ...filters, customers: ['御牛'] }).noteCount, 2);
});
test('existing customer category filter combines with company/customer filters', () => {
  assert.equal(
    buildDeliveryReport(snapshot, { ...filters, customers: ['御牛纪'], category: '22' }).noteCount,
    1,
  );
  assert.equal(
    buildDeliveryReport(snapshot, { ...filters, company: 'tmy', category: '22' }).noteCount,
    0,
  );
});
test('all aggregate modes retain company separation and totals', () => {
  for (const mode of ['customers', 'categories', 'products', 'notes'] as const) {
    const report = buildDeliveryReport(snapshot, { ...filters, mode, customers: ['御牛纪'] });
    assert.equal(report.total, '956.00');
    assert.equal(report.noteCount, 2);
    assert.equal(
      report.rows.reduce((sum, r) => sum + Number(r.cells.amount), 0),
      956,
    );
    assert.equal(new Set(report.rows.map((r) => r.cells.company)).size, 2);
  }
});
test('CSV title/filter/header/details/totals match references and exclude internal fields', () => {
  const selected = { ...filters, customers: ['御牛纪'] };
  const report = buildDeliveryReport(snapshot, selected);
  const csv = reportCsv(report, selected);
  const rows = csvRows(csv);
  assert(csv.startsWith('\uFEFF'));
  assert.equal(rows[0][0], '销售明细对账单');
  assert.match(rows[1][0], /2026-09-01 至 2026-09-30.*御牛纪/);
  assert.deepEqual(rows[2], [
    '公司',
    '送货日期',
    '送货单号',
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
  assert.equal(rows.filter((r) => r[0].startsWith('对账总额'))[0][10], '956.00');
  assert.equal(
    rows.slice(3, 9).reduce((sum, r) => sum + Number(r[10] || 0), 0),
    956,
  );
  assert(!/审核|修改时间|商品编码|客户分类筛选：22/.test(csv));
  assert(rows.every((row) => row.length === 12));
});
test('CSV preserves comma/quotes/newline, blocks text formulas, leaves negative money numeric', () => {
  const note = make('9', 'tri', '=CMD()', {
    customer_name_snapshot: '=CMD()',
    total_amount: '-2.00',
    items: [
      {
        product_name: '+危险',
        unit: '个',
        quantity: '-1',
        unit_price: '2',
        amount: '-2',
        remark: '逗号, 双引号"\n换行',
      },
    ],
  });
  const report = buildDeliveryReport({ ...snapshot, notes: [note] }, filters);
  const rows = csvRows(reportCsv(report, filters));
  assert.equal(rows[3][3], "'=CMD()");
  assert.equal(rows[3][4], "'+危险");
  assert.equal(rows[3][7], '-1');
  assert.equal(rows[3][9], '-2.00');
  assert.equal(rows[3][11], '逗号, 双引号"\n换行');
});
test('invalid dates and stale snapshot prevent report/export', () => {
  assert.throws(() => validateReportDates('', '2026-09-30'), /有效/);
  assert.throws(() => validateReportDates('2026-02-30', '2026-09-30'), /有效/);
  assert.throws(() => validateReportDates('2026-09-30', '2026-09-01'), /晚于/);
  assert.throws(
    () => buildDeliveryReport(snapshot, { ...filters, start: '2026-08-01' }),
    /正在加载/,
  );
});
test('read all pages and reject partial/changing/duplicate pagination', async () => {
  const calls: number[] = [];
  const result = await readReportPages(async (page) => {
    calls.push(page);
    return { total: 3, items: [snapshot.notes[page - 1]] };
  });
  assert.equal(result.length, 3);
  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual(await readReportPages(async () => ({ total: 0, items: [] })), []);
  await assert.rejects(
    readReportPages(async (page) => ({
      total: page === 1 ? 3 : 4,
      items: [snapshot.notes[page - 1]],
    })),
    /变化/,
  );
  await assert.rejects(
    readReportPages(async () => ({ total: 3, items: [snapshot.notes[0]] })),
    /变化/,
  );
  await assert.rejects(
    readReportPages(async (page) => ({ total: 3, items: page === 1 ? [snapshot.notes[0]] : [] })),
    /不完整/,
  );
});

test('product exclusion removes mooncake-only notes and only unwanted lines of mixed notes', () => {
  const notes = [
    make('1', 'tri', '御牛纪', {
      total_amount: '99',
      items: [
        { product_name: '月饼礼盒', unit: '盒', quantity: '1', unit_price: '99', amount: '99' },
      ],
    }),
    make('2', 'tri', '御牛纪', {
      total_amount: '121',
      items: [
        { product_name: '月饼', unit: '盒', quantity: '1', unit_price: '99', amount: '99' },
        { product_name: '方包', unit: '条', quantity: '1', unit_price: '22', amount: '22' },
      ],
    }),
    make('3', 'tmy', '御牛纪', {
      total_amount: '13.51',
      items: [
        { product_name: '意面', unit: '斤', quantity: '1', unit_price: '13.5', amount: '13.5' },
      ],
    }),
  ];
  const source = { ...snapshot, notes };
  const before = JSON.stringify(source);
  for (const mode of ['details', 'notes', 'products', 'customers', 'categories'] as const) {
    const result = buildDeliveryReport(source, {
      ...filters,
      mode,
      products: ['月饼'],
      productRelation: 'exclude',
    });
    assert.equal(result.noteCount, 2);
    assert.equal(result.itemCount, 2);
    assert.equal(
      result.total,
      '35.51',
      'untouched header remains saved amount; mixed note counts retained line amount',
    );
    assert.equal(result.lineTotal, '35.50');
    assert.equal(result.omittedItemCount, 2);
    assert.equal(result.partialNoteCount, 1);
    assert(!JSON.stringify(result.rows).includes('月饼'));
    assert.equal(result.companies.find((row) => row.company.includes('趣趣特'))?.amount, '22.00');
  }
  assert.equal(JSON.stringify(source), before, 'source documents must remain unchanged');
  assert.equal(
    buildDeliveryReport(source, filters).total,
    '233.51',
    'clearing filters restores original totals',
  );
});

test('one product condition supports include/exclude AND/OR, pinyin and negative amounts', () => {
  const source = {
    ...snapshot,
    notes: [
      make('1', 'tri', '御牛纪', {
        total_amount: '88',
        items: [
          { product_name: '蛋黄月饼', unit: '盒', quantity: '1', unit_price: '99', amount: '99' },
          { product_name: '方包', unit: '条', quantity: '-1', unit_price: '22', amount: '-22' },
          { product_name: '意面', unit: '斤', quantity: '1', unit_price: '11', amount: '11' },
        ],
      }),
    ],
  };
  for (const word of ['月饼', 'yuebing', 'yb']) {
    for (const [productRelation, productLogic, products, expected, count] of [
      ['include', 'any', [word, '方包'], '77.00', 2],
      ['include', 'all', [word, '蛋黄'], '99.00', 1],
      ['exclude', 'any', [word, '方包'], '11.00', 1],
      ['exclude', 'all', [word, '蛋黄'], '-11.00', 2],
      ['include', 'all', [word, '方包'], '0.00', 0],
      ['exclude', 'all', [word, '方包'], '88.00', 3],
    ] as const) {
      const result = buildDeliveryReport(source, {
        ...filters,
        productRelation,
        productLogic,
        products: [...products],
      });
      assert.equal(result.total, expected);
      assert.equal(result.itemCount, count);
    }
  }
  for (const productRelation of ['include', 'exclude'] as const) {
    assert.equal(
      buildDeliveryReport(source, {
        ...filters,
        productRelation,
        products: ['  ', ''],
      }).total,
      '88.00',
    );
  }
});

test('product matching is independent from whole-note search and combines with company/customer selection', () => {
  const result = buildDeliveryReport(snapshot, {
    ...filters,
    company: 'tri',
    customers: ['御牛纪'],
    keyword: '红心意面',
    products: ['布丁'],
  });
  assert.equal(result.noteCount, 1);
  assert.equal(result.itemCount, 1);
  assert.equal(result.total, '160.00');
  assert.equal(result.rows[0].cells.product, '布丁');
  assert.match(
    reportCsv(result, { ...filters, products: ['布丁'] }),
    /商品包含：布丁；部分单据按保留明细金额汇总/,
  );
});
