import { companyFilter, companyColumns, writeUser } from './company-scope';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  Query,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { db, rows, insert, update, execute, Row, now } from './db';
import { AuthRequest, manager } from './auth';
import {
  globalCategoryRecord,
  globalDepartmentRecord,
  globalEmployeeRecord,
  scoped,
} from './tasks';
import { id, pageSchema, decimal } from './validation';
import { businessDate, businessToday } from './employee-policy';
const short = z.string().trim().min(1).max(50);
const sort = z.number().int().min(-100000).max(100000).default(0);
const active = z.union([z.literal(0), z.literal(1)]).default(1);
const schemas: Record<string, z.ZodType> = {
  departments: z.object({ name: short, sort }).strict(),
  categories: z.object({ name: short, sort }).strict(),
  'customer-categories': z.object({ name: short, sort }).strict(),
  employees: z
    .object({
      name: short,
      department_id: id,
      phone: z.string().max(30).default(''),
      status: z.enum(['active', 'left']).default('active'),
      left_on: businessDate.nullable().optional(),
    })
    .strict(),
  customers: z
    .object({
      name: z.string().trim().min(1).max(100),
      code: z.string().max(50).default(''),
      address: z.string().max(255).default(''),
      contact: z.string().max(50).default(''),
      phone: z.string().max(30).default(''),
      category_id: id.nullable().default(null),
      active,
    })
    .strict(),
  products: z
    .object({
      name: z.string().trim().min(1).max(100),
      spec: z.string().max(100).default(''),
      unit: z.string().min(1).max(20),
      default_price: decimal.default('0'),
      active,
      sort,
    })
    .strict(),
  personnel: z
    .object({
      name: short,
      role_type: z.enum(['maker', 'warehouse', 'sales', 'deliverer', 'general']).default('general'),
      sort,
    })
    .strict(),
};
export const resources = Object.keys(schemas);
function table(resource: string): string {
  if (!schemas[resource]) throw new NotFoundException();
  return resource.replaceAll('-', '_');
}
export function resourceView(resource: string, row: Row): Row {
  if (!['departments', 'employees', 'categories'].includes(resource)) return row;
  const {
    company_id: _companyId,
    company_code: _companyCode,
    company_name: _companyName,
    ...view
  } = row;
  return view;
}
@Controller()
export class CatalogController {
  @Get([
    'departments',
    'employees',
    'categories',
    'customers',
    'customer-categories',
    'products',
    'personnel',
  ])
  async list(@Req() req: AuthRequest, @Query() q: Record<string, unknown>): Promise<Row> {
    manager(req.user);
    const resource = req.path.split('/').at(-1) ?? '';
    const t = table(resource);
    const p = pageSchema.parse(q);
    const global = ['departments', 'employees', 'categories'].includes(t);
    const scope = global ? { sql: '1=1', params: [] } : companyFilter(req.user);
    const params: unknown[] = [...scope.params];
    let filter = `${scope.sql} AND deleted_at IS NULL`;
    if (q.department_id && t === 'employees') {
      filter += ' AND department_id=?';
      params.push(id.parse(q.department_id));
    }
    if (q.keyword) {
      filter += ' AND name LIKE ?';
      params.push(`%${z.string().max(200).parse(q.keyword)}%`);
    }
    const [count] = await rows(`SELECT COUNT(*) total FROM ${t} WHERE ${filter}`, params);
    const items = await rows(
      `SELECT ${global ? '*' : `*,${companyColumns(t)}`} FROM ${t} WHERE ${filter} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, p.page_size, (p.page - 1) * p.page_size],
    );
    return { items: items.map((item) => resourceView(t, item)), total: Number(count.total), ...p };
  }
  @Get([
    'departments/:id',
    'employees/:id',
    'categories/:id',
    'customers/:id',
    'customer-categories/:id',
    'products/:id',
    'personnel/:id',
  ])
  async get(@Req() req: AuthRequest, @Param('id') recordId: string): Promise<Row> {
    manager(req.user);
    const resource = table(req.path.split('/')[2]);
    const item =
      resource === 'departments'
        ? await globalDepartmentRecord(recordId)
        : resource === 'employees'
          ? await globalEmployeeRecord(recordId)
          : resource === 'categories'
            ? await globalCategoryRecord(recordId)
          : await scoped(resource, recordId, req.user);
    return resourceView(resource, item);
  }
  @Post([
    'departments',
    'employees',
    'categories',
    'customers',
    'customer-categories',
    'products',
    'personnel',
  ])
  async create(@Req() req: AuthRequest, @Body() body: unknown): Promise<Row> {
    return this.save(req, body);
  }
  @Put([
    'departments/:id',
    'employees/:id',
    'categories/:id',
    'customers/:id',
    'customer-categories/:id',
    'products/:id',
    'personnel/:id',
  ])
  async edit(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Param('id') recordId: string,
  ): Promise<Row> {
    return this.save(req, body, recordId);
  }
  private async save(req: AuthRequest, body: unknown, recordId?: string): Promise<Row> {
    manager(req.user);
    const resource = req.path.split('/')[2];
    const t = table(resource);
    const v = schemas[resource].parse(body) as Row;
    return db.transaction(async (m) => {
      const old = recordId
        ? t === 'departments'
          ? await globalDepartmentRecord(recordId, m, true)
          : t === 'employees'
            ? await globalEmployeeRecord(recordId, m, true)
            : t === 'categories'
              ? await globalCategoryRecord(recordId, m, true)
            : await scoped(t, recordId, req.user, m, true)
        : undefined;
      if (t === 'customer_categories' && old?.name === '未分类' && v.name !== '未分类')
        throw new BadRequestException('未分类不可重命名');
      if (t === 'employees') {
        if (!old) v.rest_start_month = businessToday().slice(0, 7);
        if (
          old?.status === 'left' &&
          (v.status !== 'left' || (v.left_on != null && v.left_on !== old.left_on))
        )
          throw new BadRequestException('已登记离职，不能复职或覆盖离职日期');
        if (v.status === 'active' && v.left_on)
          throw new BadRequestException('在职员工不能填写离职日期');
        v.left_on = v.status === 'left' ? (v.left_on ?? old?.left_on ?? businessToday()) : null;
        await globalDepartmentRecord(String(v.department_id), m, true);
        if (old && String(old.department_id) !== v.department_id) {
          const [count] = await rows(
            "SELECT COUNT(*) total FROM tasks WHERE assignee_employee_id=? AND status<>'canceled' AND deleted_at IS NULL",
            [recordId],
            m,
          );
          if (Number(count.total)) throw new BadRequestException('员工有非取消任务，不能调部门');
        }
      }
      if (t === 'customers' && v.category_id)
        await scoped('customer_categories', String(v.category_id), req.user, m, true);
      const saved =
        recordId ??
        (await insert(
          t,
          {
            ...v,
            company_id: ['departments', 'employees', 'categories'].includes(t)
              ? null
              : req.user.company_id,
            created_by: req.user.id,
            updated_by: req.user.id,
          },
          m,
        ));
      if (recordId) {
        if (t === 'departments')
          await execute(
            'UPDATE departments SET name=?,sort=?,company_id=NULL,updated_by=? WHERE id=?',
            [v.name, v.sort, req.user.id, recordId],
            m,
          );
        else if (t === 'employees')
          await execute(
            'UPDATE employees SET name=?,department_id=?,phone=?,status=?,left_on=?,company_id=NULL,updated_by=? WHERE id=?',
            [v.name, v.department_id, v.phone, v.status, v.left_on, req.user.id, recordId],
            m,
          );
        else if (t === 'categories')
          await execute(
            'UPDATE categories SET name=?,sort=?,company_id=NULL,updated_by=? WHERE id=?',
            [v.name, v.sort, req.user.id, recordId],
            m,
          );
        else
          await update(
            t,
            recordId,
            String(old?.company_id),
            { ...v, company_id: writeUser(req.user, old).company_id, updated_by: req.user.id },
            m,
          );
      }
      const item =
        t === 'departments'
          ? await globalDepartmentRecord(saved, m)
          : t === 'employees'
            ? await globalEmployeeRecord(saved, m)
            : t === 'categories'
              ? await globalCategoryRecord(saved, m)
            : await scoped(t, saved, req.user, m);
      return resourceView(t, item);
    });
  }
  @Delete([
    'departments/:id',
    'employees/:id',
    'categories/:id',
    'customers/:id',
    'customer-categories/:id',
    'products/:id',
    'personnel/:id',
  ])
  async remove(@Req() req: AuthRequest, @Param('id') recordId: string): Promise<null> {
    manager(req.user);
    const t = table(req.path.split('/')[2]);
    await db.transaction(async (m) => {
      const old =
        t === 'departments'
          ? await globalDepartmentRecord(recordId, m, true)
          : t === 'employees'
            ? await globalEmployeeRecord(recordId, m, true)
            : t === 'categories'
              ? await globalCategoryRecord(recordId, m, true)
            : await scoped(t, recordId, req.user, m, true);
      if (t === 'departments' || t === 'employees') {
        const [schedules] = await rows(
          t === 'employees'
            ? 'SELECT COUNT(*) total FROM employee_schedules WHERE employee_id=?'
            : 'SELECT COUNT(*) total FROM employee_schedules s JOIN employees e ON e.id=s.employee_id WHERE e.department_id=?',
          [recordId],
          m,
        );
        if (Number(schedules.total))
          throw new BadRequestException('员工有排班历史，不能删除，请登记离职');
        const field = t === 'departments' ? 'department_id' : 'assignee_employee_id';
        const [count] = await rows(
          `SELECT COUNT(*) total FROM tasks WHERE ${field}=? AND status<>'canceled' AND deleted_at IS NULL`,
          [recordId],
          m,
        );
        if (Number(count.total)) throw new BadRequestException('存在非取消任务，不能删除');
        if (t === 'departments')
          await execute(
            'UPDATE employees SET deleted_at=? WHERE department_id=?',
            [now(), recordId],
            m,
          );
      }
      if (t === 'customer_categories') {
        if (old.name === '未分类') throw new BadRequestException('未分类不能删除');
        const [count] = await rows(
          'SELECT COUNT(*) total FROM customers WHERE category_id=? AND deleted_at IS NULL AND active=1',
          [recordId],
          m,
        );
        if (Number(count.total)) throw new BadRequestException('分类仍被客户使用');
      }
      if (['departments', 'employees', 'categories'].includes(t))
        await execute(
          `UPDATE ${t} SET deleted_at=?,updated_by=? WHERE id=?`,
          [now(), req.user.id, recordId],
          m,
        );
      else
        await update(
          t,
          recordId,
          String(old.company_id),
          { deleted_at: now(), updated_by: req.user.id },
          m,
        );
    });
    return null;
  }
}
