import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/main';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
test('Nest11/Express5 注册实际全部业务路由（不连接数据库）', async () => {
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  try {
    app.setGlobalPrefix('api');
    await app.init();
    assert.ok(app.getHttpServer());
  } finally {
    await app.close();
  }
});
test('升级sharp可完成受限PNG转换；ExcelJS兼容UUID11写入条件格式', async () => {
  const buffer = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const normalized = await sharp(buffer, { limitInputPixels: 24000000 }).rotate().png().toBuffer();
  assert.equal((await sharp(normalized).metadata()).width, 2);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('升级验证');
  sheet.addRow([1]);
  sheet.addConditionalFormatting({
    ref: 'A1',
    rules: [
      {
        type: 'dataBar',
        minLength: 0,
        maxLength: 100,
        gradient: true,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FF00FF00' },
      },
    ],
  });
  const encoded = await book.xlsx.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(encoded);
  assert.equal(restored.getWorksheet('升级验证')?.getCell('A1').value, 1);
});
