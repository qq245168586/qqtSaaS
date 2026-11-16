import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { createDeliveryBatchWorkbook, ExcelNote } from '../src/legacy-excel';
test('原版Excel两家公司模板可导出1/2张，保留版式并清除公式外链', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tmy-excel-test-'));
  try {
    for (const companyId of ['tri', 'tmy'] as const) {
      const note: ExcelNote = {
        companyId,
        number: 'TEST001',
        date: '2026-09-22',
        customerName: '测试客户',
        customerAddress: '测试地址',
        customerPhone: '',
        page: 1,
        totalPages: 1,
        maker: '',
        keeper: '',
        salesperson: '',
        deliveryPerson: '',
        totalAmount: '0.02',
        items: [
          {
            name: '测试产品',
            specification: '',
            unit: '份',
            quantity: '0.10',
            unitPrice: '0.20',
            amount: '0.02',
            remark: '',
          },
        ],
      };
      for (const count of [1, 2]) {
        const output = join(dir, `${companyId}-${count}.xlsx`);
        createDeliveryBatchWorkbook(
          join(process.cwd(), 'resources/delivery-template.xlsx'),
          output,
          Array.from({ length: count }, () => note),
        );
        const zip = new AdmZip(output);
        const xml = zip.readAsText('xl/worksheets/sheet1.xml');
        assert.match(xml, /测试客户/);
        assert.match(xml, /<v>0.02<\/v>/);
        assert.equal(xml.includes('<f>'), false);
        assert.equal(
          zip.getEntries().filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.entryName))
            .length,
          1,
        );
        assert.equal(
          zip.getEntries().some((e) => e.entryName.startsWith('xl/externalLinks/')),
          false,
        );
        assert.match(xml, /pageSetup/);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('混合公司送货单按各自原版模板导出到同一工作簿的两个工作表', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tmy-excel-mixed-'));
  try {
    const notes: ExcelNote[] = (['tri', 'tmy'] as const).map((companyId) => ({
      companyId,
      number: `TEST-${companyId}`,
      date: '2026-09-22',
      customerName: `客户-${companyId}`,
      customerAddress: '',
      customerPhone: '',
      page: 1,
      totalPages: 1,
      maker: '',
      keeper: '',
      salesperson: '',
      deliveryPerson: '',
      totalAmount: '0.30',
      items: [
        {
          name: '测试产品',
          specification: '',
          unit: '份',
          quantity: '3',
          unitPrice: '0.10',
          amount: '0.30',
          remark: '',
        },
      ],
    }));
    const output = join(dir, 'mixed.xlsx');
    createDeliveryBatchWorkbook(
      join(process.cwd(), 'resources/delivery-template.xlsx'),
      output,
      notes,
    );
    const zip = new AdmZip(output);
    const first = zip.readAsText('xl/worksheets/sheet1.xml');
    const second = zip.readAsText('xl/worksheets/sheet2.xml');
    assert.match(first, /TEST-tri/);
    assert.doesNotMatch(first, /TEST-tmy/);
    assert.match(second, /TEST-tmy/);
    assert.doesNotMatch(second, /TEST-tri/);
    const workbook = zip.readAsText('xl/workbook.xml');
    assert.match(workbook, /localSheetId="0"/);
    assert.match(workbook, /localSheetId="1"/);
    assert.equal(
      zip.getEntries().filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.entryName)).length,
      2,
    );
    assert.equal(
      zip.getEntries().some((e) => e.entryName.startsWith('xl/externalLinks/')),
      false,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
