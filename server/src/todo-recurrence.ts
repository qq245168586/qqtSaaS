import type { EntityManager } from 'typeorm';
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { db, execute, insert, rows, now, type Row } from './db';
import { monthlyTimes } from './todos-core';

export async function archiveTodo(
  row: Row,
  reason: 'monthly' | 'restart',
  current: string,
  m: EntityManager,
) {
  await insert(
    'todo_history',
    {
      todo_id: String(row.id),
      source_version: Number(row.version),
      reason,
      snapshot_json: JSON.stringify(row),
      archived_at: current,
    },
    m,
  );
}

// Settlement is requested by the app's 30s reminder refresh and before every write.
// A row lock plus the archived version prevents duplicate rolls across app instances.
export async function rollMonthlyTodos(current = now()) {
  const month = current.slice(0, 7);
  const due = await rows(
    "SELECT id FROM todo_items WHERE deleted_at IS NULL AND recurrence='monthly' AND cycle_month<? ORDER BY id",
    [month],
  );
  for (const candidate of due) {
    await db.transaction(async (m) => {
      const [row] = await rows(
        'SELECT * FROM todo_items WHERE id=? FOR UPDATE',
        [String(candidate.id)],
        m,
      );
      if (
        !row ||
        row.deleted_at ||
        row.recurrence !== 'monthly' ||
        !row.cycle_month ||
        String(row.cycle_month) >= month
      )
        return;
      const times = monthlyTimes(String(row.monthly_anchor_end), month);
      await archiveTodo(row, 'monthly', current, m);
      await execute(
        'UPDATE todo_items SET starts_at=?,ends_at=?,progress=0,completed_at=NULL,cycle_month=?,version=version+1,updated_at=? WHERE id=?',
        [times.starts_at, times.ends_at, month, current, String(row.id)],
        m,
      );
    });
  }
}

@Injectable()
export class TodoRecurrenceService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(TodoRecurrenceService.name);
  private async settle() {
    if (this.running) return;
    this.running = true;
    try {
      await rollMonthlyTodos();
    } catch {
      this.logger.error('月度待办结转失败，下次自动重试');
    } finally {
      this.running = false;
    }
  }
  onModuleInit() {
    void this.settle();
    this.timer = setInterval(() => void this.settle(), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
