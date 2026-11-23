import { taskRevenue } from './task-revenue';
import { retailFilterPredicate } from './retail-filters';
import { explicitRetailDetails } from './retail-details';
import { orderChannels } from './order-channels';
import { rememberCompany, forgetCompany, inferredOwner } from './company-learning';
import { withTaskLinks, taskDeliveryLinks } from './task-links';
import { companyFilter, companyColumns, writeUser } from './company-scope';
import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  BadRequestException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { z } from 'zod';
import { db, rows, insert, update, execute, Row, now } from './db';
import { AuthRequest, User, manager } from './auth';
import {
  id,
  pageSchema,
  taskSchema,
  canTransition,
  Status,
  statuses,
  orderAmount,
} from './validation';
import { createStorage, type Storage } from './storage';
export async function scoped(
  table: string,
  recordId: string,
  u: User,
  m: EntityManager = db.manager,
  lock = false,
): Promise<Row> {
  id.parse(recordId);
  const [r] = await rows(
    `SELECT *,${companyColumns(table)} FROM ${table} WHERE id=? AND ${companyFilter(u).sql} AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [recordId, ...companyFilter(u).params],
    m,
  );
  if (!r) throw new NotFoundException('记录不存在');
  return r;
}
export async function taskRecord(
  recordId: string,
  u: User,
  m: EntityManager = db.manager,
  lock = false,
): Promise<Row> {
  const r = await scoped('tasks', recordId, u, m, lock);
  if (u.role === 'employee' && String(r.assignee_employee_id) !== u.employee_id)
    throw new NotFoundException('任务不存在');
  return r;
}
export async function globalEmployeeRecord(
  recordId: string,
  m: EntityManager = db.manager,
  lock = false,
): Promise<Row> {
  id.parse(recordId);
  const [employee] = await rows(
    `SELECT * FROM employees WHERE id=? AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [recordId],
    m,
  );
  if (!employee) throw new NotFoundException('员工不存在');
  return employee;
}
export async function globalDepartmentRecord(
  recordId: string,
  m: EntityManager = db.manager,
  lock = false,
): Promise<Row> {
  id.parse(recordId);
  const [department] = await rows(
    `SELECT * FROM departments WHERE id=? AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [recordId],
    m,
  );
  if (!department) throw new NotFoundException('部门不存在');
  return department;
}
export async function globalCategoryRecord(
  recordId: string,
  m: EntityManager = db.manager,
  lock = false,
): Promise<Row> {
  id.parse(recordId);
  const [category] = await rows(
    `SELECT * FROM categories WHERE id=? AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [recordId],
    m,
  );
  if (!category) throw new NotFoundException('业务分类不存在');
  return category;
}
export function taskView(row: Row): Row {
  const { detail, remark, ...rest } = row;
  const recovered = explicitRetailDetails(
    [row.source_text, detail, row.title, remark].filter(Boolean).join('\n'),
  );
  return {
    ...rest,
    product_summary: row.product_summary || recovered.product_summary,
    delivery_address: row.delivery_address || recovered.delivery_address,
    content: detail ?? '',
    note: remark ?? '',
    expected_delivery_at: row.expected_delivery_at
      ? String(row.expected_delivery_at).slice(0, 16)
      : null,
  };
}
import { businessToday, employeeAvailable } from './employee-policy';
async function validateRelations(
  v: z.infer<typeof taskSchema>,
  u: User,
  m: EntityManager,
  old?: Row,
): Promise<void> {
  const documentDate = String(v.expected_delivery_at ?? old?.created_at ?? businessToday()).slice(
    0,
    10,
  );
  const employee = await globalEmployeeRecord(v.assignee_employee_id, m, true);
  if (!employeeAvailable(employee, documentDate))
    throw new BadRequestException('该单据日期员工已离职，不可分配');
  if (v.order_taker_employee_id) {
    const orderTaker = await globalEmployeeRecord(v.order_taker_employee_id, m, true);
    if (!employeeAvailable(orderTaker, documentDate))
      throw new BadRequestException('该单据日期接单人已离职，不可选择');
  }
  if (
    old?.status === 'canceled' &&
    old.department_id === v.department_id &&
    old.assignee_employee_id === v.assignee_employee_id
  ) {
    if (v.category_id && String(old.category_id) !== v.category_id)
      await globalCategoryRecord(v.category_id, m, true);
    return;
  }
  const department = await globalDepartmentRecord(v.department_id, m, true);
  const [employeeDepartment] = await rows(
    'SELECT * FROM departments WHERE id=? AND deleted_at IS NULL FOR UPDATE',
    [employee.department_id],
    m,
  );
  if (!employeeDepartment) throw new BadRequestException('执行人的业务部门不存在');
  if (String(employee.department_id) !== v.department_id)
    throw new BadRequestException('执行人不属于所选业务部门');
  if (v.category_id && String(old?.category_id) !== v.category_id)
    await globalCategoryRecord(v.category_id, m, true);
}
const join = `SELECT t.*,${companyColumns('t')},d.name department_name,e.name assignee_name,ot.name order_taker_name,c.name category_name FROM tasks t LEFT JOIN departments d ON d.id=t.department_id LEFT JOIN employees e ON e.id=t.assignee_employee_id LEFT JOIN employees ot ON ot.id=t.order_taker_employee_id LEFT JOIN categories c ON c.id=t.category_id`;
export async function taskList(u: User, q: Record<string, unknown>): Promise<Row> {
  const p = pageSchema.parse(q);
  const scope = companyFilter(u, 't.company_id');
  const where = [scope.sql, 't.deleted_at IS NULL'];
  const params: unknown[] = [...scope.params];
  const columnFilters = retailFilterPredicate(q.column_filters);
  where.push(columnFilters.sql);
  params.push(...columnFilters.params);
  if (u.role === 'employee') {
    where.push('t.assignee_employee_id=?');
    params.push(u.employee_id ?? '0');
  }
  for (const key of [
    'department_id',
    'assignee_employee_id',
    'order_taker_employee_id',
    'category_id',
  ] as const) {
    if (q[key]) {
      where.push(`t.${key}=?`);
      params.push(id.parse(q[key]));
    }
  }
  if (q.status) {
    where.push('t.status=?');
    params.push(z.enum(statuses).parse(q.status));
  }
  if (q.priority) {
    where.push('t.priority=?');
    params.push(z.enum(['low', 'normal', 'high', 'urgent']).parse(q.priority));
  }
  if (q.keyword) {
    where.push(
      "(t.title LIKE ? ESCAPE '!' OR t.detail LIKE ? ESCAPE '!' OR t.product_summary LIKE ? ESCAPE '!' OR t.delivery_address LIKE ? ESCAPE '!' OR t.customer_name LIKE ? ESCAPE '!')",
    );
    const keyword = `%${z
      .string()
      .max(200)
      .parse(q.keyword)
      .replace(/[!%_]/g, (m) => '!' + m)}%`;
    params.push(keyword, keyword, keyword, keyword, keyword);
  }
  if (q.month) {
    const month = z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .parse(q.month);
    const start = `${month}-01`;
    const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1))
      .toISOString()
      .slice(0, 10);
    where.push(
      '((t.expected_delivery_at>=? AND t.expected_delivery_at<?) OR (t.expected_delivery_at IS NULL AND t.created_at>=? AND t.created_at<?))',
    );
    params.push(start, end, start, end);
  }
  const predicate = where.join(' AND ');
  const [count] = await rows(
    `SELECT COUNT(*) total,
      COALESCE(SUM(CASE WHEN t.status<>'canceled' THEN t.order_amount ELSE 0 END),0) total_amount
     FROM tasks t WHERE ${predicate}`,
    params,
  );
  const items = await rows(
    `${join} WHERE ${predicate} ORDER BY t.created_at DESC,t.id DESC LIMIT ? OFFSET ?`,
    [...params, p.page_size, (p.page - 1) * p.page_size],
  );
  return {
    items: await withTaskLinks(items.map(taskView), u),
    total: Number(count.total),
    total_amount: String(count.total_amount ?? '0.00'),
    ...p,
  };
}
@Controller('tasks')
export class TaskController {
  @Get() list(@Req() req: AuthRequest, @Query() q: Record<string, unknown>): Promise<Row> {
    return taskList(req.user, q);
  }
  @Get('revenue') revenue(@Req() req: AuthRequest, @Query() query: Record<string, unknown>) {
    return taskRevenue(req.user, query);
  }
  @Get('order-channels') channels(@Req() req: AuthRequest) {
    return orderChannels(req.user);
  }
  @Get('stats') async stats(
    @Req() req: AuthRequest,
    @Query() q: Record<string, unknown>,
  ): Promise<Row> {
    const counts: Row = {};
    for (const status of statuses) {
      const result = await taskList(req.user, { ...q, status, page: 1, page_size: 1 });
      counts[status] = result.total;
    }
    return counts;
  }
  @Get(':id') async get(@Req() req: AuthRequest, @Param('id') recordId: string): Promise<Row> {
    const task = await taskRecord(recordId, req.user);
    const [r] = await rows(`${join} WHERE t.id=? AND t.company_id=?`, [recordId, task.company_id]);
    return (await withTaskLinks([taskView(r)], req.user))[0];
  }
  @Get(':id/delivery-notes') async deliveries(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
  ): Promise<Row> {
    await taskRecord(recordId, req.user);
    const links = await taskDeliveryLinks([recordId], req.user);
    const items = links.get(recordId) ?? [];
    return { items, total: items.length, page: 1, page_size: items.length };
  }
  @Post() async create(@Req() req: AuthRequest, @Body() body: unknown): Promise<Row> {
    manager(req.user);
    const v = taskSchema.parse(body);
    const recordId = await db.transaction((m) => this.createOne(v, req.user, m));
    return this.get(req, recordId);
  }
  private async createOne(
    v: z.infer<typeof taskSchema>,
    u: User,
    m: EntityManager,
  ): Promise<string> {
    u = await inferredOwner(
      u,
      `${v.title} ${v.product_summary ?? ''} ${v.content || v.source_text}`,
      m,
    );
    await validateRelations(v, u, m);
    const { content, note, ...values } = v;
    const recordId = await insert(
      'tasks',
      {
        ...values,
        order_channel: v.order_channel ?? (await orderChannels(u, m)).default_channel,
        detail: content,
        remark: note,
        company_id: u.company_id,
        created_by: u.id,
        updated_by: u.id,
      },
      m,
    );
    await rememberCompany(
      'task',
      recordId,
      u,
      `${v.title} ${v.product_summary ?? ''} ${v.content || v.source_text}`,
      m,
    );
    return recordId;
  }
  @Post('batch') async batch(@Req() req: AuthRequest, @Body() body: unknown): Promise<Row> {
    manager(req.user);
    const { items } = z
      .object({
        items: z
          .array(
            req.user.public_access
              ? taskSchema.extend({ company_code: z.enum(['tri', 'tmy']).optional() })
              : taskSchema,
          )
          .min(1)
          .max(200),
      })
      .strict()
      .parse(body);
    const ids = await db.transaction(async (m) => {
      const result: string[] = [];
      for (const item of items) {
        const { company_code, ...v } = item as z.infer<typeof taskSchema> & {
          company_code?: 'tri' | 'tmy';
        };
        let owner = req.user;
        if (req.user.public_access && company_code) {
          const [company] = await rows(
            'SELECT id,code FROM companies WHERE code=?',
            [company_code],
            m,
          );
          if (!company) throw new BadRequestException('公司不存在');
          owner = {
            ...req.user,
            company_id: String(company.id),
            company_code: String(company.code),
            write_company_code: company_code,
          };
        }
        result.push(await this.createOne(v, owner, m));
      }
      return result;
    });
    return { items: await Promise.all(ids.map((recordId) => this.get(req, recordId))) };
  }
  @Put(':id') async edit(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
    @Body() body: unknown,
  ): Promise<Row> {
    manager(req.user);
    const v = taskSchema.parse(body);
    await db.transaction(async (m) => {
      const old = await taskRecord(recordId, req.user, m, true);
      if (!canTransition(old.status as Status, v.status))
        throw new BadRequestException('不允许此状态流转');
      const target = writeUser(req.user, old);
      await validateRelations(v, target, m, old);
      const { content, note, ...values } = v;
      await update(
        'tasks',
        recordId,
        String(old.company_id),
        {
          ...values,
          company_id: target.company_id,
          detail: content,
          remark: note,
          updated_by: req.user.id,
        },
        m,
      );
      await rememberCompany(
        'task',
        recordId,
        target,
        `${v.title} ${v.product_summary ?? ''} ${v.content || v.source_text}`,
        m,
        [],
        String(old.company_code),
      );
      await execute(
        'UPDATE task_images SET company_id=? WHERE task_id=?',
        [target.company_id, recordId],
        m,
      );
    });
    req.user = writeUser(req.user);
    return this.get(req, recordId);
  }
  @Patch(':id/status') async status(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
    @Body() body: unknown,
  ): Promise<Row> {
    const { status } = z
      .object({ status: z.enum(statuses) })
      .strict()
      .parse(body);
    await db.transaction(async (m) => {
      const old = await taskRecord(recordId, req.user, m, true);
      if (req.user.role === 'employee' && !canTransition(old.status as Status, status))
        throw new BadRequestException('状态只能逐步前进或取消');
      await update(
        'tasks',
        recordId,
        String(old.company_id),
        { status, updated_by: req.user.id },
        m,
      );
    });
    return this.get(req, recordId);
  }
  @Patch(':id/entry-progress') async entryProgress(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
    @Body() body: unknown,
  ): Promise<Row> {
    manager(req.user);
    const { entry_progress } = z
      .object({ entry_progress: z.enum(['not_entered', 'entered']) })
      .strict()
      .parse(body);
    await db.transaction(async (m) => {
      const old = await taskRecord(recordId, req.user, m, true);
      await update(
        'tasks',
        recordId,
        String(old.company_id),
        { entry_progress, updated_by: req.user.id },
        m,
      );
    });
    return this.get(req, recordId);
  }
  @Patch(':id/delivery-fee') async deliveryFee(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
    @Body() body: unknown,
  ): Promise<Row> {
    manager(req.user);
    const value = z.object({ delivery_fee: orderAmount }).strict().parse(body);
    await db.transaction(async (m) => {
      const old = await taskRecord(recordId, req.user, m, true);
      await update(
        'tasks',
        recordId,
        String(old.company_id),
        { ...value, updated_by: req.user.id },
        m,
      );
    });
    return this.get(req, recordId);
  }
  @Patch(':id/order-taker') async orderTaker(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
    @Body() body: unknown,
  ): Promise<Row> {
    manager(req.user);
    const value = z.object({ order_taker_employee_id: id }).strict().parse(body);
    await db.transaction(async (m) => {
      const old = await taskRecord(recordId, req.user, m, true);
      const employee = await globalEmployeeRecord(value.order_taker_employee_id, m, true);
      const date = String(old.expected_delivery_at || old.created_at || businessToday()).slice(
        0,
        10,
      );
      if (!employeeAvailable(employee, date))
        throw new BadRequestException('该订单日期接单人已离职，不可选择');
      await update(
        'tasks',
        recordId,
        String(old.company_id),
        { ...value, updated_by: req.user.id },
        m,
      );
    });
    return this.get(req, recordId);
  }
  @Delete(':id') async remove(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
  ): Promise<null> {
    manager(req.user);
    const storageClient: { current: Storage | null } = { current: null };
    const removedImages: Array<{ key: string; data: Buffer }> = [];
    try {
      await db.transaction(async (m) => {
        const old = await taskRecord(recordId, req.user, m, true);
        const images = await rows(
          'SELECT id,oss_key FROM task_images WHERE task_id=? AND company_id=? FOR UPDATE',
          [recordId, String(old.company_id)],
          m,
        );
        if (images.length) storageClient.current = await createStorage();
        for (const image of images) {
          const key = String(image.oss_key);
          let data: Buffer | null = null;
          try {
            data = await storageClient.current!.read(key);
          } catch (error: unknown) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
              throw error;
          }
          await storageClient.current!.delete(key);
          if (data) removedImages.push({ key, data });
        }
        if (images.length)
          await execute(
            'DELETE FROM task_images WHERE task_id=? AND company_id=?',
            [recordId, String(old.company_id)],
            m,
          );
        await forgetCompany('task', recordId, m);
        await update(
          'tasks',
          recordId,
          String(old.company_id),
          { deleted_at: now(), updated_by: req.user.id },
          m,
        );
      });
    } catch (error: unknown) {
      if (storageClient.current)
        for (const image of removedImages)
          await storageClient.current.put(image.key, image.data).catch(() => undefined);
      throw error;
    }
    return null;
  }
}
