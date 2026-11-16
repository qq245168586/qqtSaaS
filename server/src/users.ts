import { Body, Controller, Get, Post, Put, Param, Req, ForbiddenException } from '@nestjs/common';
import { z } from 'zod';
import { hash } from 'bcryptjs';
import { db, rows, insert, update, execute, Row, now } from './db';
import { AuthRequest } from './auth';
import { globalEmployeeRecord, scoped } from './tasks';
import { id } from './validation';
const base = z.object({
  username: z.string().trim().min(1).max(50),
  real_name: z.string().trim().min(1).max(50),
  role: z.enum(['boss', 'admin', 'employee']),
  employee_id: id.nullable().default(null),
  status: z.enum(['active', 'disabled']).default('active'),
});
@Controller('users')
export class UsersController {
  private boss(req: AuthRequest): void {
    if (req.user.role !== 'boss') throw new ForbiddenException('仅老板可管理账号');
  }
  @Get() async list(@Req() req: AuthRequest): Promise<Row> {
    this.boss(req);
    const items = await rows(
      'SELECT id,company_id,username,real_name,role,employee_id,status,must_change_password FROM users WHERE company_id=? AND deleted_at IS NULL',
      [req.user.company_id],
    );
    return { items, total: items.length, page: 1, page_size: items.length };
  }
  @Post() async create(@Req() req: AuthRequest, @Body() body: unknown): Promise<Row> {
    this.boss(req);
    const v = base
      .extend({
        password: z
          .string()
          .min(8)
          .refine((s) => Buffer.byteLength(s) <= 72),
      })
      .strict()
      .parse(body);
    const { password, ...fields } = v;
    if (v.employee_id) await globalEmployeeRecord(v.employee_id);
    if (v.role === 'employee' && !v.employee_id)
      throw new ForbiddenException('员工账号必须关联业务员工');
    const recordId = await insert('users', {
      ...fields,
      company_id: req.user.company_id,
      password_hash: await hash(password, 12),
      must_change_password: 1,
      created_by: req.user.id,
    });
    return { id: recordId, ...fields };
  }
  @Put(':id') async edit(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
    @Body() body: unknown,
  ): Promise<null> {
    this.boss(req);
    const v = base.strict().parse(body);
    if (recordId === req.user.id && (v.role !== 'boss' || v.status !== 'active'))
      throw new ForbiddenException('不可禁用或降级自己的老板账号');
    await db.transaction(async (m) => {
      await scoped('users', recordId, req.user, m, true);
      if (v.employee_id) await globalEmployeeRecord(v.employee_id, m, true);
      if (v.role === 'employee' && !v.employee_id)
        throw new ForbiddenException('员工账号必须关联业务员工');
      await update('users', recordId, req.user.company_id, { ...v, updated_by: req.user.id }, m);
      await execute('UPDATE refresh_tokens SET revoked_at=? WHERE user_id=?', [now(), recordId], m);
    });
    return null;
  }
}
