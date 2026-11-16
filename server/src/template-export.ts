import { Body, Controller, Get, Post, Query, Req, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { AuthRequest, manager } from './auth';
import { id } from './validation';
import { scoped } from './tasks';
import { rows } from './db';
import { createDeliveryBatchWorkbook, ExcelNote } from './legacy-excel';
@Controller('delivery-notes')
export class TemplateExportController {
  @Get('export-template') async single(
    @Req() req: AuthRequest,
    @Query('id') recordId: string,
    @Res() res: Response,
  ): Promise<void> {
    return this.send(req, [id.parse(recordId)], res);
  }
  @Post('export-batch') async batch(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const b = z
      .object({ ids: z.array(id).min(1).max(2) })
      .strict()
      .parse(body);
    return this.send(req, b.ids, res);
  }
  private async send(req: AuthRequest, ids: string[], res: Response): Promise<void> {
    manager(req.user);
    const notes: ExcelNote[] = [];
    for (const recordId of ids) {
      const n = await scoped('delivery_notes', recordId, req.user);
      if (n.is_draft) throw new BadRequestException('草稿不能导出正式送货单');
      const items = await rows(
        'SELECT * FROM delivery_note_items WHERE company_id=? AND delivery_note_id=? ORDER BY sort,id',
        [n.company_id, recordId],
      );
      notes.push({
        companyId: z.enum(['tri', 'tmy']).parse(n.company_code),
        number: String(n.note_number),
        date: String(n.delivery_date),
        customerName: String(n.customer_name_snapshot),
        customerAddress: String(n.customer_address_snapshot ?? ''),
        customerPhone: String(n.customer_phone_snapshot ?? ''),
        page: Number(n.page ?? 1),
        totalPages: Number(n.total_pages ?? 1),
        maker: String(n.maker_name ?? ''),
        keeper: String(n.warehouse_name ?? ''),
        salesperson: String(n.sales_name ?? ''),
        deliveryPerson: String(n.deliverer_name ?? ''),
        totalAmount: String(n.total_amount),
        items: items.map((i) => ({
          name: String(i.product_name),
          specification: String(i.spec),
          unit: String(i.unit),
          quantity: String(i.quantity),
          unitPrice: String(i.unit_price),
          amount: String(i.amount),
          remark: String(i.remark ?? ''),
        })),
      });
    }
    const dir = await mkdtemp(join(tmpdir(), 'tmy-export-'));
    try {
      const path = join(dir, 'delivery.xlsx');
      createDeliveryBatchWorkbook(
        join(__dirname, '../resources/delivery-template.xlsx'),
        path,
        notes,
      );
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', 'attachment; filename="delivery.xlsx"');
      res.send(await readFile(path));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
