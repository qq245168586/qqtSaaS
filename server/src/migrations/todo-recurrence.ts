import type { MigrationInterface, QueryRunner } from 'typeorm';

export const todoHistorySql = `CREATE TABLE IF NOT EXISTS todo_history (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 todo_id BIGINT UNSIGNED NOT NULL,
 source_version INT UNSIGNED NOT NULL,
 reason VARCHAR(20) NOT NULL,
 snapshot_json JSON NOT NULL,
 archived_at DATETIME NOT NULL,
 UNIQUE KEY uk_todo_history_version (todo_id,source_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

export class TodoRecurrence1794700800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    for (const [name, definition] of [
      ['recurrence', "VARCHAR(20) NOT NULL DEFAULT 'once'"],
      ['cycle_month', 'CHAR(7) NULL'],
      ['monthly_anchor_end', 'DATETIME NULL'],
      ['completed_at', 'DATETIME NULL'],
      ['import_key', 'VARCHAR(100) NULL'],
    ]) {
      if (!(await q.hasColumn('todo_items', name)))
        await q.query(`ALTER TABLE todo_items ADD COLUMN ${name} ${definition}`);
    }
    const table = await q.getTable('todo_items');
    if (!table?.indices.some((i) => i.name === 'uk_todo_import'))
      await q.query('ALTER TABLE todo_items ADD UNIQUE KEY uk_todo_import (import_key)');
    if (!table?.indices.some((i) => i.name === 'idx_todo_monthly'))
      await q.query(
        'ALTER TABLE todo_items ADD KEY idx_todo_monthly (recurrence,deleted_at,cycle_month)',
      );
    await q.query(todoHistorySql);
  }
  async down(): Promise<void> {
    throw new Error('保留周期待办与历史记录，不自动回退删除数据');
  }
}
