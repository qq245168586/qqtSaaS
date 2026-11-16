import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthRequest, manager } from './auth';
import { db, execute, insert, now, Row, rows } from './db';
import { globalEmployeeRecord } from './tasks';
import { id } from './validation';
import { businessDate, businessToday, employeeAvailable, standardEnd } from './employee-policy';
import { MONTHLY_REST_DAYS, restBalances } from './employee-rest';

export const scheduleSchema = z
  .object({
    shift_kind: z.enum(['work', 'rest', 'comp_leave']),
    start_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .default(null),
    overtime_minutes: z.number().int().min(0).max(960).default(0),
    timeoff_minutes: z.number().int().min(0).max(480).default(0),
    note: z.string().trim().max(500).default(''),
    version: z.number().int().min(0).max(2147483646),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.shift_kind === 'work' && !v.start_time)
      ctx.addIssue({ code: 'custom', path: ['start_time'], message: '工作排班必须填写开始时间' });
    if (v.shift_kind === 'rest' && v.timeoff_minutes)
      ctx.addIssue({ code: 'custom', path: ['timeoff_minutes'], message: '休息日不能登记调休' });
    if (v.shift_kind === 'comp_leave' && (!v.timeoff_minutes || v.overtime_minutes))
      ctx.addIssue({ code: 'custom', message: '调休班必须填写调休时长且不能同时登记加班' });
  });
