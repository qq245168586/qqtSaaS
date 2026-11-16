import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { manager, type AuthRequest } from './auth';
import { db, execute, insert, now, rows, type Row } from './db';
import { id } from './validation';
import { todoCreate, todoUpdate, todoOverdue, restartTimes } from './todos-core';
import { archiveTodo, rollMonthlyTodos } from './todo-recurrence';
import type { EntityManager } from 'typeorm';
const querySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['all', 'open', 'done', 'overdue']).default('open'),
    keyword: z.string().trim().max(200).default(''),
    recurrence: z.enum(['all', 'once', 'monthly']).default('all'),
  })
  .strict();
function view(row: Row, current: string) {
  return {
    ...row,
    id: String(row.id),
    progress: Number(row.progress) === 100 ? 100 : 0,
    recurrence: row.recurrence ?? 'once',
    cycle_month: row.cycle_month ?? null,
    completed_at: row.completed_at ?? null,
    reminder:
      Number(row.progress) < 100 &&
      (todoOverdue(Number(row.progress), String(row.ends_at), current) ||
        (row.recurrence === 'monthly' &&
          String(row.starts_at).slice(0, 16) <= current.slice(0, 16))),
    version: Number(row.version),
    starts_at: String(row.starts_at).slice(0, 16),
    ends_at: String(row.ends_at).slice(0, 16),
    overdue: todoOverdue(Number(row.progress), String(row.ends_at), current),
  };
}
async function locked(recordId: string, m: EntityManager) {
  const [row] = await rows(
    'SELECT * FROM todo_items WHERE id=? AND deleted_at IS NULL FOR UPDATE',
    [id.parse(recordId)],
    m,
  );
  if (!row) throw new NotFoundException('待办事项不存在');
  return row;
}
@Controller('todos')
export class TodosController {
  @Get('reminders') async reminders() {
    const current = now();
    await rollMonthlyTodos(current);
    const [row] = await rows(
      "SELECT COUNT(*) AS overdue_count FROM todo_items WHERE deleted_at IS NULL AND progress<100 AND (ends_at<=? OR (recurrence='monthly' AND starts_at<=?))",
      [current, current],
    );
    return { overdue_count: Number(row.overdue_count), server_now: current };
  }
  @Get() async list(@Query() query: unknown) {
    const q = querySchema.parse(query),
      current = now();
    await rollMonthlyTodos(current);
    const clauses = ['deleted_at IS NULL'],
      params: unknown[] = [];
    if (q.status === 'open') clauses.push('progress<100');
    if (q.status === 'done') clauses.push('progress=100');
    if (q.recurrence !== 'all') {
      clauses.push('recurrence=?');
      params.push(q.recurrence);
    }
    if (q.status === 'overdue') {
      clauses.push('progress<100 AND ends_at<=?');
      params.push(current);
    }
    if (q.keyword) {
      clauses.push('(LOCATE(?,title)>0 OR LOCATE(?,note)>0)');
      params.push(q.keyword, q.keyword);
    }
    const where = clauses.join(' AND ');
    const [count] = await rows(`SELECT COUNT(*) AS total FROM todo_items WHERE ${where}`, params);
    const items = await rows(
      `SELECT * FROM todo_items WHERE ${where} ORDER BY (progress=100),ends_at,id DESC LIMIT ? OFFSET ?`,
      [...params, q.page_size, (q.page - 1) * q.page_size],
    );
    return {
      items: items.map((r) => view(r, current)),
      total: Number(count.total),
      page: q.page,
      page_size: q.page_size,
      server_now: current,
    };
  }
  @Post() async create(@Body() body: unknown, @Req() req: AuthRequest) {
    manager(req.user);
    const v = todoCreate.parse(body),
      current = now();
    const newId = await insert('todo_items', {
      ...v,
      cycle_month: v.recurrence === 'monthly' ? v.ends_at.slice(0, 7) : null,
      monthly_anchor_end: v.recurrence === 'monthly' ? v.ends_at : null,
      completed_at: v.progress === 100 ? current : null,
      version: 1,
      created_at: current,
      updated_at: current,
    });
    return view(
      {
        ...v,
        id: newId,
        version: 1,
        cycle_month: v.recurrence === 'monthly' ? v.ends_at.slice(0, 7) : null,
        completed_at: v.progress === 100 ? current : null,
      },
      current,
    );
  }
  @Put(':id') async edit(
    @Param('id') recordId: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    manager(req.user);
    const { version, ...v } = todoUpdate.parse(body);
    await rollMonthlyTodos();
    return db.transaction(async (m) => {
      const old = await locked(recordId, m);
      if (Number(old.version) !== version)
        throw new ConflictException('事项已被其他人修改，请刷新后重试');
      const current = now();
      const scheduleChanged =
        old.recurrence !== v.recurrence ||
        String(old.starts_at).slice(0, 16) !== v.starts_at ||
        String(old.ends_at).slice(0, 16) !== v.ends_at;
      const cycleMonth =
        v.recurrence === 'monthly'
          ? scheduleChanged
            ? v.ends_at.slice(0, 7)
            : old.cycle_month
          : null;
      const anchorEnd =
        v.recurrence === 'monthly' ? (scheduleChanged ? v.ends_at : old.monthly_anchor_end) : null;
      const completedAt =
        v.progress === 100
          ? Number(old.progress) === 100
            ? (old.completed_at ?? current)
            : current
          : null;
      await execute(
        'UPDATE todo_items SET title=?,note=?,starts_at=?,ends_at=?,progress=?,recurrence=?,cycle_month=?,monthly_anchor_end=?,completed_at=?,version=version+1,updated_at=? WHERE id=?',
        [
          v.title,
          v.note,
          v.starts_at,
          v.ends_at,
          v.progress,
          v.recurrence,
          cycleMonth,
          anchorEnd,
          completedAt,
          current,
          recordId,
        ],
        m,
      );
      return view(
        {
          ...v,
          cycle_month: cycleMonth,
          completed_at: completedAt,
          id: recordId,
          version: version + 1,
        },
        current,
      );
    });
  }
  @Post(':id/restart') async restart(
    @Param('id') recordId: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    manager(req.user);
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(body);
    await rollMonthlyTodos();
    return db.transaction(async (m) => {
      const old = await locked(recordId, m);
      if (Number(old.version) !== version) throw new ConflictException('事项已更新，请刷新后重试');
      if (Number(old.progress) !== 100)
        throw new BadRequestException('只有已完成的待办可以重新开始');
      const current = now();
      const times = restartTimes(String(old.starts_at), String(old.ends_at), current);
      const cycleMonth = old.recurrence === 'monthly' ? times.ends_at.slice(0, 7) : null;
      const anchorEnd = old.recurrence === 'monthly' ? times.ends_at : null;
      await archiveTodo(old, 'restart', current, m);
      await execute(
        'UPDATE todo_items SET starts_at=?,ends_at=?,progress=0,completed_at=NULL,cycle_month=?,monthly_anchor_end=?,version=version+1,updated_at=? WHERE id=?',
        [times.starts_at, times.ends_at, cycleMonth, anchorEnd, current, recordId],
        m,
      );
      return view(
        {
          ...old,
          ...times,
          progress: 0,
          completed_at: null,
          cycle_month: cycleMonth,
          monthly_anchor_end: anchorEnd,
          version: version + 1,
        },
        current,
      );
    });
  }
  @Get(':id/history') async history(@Param('id') recordId: string, @Query() query: unknown) {
    const q = z
      .object({ page: z.coerce.number().int().min(1).default(1) })
      .strict()
      .parse(query);
    const [exists] = await rows('SELECT id FROM todo_items WHERE id=? AND deleted_at IS NULL', [
      id.parse(recordId),
    ]);
    if (!exists) throw new NotFoundException('待办事项不存在');
    const [count] = await rows('SELECT COUNT(*) AS total FROM todo_history WHERE todo_id=?', [
      recordId,
    ]);
    const history = await rows(
      'SELECT * FROM todo_history WHERE todo_id=? ORDER BY id DESC LIMIT 20 OFFSET ?',
      [recordId, (q.page - 1) * 20],
    );
    return {
      items: history.map((r) => ({
        id: String(r.id),
        reason: r.reason,
        archived_at: r.archived_at,
        snapshot:
          typeof r.snapshot_json === 'string'
            ? (JSON.parse(r.snapshot_json) as Row)
            : r.snapshot_json,
      })),
      total: Number(count.total),
      page: q.page,
      page_size: 20,
    };
  }
  @Delete(':id') async remove(
    @Param('id') recordId: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    manager(req.user);
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(body);
    await db.transaction(async (m) => {
      const old = await locked(recordId, m);
      if (Number(old.version) !== version)
        throw new ConflictException('事项已被其他人修改，请刷新后重试');
      await execute(
        'UPDATE todo_items SET deleted_at=?,updated_at=?,version=version+1 WHERE id=?',
        [now(), now(), recordId],
        m,
      );
    });
    return null;
  }
}
