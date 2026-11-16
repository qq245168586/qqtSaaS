import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import {
  normalizeBomName,
  normalizeBomUnit,
  parseBomParseRequest,
  parseKingdeeProductWorkbook,
  renderKingdeeBom,
} from '../src/bom';

test('BOM解析接口兼容已发布客户端并统一为 text 字段', () => {
  assert.deepEqual(parseBomParseRequest({ company_code: 'tri', text: '蛋糕\n鸡蛋 100g' }), {
    company_code: 'tri',
    text: '蛋糕\n鸡蛋 100g',
  });
  assert.deepEqual(parseBomParseRequest({ company_code: 'tmy', source_text: '方包\n面粉 200g' }), {
    company_code: 'tmy',
    text: '方包\n面粉 200g',
  });
  assert.throws(() => parseBomParseRequest({ company_code: 'tri', source_text: '蛋糕', extra: 1 }));
});

test('BOM只读取独立金蝶目录，不再读写送货商品历史表', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'bom.ts'), 'utf8');
  assert.match(source, /FROM kingdee_products/u);
  assert.match(source, /INSERT INTO kingdee_products/u);
  assert.doesNotMatch(source, /\b(?:FROM|JOIN|UPDATE|INTO) products\b/u);
});

test('目录分离迁移先保留金蝶ID，再恢复送货商品唯一历史目录', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'migrations', 'kingdee-catalog-separation.ts'),
    'utf8',
  );
  assert.match(source, /INSERT INTO kingdee_products[\s\S]*FROM products/u);
  assert.match(source, /CREATE UNIQUE INDEX uk_company_name_spec ON products/u);
  assert.match(source, /FROM delivery_note_items i JOIN delivery_notes n/u);
});

test('BOM名称与单位只做确定性标准化，不猜测个数和克数换算', () => {
  assert.equal(normalizeBomName(' 王后-低筋粉（25kg） '), '王后低筋粉25kg');
  assert.equal(normalizeBomUnit('克'), 'g');
  assert.equal(normalizeBomUnit('公斤'), 'kg');
  assert.equal(normalizeBomUnit('毫升'), 'ml');
  assert.equal(normalizeBomUnit('个'), '个');
});

test('金蝶商品导出表按原字段完整解析，可作为数据库更新来源', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('列表数据');
  sheet.addRow([
    '商品编码',
    '商品名称',
    '商品类别',
    '条形码',
    '规格型号',
    '计量单位',
    '禁用状态',
    '倒冲领料',
    '倒冲仓库',
    '倒冲仓位',
    '成本计算方法',
  ]);
  sheet.addRow([
    'SP00056',
    '王后低筋面粉',
    '面粉',
    '690000000056',
    '25kg/包',
    'g',
    '否',
    '是',
    '原料仓',
    'A01',
    '移动平均法',
  ]);
  const parsed = await parseKingdeeProductWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.deepEqual(parsed, [
    {
      code: 'SP00056',
      name: '王后低筋面粉',
      category: '面粉',
      barcode: '690000000056',
      spec: '25kg/包',
      unit: 'g',
      disabled: false,
      backflush: true,
      warehouse: '原料仓',
      position: 'A01',
      costMethod: '移动平均法',
    },
  ]);
});

test('金蝶BOM模板保留固定工作表、11列字段和隐藏数据验证表', async () => {
  const template = readFileSync(join(process.cwd(), 'resources', 'kingdee-bom-template.xls'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet('sheet1（名称勿改）');
  assert.ok(sheet);
  assert.deepEqual(
    Array.from({ length: 11 }, (_, index) => sheet.getRow(3).getCell(index + 1).text),
    [
      '*BOM单编号 # number',
      'BOM分类.名称 # group.name',
      '*商品.编码 # productid.number',
      '*单位.名称 # product_unitid.name',
      'BOM备注 # bom_remark',
      '*物料编码.编码 # materialid.number',
      '*单位.名称 # material_unitid.name',
      '*产品产量 # dosage_denominator',
      '*材料用量 # dosage_numerator',
      '发料仓库.名称 # stockid.name',
      '物料备注 # material_remark',
    ],
  );
  assert.equal(workbook.worksheets.filter((item) => item.state === 'hidden').length, 3);
  assert.ok(sheet.dataValidations.model.D4);
  assert.ok(sheet.dataValidations.model.G4);
  assert.ok(sheet.dataValidations.model.J4);
});

test('BOM导出按模板第4行起写入全部材料并保持编码为文本', async () => {
  const template = readFileSync(join(process.cwd(), 'resources', 'kingdee-bom-template.xls'));
  const output = await renderKingdeeBom(
    template,
    {
      bom_number: 'BOM00002',
      bom_category: '蛋糕',
      finished_product_code: 'SP00256',
      finished_product_unit: '件',
      yield_quantity: '1',
      warehouse_name: '仓库',
      remark: '测试',
    },
    [
      { product_code: 'SP00056', bom_unit: 'g', material_quantity: '100', material_remark: '' },
      {
        product_code: 'SP00073',
        bom_unit: 'g',
        material_quantity: '80',
        material_remark: '低筋粉',
      },
    ],
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet('sheet1（名称勿改）');
  assert.ok(sheet);
  assert.deepEqual(
    Array.from({ length: 11 }, (_, index) => sheet.getRow(4).getCell(index + 1).value),
    ['BOM00002', '蛋糕', 'SP00256', '件', '测试', 'SP00056', 'g', 1, 100, '仓库', ''],
  );
  assert.equal(sheet.getRow(5).getCell(6).value, 'SP00073');
  assert.equal(sheet.getRow(5).getCell(9).value, 80);
  assert.equal(sheet.getRow(4).getCell(1).numFmt, '@');
  assert.equal(sheet.getRow(4).getCell(3).numFmt, '@');
  assert.equal(sheet.getRow(4).getCell(6).numFmt, '@');
  assert.equal(workbook.worksheets.filter((item) => item.state === 'hidden').length, 3);
});