export interface Balance {
  employee_id: string;
  opening_minutes: number;
  overtime_minutes: number;
  timeoff_minutes: number;
  balance_minutes: number;
  planned_net_minutes: number;
}
export function scheduleBalances(
  employeeIds: readonly string[],
  entries: readonly Row[],
  month: string,
  today: string,
): Balance[] {
  return employeeIds.map((employeeId) => {
    let opening = 0,
      overtime = 0,
      timeoff = 0,
      planned = 0;
    for (const row of entries) {
      if (String(row.employee_id) !== employeeId || row.deleted_at) continue;
      const date = String(row.work_date).slice(0, 10),
        ot = Number(row.overtime_minutes),
        off = Number(row.timeoff_minutes);
      if (date > today) {
        if (date.startsWith(month)) planned += ot - off;
        continue;
      }
      if (date < `${month}-01`) opening += ot - off;
      else if (date.startsWith(month)) {
        overtime += ot;
        timeoff += off;
      }
    }
    return {
      employee_id: employeeId,
      opening_minutes: opening,
      overtime_minutes: overtime,
      timeoff_minutes: timeoff,
      balance_minutes: opening + overtime - timeoff,
      planned_net_minutes: planned,
    };
  });
}
function view(row: Row): Row {
  const start =
    row.shift_kind === 'work' && row.start_time ? standardEnd(String(row.start_time)) : null;
  return {
    ...row,
    id: String(row.id),
    employee_id: String(row.employee_id),
    version: Number(row.version),
    overtime_minutes: Number(row.overtime_minutes),
    timeoff_minutes: Number(row.timeoff_minutes),
    standard_end: start?.time ?? null,
    end_next_day: start?.next_day ?? false,
  };
}
@Controller('employee-schedules')
export class EmployeeSchedulesController {
  @Get() async list(
    @Req() req: AuthRequest,
    @Query() query: Record<string, unknown>,
  ): Promise<Row> {
    manager(req.user);
    const q = z
      .object({
        month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
        department_id: id.optional(),
      })
      .strict()
      .parse(query);
    const today = businessToday();
    return db.transaction(async (m) => {
      const employees = await rows(
        `SELECT e.id,e.name,e.department_id,e.phone,e.status,e.left_on,e.rest_start_month,d.name department_name FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.deleted_at IS NULL ${q.department_id ? 'AND e.department_id=?' : ''} ORDER BY e.id`,
        q.department_id ? [q.department_id] : [],
        m,
      );
      const ids = employees.map((e) => String(e.id));
      const next = new Date(Date.UTC(Number(q.month.slice(0, 4)), Number(q.month.slice(5, 7)), 1))
        .toISOString()
        .slice(0, 10);
      const entries = ids.length
        ? await rows(
            `SELECT * FROM employee_schedules WHERE employee_id IN (${ids.map(() => '?').join(',')}) AND work_date<? ORDER BY work_date,employee_id`,
            [...ids, next],
            m,
          )
        : [];
      return {
        today,
        month: q.month,
        days: new Date(
          Date.UTC(Number(q.month.slice(0, 4)), Number(q.month.slice(5, 7)), 0),
        ).getUTCDate(),
        employees: employees.map((e) => ({
          ...e,
          id: String(e.id),
          department_id: String(e.department_id),
        })),
        items: entries.filter((e) => String(e.work_date).startsWith(q.month)).map(view),
        balances: scheduleBalances(ids, entries, q.month, today),
        rest_monthly_quota_days: MONTHLY_REST_DAYS,
        rest_balances: restBalances(
          employees.map((e) => ({
            id: String(e.id),
            rest_start_month: z
              .string()
              .regex(/^20\d{2}-(0[1-9]|1[0-2])$/)
              .parse(e.rest_start_month),
            left_on: e.left_on ? String(e.left_on).slice(0, 10) : null,
          })),
          entries,
          q.month,
          today,
        ),
      };
    });
  }
  @Put(':employeeId/:date') async save(
    @Req() req: AuthRequest,
    @Param('employeeId') employeeId: string,
    @Param('date') date: string,
    @Body() body: unknown,
  ): Promise<Row> {
    manager(req.user);
    id.parse(employeeId);
    businessDate.parse(date);
    const v = scheduleSchema.parse(body);
    return db.transaction(async (m) => {
      businessDate.parse(date);
      const employee = await globalEmployeeRecord(employeeId, m, true);
      if (!employeeAvailable(employee, date))
        throw new BadRequestException('该日期员工已离职，不能排班');
      const [old] = await rows(
        'SELECT * FROM employee_schedules WHERE employee_id=? AND work_date=? FOR UPDATE',
        [employeeId, date],
        m,
      );
      if (Number(old?.version ?? 0) !== v.version)
        throw new ConflictException('排班已被其他人修改，请刷新后重新确认');
      const values = {
        ...v,
        start_time: v.shift_kind === 'work' ? v.start_time : null,
        version: v.version + 1,
        deleted_at: null,
        updated_by: req.user.id,
      };
      const savedId = old
        ? String(old.id)
        : await insert(
            'employee_schedules',
            { ...values, employee_id: employeeId, work_date: date, created_by: req.user.id },
            m,
          );
      if (old)
        await execute(
          'UPDATE employee_schedules SET shift_kind=?,start_time=?,overtime_minutes=?,timeoff_minutes=?,note=?,version=?,deleted_at=NULL,updated_by=?,updated_at=? WHERE id=?',
          [
            values.shift_kind,
            values.start_time,
            values.overtime_minutes,
            values.timeoff_minutes,
            values.note,
            values.version,
            req.user.id,
            now(),
            savedId,
          ],
          m,
        );
      const [saved] = await rows('SELECT * FROM employee_schedules WHERE id=?', [savedId], m);
      await insert(
        'employee_schedule_audit',
        {
          schedule_id: savedId,
          employee_id: employeeId,
          work_date: date,
          action: 'save',
          before_json: old ? JSON.stringify(old) : null,
          after_json: JSON.stringify(saved),
          actor_id: req.user.id,
        },
        m,
      );
      return view(saved);
    });
  }
  @Delete(':employeeId/:date') async clear(
    @Req() req: AuthRequest,
    @Param('employeeId') employeeId: string,
    @Param('date') date: string,
    @Body() body: unknown,
  ): Promise<null> {
    manager(req.user);
    id.parse(employeeId);
    businessDate.parse(date);
    const v = z
      .object({ version: z.number().int().min(1).max(2147483646) })
      .strict()
      .parse(body);
    await db.transaction(async (m) => {
      businessDate.parse(date);
      await globalEmployeeRecord(employeeId, m, true);
      const [old] = await rows(
        'SELECT * FROM employee_schedules WHERE employee_id=? AND work_date=? FOR UPDATE',
        [employeeId, date],
        m,
      );
      if (!old || old.deleted_at || Number(old.version) !== v.version)
        throw new ConflictException('排班已被其他人修改，请刷新后重新确认');
      await execute(
        'UPDATE employee_schedules SET deleted_at=?,version=version+1,updated_by=?,updated_at=? WHERE id=?',
        [now(), req.user.id, now(), old.id],
        m,
      );
      const [saved] = await rows('SELECT * FROM employee_schedules WHERE id=?', [old.id], m);
      await insert(
        'employee_schedule_audit',
        {
          schedule_id: String(old.id),
          employee_id: employeeId,
          work_date: date,
          action: 'clear',
          before_json: JSON.stringify(old),
          after_json: JSON.stringify(saved),
          actor_id: req.user.id,
        },
        m,
      );
    });
    return null;
  }
}
@Controller('employees')
export class EmployeeDepartureController {
  @Post(':id/departure') async depart(
    @Req() req: AuthRequest,
    @Param('id') employeeId: string,
    @Body() body: unknown,
  ): Promise<Row> {
    manager(req.user);
    id.parse(employeeId);
    const v = z.object({ left_on: businessDate }).strict().parse(body);
    return db.transaction(async (m) => {
      const employee = await globalEmployeeRecord(employeeId, m, true);
      if (employee.status === 'left' || employee.left_on)
        throw new BadRequestException('已登记离职，不能覆盖离职日期');
      await execute(
        "UPDATE employees SET status='left',left_on=?,updated_by=?,updated_at=? WHERE id=?",
        [v.left_on, req.user.id, now(), employeeId],
        m,
      );
      const { company_id: _companyId, ...saved } = await globalEmployeeRecord(employeeId, m);
      return saved;
    });
  }
}
