import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TaskEntryProgress1793376000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('tasks', 'entry_progress')))
      await q.query(
        "ALTER TABLE tasks ADD COLUMN entry_progress VARCHAR(20) NOT NULL DEFAULT 'not_entered' AFTER order_channel",
      );
  }

  async down(): Promise<void> {
    throw new Error('任务录入进度不可自动回滚，请使用迁移前备份恢复');
  }
}
