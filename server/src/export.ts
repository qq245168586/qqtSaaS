import { Controller, Get, Query, Req, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { AuthRequest, manager } from './auth';
import { Row, rows } from './db';
import { taskList } from './tasks';
import { date } from './validation';
import { TemplateExportController } from './template-export';
import { companyFilter, companyColumns } from './company-scope';
import { z } from 'zod';
async function send(
  res: Response,
  name: string,
  columns: Array<{ header: string; key: string }>,
  items: Row[],
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map((c) => ({ ...c, width: 22 }));
  for (const item of items)
    sheet.addRow(
      Object.fromEntries(
        columns.map((c) => [
          c.key,
          typeof item[c.key] === 'string' || typeof item[c.key] === 'number'
            ? item[c.key]
            : String(item[c.key] ?? ''),
        ]),
      ),
    );
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(name)}.xlsx`,
  );
  res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
}
@Controller()
export class ExportController {
  @Get('tasks/export') async tasks(
    @Req() req: AuthRequest,
    @Query() q: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    manager(req.user);
    const first = await taskList(req.user, { ...q, page: 1, page_size: 200 });
    if (Number(first.total) > 10000)
      throw new BadRequestException('最多导出一万条，请缩小筛选范围');
    const items = first.items as Row[];
    for (let page = 2; items.length < Number(first.total); page++) {
      const result = await taskList(req.user, { ...q, page, page_size: 200 });
      const next = result.items as Row[];
      if (!next.length) break;
      items.push(...next);
    }
    await send(
      res,
      '任务导出',
      [
        { header: '公司', key: 'company_name' },
        { header: '标题', key: 'title' },
        { header: '商品', key: 'product_summary' },
        { header: '配送地址', key: 'delivery_address' },
        { header: '详情', key: 'content' },
        { header: '商品金额', key: 'order_amount' },
        { header: '配送费', key: 'delivery_fee' },
        { header: '业务分类', key: 'category_name' },
        { header: '部门', key: 'department_name' },
        { header: '执行人', key: 'assignee_name' },
        { header: '接单人', key: 'order_taker_name' },
        { header: '状态', key: 'status' },
        { header: '优先级', key: 'priority' },
        { header: '预计交付', key: 'expected_delivery_at' },
        { header: '类型', key: 'task_type' },
        { header: '备注', key: 'note' },
        { header: '创建时间', key: 'created_at' },
      ],
      items,
    );
  }
  @Get('delivery-notes/export') async delivery(
    @Req() req: AuthRequest,
    @Query() q: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    manager(req.user);
    if (typeof q.id === 'string') return new TemplateExportController().single(req, q.id, res);
    const start = date.parse(q.start_date);
    const end = date.parse(q.end_date);
    const scope = companyFilter(req.user, 'n.company_id');
    const filters = [scope.sql];
    const params = [...scope.params];
    if (q.company_code !== undefined) {
      filters.push('n.company_id=(SELECT id FROM companies WHERE code=?)');
      params.push(z.enum(['tri', 'tmy']).parse(q.company_code));
    }
    const items = await rows(
      `SELECT ${companyColumns('n')},n.note_number,n.delivery_date,n.customer_name_snapshot,i.product_name,i.spec,i.unit,i.quantity,i.unit_price,i.amount FROM delivery_notes n JOIN delivery_note_items i ON i.delivery_note_id=n.id AND i.company_id=n.company_id WHERE ${filters.join(' AND ')} AND n.deleted_at IS NULL AND n.is_draft=0 AND n.delivery_date BETWEEN ? AND ? ORDER BY n.delivery_date,n.id,i.sort LIMIT 50001`,
      [...params, start, end],
    );
    if (items.length > 50000) throw new BadRequestException('数据过多，请缩小日期范围');
    await send(
      res,
      '送货明细',
      [
        { header: '公司', key: 'company_name' },
        { header: '单号', key: 'note_number' },
        { header: '日期', key: 'delivery_date' },
        { header: '客户', key: 'customer_name_snapshot' },
        { header: '产品', key: 'product_name' },
        { header: '规格', key: 'spec' },
        { header: '单位', key: 'unit' },
        { header: '数量', key: 'quantity' },
        { header: '单价', key: 'unit_price' },
        { header: '金额', key: 'amount' },
      ],
      items,
    );
  }
}
