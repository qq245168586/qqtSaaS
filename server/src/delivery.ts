import { rememberCompany, forgetCompany, inferredOwner } from './company-learning';
import { withSourceTasks } from './task-links';
import { companyFilter, companyColumns, writeUser } from './company-scope';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { z } from 'zod';
import { db, rows, insert, update, execute, Row, now } from './db';
import { AuthRequest, User, manager } from './auth';
import { scoped, taskRecord } from './tasks';
import { deliverySchema, amounts, pageSchema, date, id } from './validation';
import { rememberDeliveryCatalog } from './delivery-catalog';
import { businessDate } from './employee-policy';
import {
  suggestDeliveryPersonnel,
  employeeNameAvailable,
  deliveryPersonnelFields,
} from './delivery-personnel';
export const DELIVERY_LIST_ORDER = 'created_at DESC,id DESC,delivery_date DESC';
async function number(u: User, day: string, m: EntityManager): Promise<string> {
  const key = `delivery_seq:${day}`;
  await execute(
    'INSERT IGNORE INTO app_meta(company_id,meta_key,meta_value) VALUES(?,?,?)',
    [u.company_id, key, '0'],
    m,
  );
  const [r] = await rows(
    'SELECT id,meta_value FROM app_meta WHERE company_id=? AND meta_key=? FOR UPDATE',
    [u.company_id, key],
    m,
  );
  const seq = BigInt(String(r.meta_value)) + 1n;
  await update('app_meta', String(r.id), u.company_id, { meta_value: seq.toString() }, m);
  return `${u.company_code.toUpperCase()}${day.slice(2).replaceAll('-', '')}${now().slice(11).replaceAll(':', '')}${seq.toString().padStart(3, '0')}`;
}
@Controller('delivery-notes')
export class DeliveryController {
  @Get() async list(@Req() req: AuthRequest, @Query() q: Record<string, unknown>): Promise<Row> {
    manager(req.user);
    const p = pageSchema.parse(q);
    const scope = companyFilter(req.user);
    const params: unknown[] = [...scope.params];
    let filter = `${scope.sql} AND deleted_at IS NULL`;
    if (q.source_task_id) {
      filter += ' AND source_task_id=?';
      params.push(id.parse(q.source_task_id));
    }
    if (q.start_date) {
      filter += ' AND delivery_date>=?';
      params.push(date.parse(q.start_date));
    }
    if (q.end_date) {
      filter += ' AND delivery_date<=?';
      params.push(date.parse(q.end_date));
    }
    if (q.keyword) {
      filter += ' AND (customer_name_snapshot LIKE ? OR note_number LIKE ?)';
      const s = `%${z.string().max(200).parse(q.keyword)}%`;
      params.push(s, s);
    }
    const [c] = await rows(`SELECT COUNT(*) total FROM delivery_notes WHERE ${filter}`, params);
    const notes = await rows(
      `SELECT *,${companyColumns('delivery_notes')} FROM delivery_notes WHERE ${filter} ORDER BY ${DELIVERY_LIST_ORDER} LIMIT ? OFFSET ?`,
      [...params, p.page_size, (p.page - 1) * p.page_size],
    );
    const items = await Promise.all(
      notes.map(async (n) => ({
        ...n,
        items: await rows(
          'SELECT * FROM delivery_note_items WHERE delivery_note_id=? AND company_id=? ORDER BY sort,id',
          [n.id, n.company_id],
        ),
      })),
    );
    return { items: await withSourceTasks(items, req.user), total: Number(c.total), ...p };
  }
  @Post('personnel-suggestions') async personnelSuggestions(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ): Promise<Row> {
    manager(req.user);
    const context = z
      .object({
        customer_name: z.string().max(100).default(''),
        delivery_date: businessDate.optional(),
        products: z.array(z.string().max(100)).max(5).default([]),
      })
      .strict()
      .parse(body ?? {});
    return suggestDeliveryPersonnel(req.user, context);
  }
  @Get(':id') async get(@Req() req: AuthRequest, @Param('id') recordId: string): Promise<Row> {
    manager(req.user);
    const note = await scoped('delivery_notes', recordId, req.user);
    return {
      ...(await withSourceTasks([note], req.user))[0],
      items: await rows(
        'SELECT * FROM delivery_note_items WHERE delivery_note_id=? AND company_id=? ORDER BY sort,id',
        [recordId, note.company_id],
      ),
    };
  }
  @Post('from-task/:taskId') async from(
    @Req() req: AuthRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown = {},
  ): Promise<Row> {
    manager(req.user);
    const { request_id } = z
      .object({ request_id: z.string().uuid().optional() })
      .strict()
      .parse(body ?? {});
    const recordId = await db.transaction(async (m) => {
      const task = await taskRecord(taskId, req.user, m, true);
      const [existing] = await rows(
        `SELECT id,company_id,deleted_at FROM delivery_notes WHERE ${companyFilter(req.user).sql} AND source_task_id=? ${request_id ? 'AND conversion_request_id=?' : ''} ORDER BY id ASC LIMIT 1`,
        [...companyFilter(req.user).params, taskId, ...(request_id ? [request_id] : [])],
        m,
      );
      if (existing) {
        if (existing.deleted_at)
          throw new BadRequestException('来源任务已有已删除送货单，需要管理员核查');
        return String(existing.id);
      }
      return insert(
        'delivery_notes',
        {
          company_id: task.company_id,
          note_number: null,
          source_task_id: taskId,
          conversion_request_id: request_id ?? 'legacy',
          delivery_date: task.expected_delivery_at
            ? String(task.expected_delivery_at).slice(0, 10)
            : now().slice(0, 10),
          customer_name_snapshot: '',
          is_draft: 1,
          created_by: req.user.id,
          updated_by: req.user.id,
        },
        m,
      );
    });
    return this.get(req, recordId);
  }
  @Post() create(@Req() req: AuthRequest, @Body() body: unknown): Promise<Row> {
    return this.save(req, body);
  }
  @Put(':id') edit(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
    @Body() body: unknown,
  ): Promise<Row> {
    return this.save(req, body, recordId);
  }
  private async save(req: AuthRequest, body: unknown, recordId?: string): Promise<Row> {
    manager(req.user);
    const v = deliverySchema.parse(body);
    let target = writeUser(req.user);
    const total = amounts(v.items);
    const saved = await db.transaction(async (m) => {
      const old = recordId
        ? await scoped('delivery_notes', recordId, req.user, m, true)
        : undefined;
      const staff = await rows(
        'SELECT name,status,left_on,deleted_at FROM employees FOR UPDATE',
        [],
        m,
      );
      for (const field of deliveryPersonnelFields) {
        if (v[field] && !employeeNameAvailable(v[field].trim(), staff, v.delivery_date))
          throw new BadRequestException('送货日期对应的署名员工已离职，请选择有效人员');
      }
      target = writeUser(req.user, old);
      if (!old)
        target = await inferredOwner(target, v.items.map((item) => item.product_name).join(' '), m);
      if (old?.is_draft === 0 && v.is_draft) throw new BadRequestException('正式单据不能退回草稿');
      if (v.customer_id) await scoped('customers', v.customer_id, target, m, true);
      const customerId = await rememberDeliveryCatalog(v, target, m);
      const { items, ...fields } = v;
      const values = {
        ...fields,
        customer_id: customerId,
        company_id: target.company_id,
        note_number:
          (old && String(old.company_id) === target.company_id ? old.note_number : null) ??
          (v.is_draft ? null : await number(target, v.delivery_date, m)),
        total_amount: total.total,
        printed_at: null,
        updated_by: req.user.id,
      };
      const result =
        recordId ?? (await insert('delivery_notes', { ...values, created_by: req.user.id }, m));
      if (recordId) {
        await update('delivery_notes', recordId, String(old?.company_id), values, m);
        await execute(
          'DELETE FROM delivery_note_items WHERE delivery_note_id=? AND company_id=?',
          [recordId, old?.company_id],
          m,
        );
      }
      for (const [index, item] of items.entries())
        await insert(
          'delivery_note_items',
          {
            ...item,
            amount: total.lines[index],
            company_id: target.company_id,
            delivery_note_id: result,
            sort: index + 1,
          },
          m,
        );
      for (const name of new Set(
        [v.maker_name, v.warehouse_name, v.sales_name, v.deliverer_name].filter(Boolean),
      ))
        await execute(
          'INSERT INTO personnel(company_id,name,last_used_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE last_used_at=VALUES(last_used_at)',
          [target.company_id, name, now()],
          m,
        );
      if (!v.is_draft)
        await rememberCompany(
          'delivery',
          result,
          target,
          v.items.map((item) => item.product_name).join(' '),
          m,
          v.items.map((item) => item.product_name),
          old ? String(old.company_code) : undefined,
        );
      return result;
    });
    req.user = target;
    return this.get(req, saved);
  }
  @Patch(':id/printed') async printed(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
  ): Promise<Row> {
    manager(req.user);
    const note = await scoped('delivery_notes', recordId, req.user);
    if (note.is_draft) throw new BadRequestException('草稿不能标记打印');
    await update('delivery_notes', recordId, String(note.company_id), {
      printed_at: now(),
      updated_by: req.user.id,
    });
    return this.get(req, recordId);
  }
  @Delete(':id') async remove(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
  ): Promise<null> {
    manager(req.user);
    await db.transaction(async (m) => {
      const old = await scoped('delivery_notes', recordId, req.user, m, true);
      await forgetCompany('delivery', recordId, m);
      await update(
        'delivery_notes',
        recordId,
        String(old.company_id),
        { deleted_at: now(), updated_by: req.user.id },
        m,
      );
      await execute(
        'DELETE FROM delivery_note_items WHERE delivery_note_id=? AND company_id=?',
        [recordId, String(old.company_id)],
        m,
      );
    });
    return null;
  }
}
@Controller('delivery-summary')
export class SummaryController {
  @Get() async summary(@Req() req: AuthRequest, @Query() q: Record<string, unknown>): Promise<Row> {
    manager(req.user);
    const currentMonth = now().slice(0, 7);
    const start = date.parse(q.start_date ?? `${currentMonth}-01`);
    const end = date.parse(q.end_date ?? now().slice(0, 10));
    if (start > end) throw new BadRequestException('日期区间错误');
    const mode = z
      .enum(['customers', 'categories', 'products', 'notes'])
      .default('customers')
      .parse(q.mode);
    const scope = companyFilter(req.user, 'dn.company_id');
    const params = [...scope.params, start, end];
    let filter = `${scope.sql} AND dn.delivery_date BETWEEN ? AND ? AND dn.deleted_at IS NULL AND dn.is_draft=0`;
    const category = z
      .union([id, z.literal('uncategorized'), z.literal('')])
      .optional()
      .parse(q.customer_category_id);
    if (category === 'uncategorized') filter += " AND (cc.id IS NULL OR cc.name='未分类')";
    else if (category) {
      filter += ' AND cc.id=?';
      params.push(category);
    }
    if (q.company_code) {
      filter += ' AND dn.company_id=(SELECT id FROM companies WHERE code=?)';
      params.push(z.enum(['tri', 'tmy']).parse(q.company_code));
    }
    // Older imported notes may not have customer_id: match their current company catalog by name.
    const catalog = `LEFT JOIN customers c ON c.id=dn.customer_id OR
      (dn.customer_id IS NULL AND c.company_id=dn.company_id AND c.name=dn.customer_name_snapshot)
      LEFT JOIN customer_categories cc ON cc.id=c.category_id AND cc.deleted_at IS NULL`;
    // One row per delivery prevents its header amount/count from being multiplied by item count.
    const lineTotals = `LEFT JOIN (
      SELECT company_id,delivery_note_id,COUNT(*) item_count,SUM(quantity) quantity
      FROM delivery_note_items GROUP BY company_id,delivery_note_id
    ) li ON li.delivery_note_id=dn.id AND li.company_id=dn.company_id`;
    let items: Row[];
    if (mode === 'products')
      items = await rows(
        `SELECT i.product_name,i.spec,i.unit,COUNT(DISTINCT dn.id) note_count,SUM(i.quantity) quantity,SUM(i.amount) total_amount FROM delivery_note_items i JOIN delivery_notes dn ON dn.id=i.delivery_note_id AND dn.company_id=i.company_id ${catalog} WHERE ${filter} GROUP BY i.product_name,i.spec,i.unit ORDER BY i.product_name,i.spec,i.unit`,
        params,
      );
    else if (mode === 'notes')
      items = await rows(
        `SELECT ${companyColumns('dn')},dn.delivery_date,dn.note_number,dn.customer_name_snapshot,
        COALESCE(cc.name,'未分类') category_name,COALESCE(li.item_count,0) item_count,
        COALESCE(li.quantity,0) quantity,dn.total_amount
        FROM delivery_notes dn ${catalog} ${lineTotals} WHERE ${filter} ORDER BY dn.delivery_date DESC,dn.id DESC`,
        params,
      );
    else if (mode === 'categories')
      items = await rows(
        `SELECT COALESCE(cc.name,'未分类') category_name,COUNT(DISTINCT dn.customer_name_snapshot) customer_count,
        COUNT(*) note_count,SUM(COALESCE(li.item_count,0)) item_count,SUM(COALESCE(li.quantity,0)) quantity,
        SUM(dn.total_amount) total_amount FROM delivery_notes dn ${catalog} ${lineTotals}
        WHERE ${filter} GROUP BY COALESCE(cc.name,'未分类') ORDER BY category_name`,
        params,
      );
    else
      items = await rows(
        `SELECT dn.customer_name_snapshot,COALESCE(cc.name,'未分类') category_name,COUNT(*) note_count,
        SUM(COALESCE(li.item_count,0)) item_count,SUM(COALESCE(li.quantity,0)) quantity,
        SUM(dn.total_amount) total_amount,MAX(dn.delivery_date) last_delivery_date
        FROM delivery_notes dn ${catalog} ${lineTotals} WHERE ${filter}
        GROUP BY dn.customer_name_snapshot,COALESCE(cc.name,'未分类') ORDER BY total_amount DESC,dn.customer_name_snapshot`,
        params,
      );
    items = items.map((item) => ({
      ...item,
      ...Object.fromEntries(
        ['note_count', 'item_count', 'customer_count']
          .filter((key) => key in item)
          .map((key) => [key, Number(item[key])]),
      ),
    }));
    const [available] = await rows(
      `SELECT MIN(dn.delivery_date) first_date,MAX(dn.delivery_date) last_date,COUNT(*) note_count FROM delivery_notes dn WHERE ${scope.sql} AND dn.deleted_at IS NULL AND dn.is_draft=0`,
      scope.params,
    );
    return {
      items,
      total: items.length,
      page: 1,
      page_size: items.length,
      filters: { start_date: start, end_date: end, mode },
      available_range: {
        first_date: available.first_date,
        last_date: available.last_date,
        note_count: Number(available.note_count),
      },
      empty_reason: items.length
        ? null
        : Number(available.note_count)
          ? '所选日期或分类没有正式送货单，请调整筛选范围'
          : '暂无正式送货单，草稿不会计入汇总',
    };
  }
}
