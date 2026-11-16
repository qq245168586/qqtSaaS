import { MigrationInterface, QueryRunner } from 'typeorm';
export const todoTableSql = `CREATE TABLE IF NOT EXISTS todo_items (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 title VARCHAR(200) NOT NULL,
 note TEXT NOT NULL,
 starts_at DATETIME NOT NULL,
 ends_at DATETIME NOT NULL,
 progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
 version INT UNSIGNED NOT NULL DEFAULT 1,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL,
 deleted_at DATETIME NULL,
 KEY idx_todo_due (deleted_at,progress,ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
export class Todos1794528000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(todoTableSql);
  }
  async down(): Promise<void> {
    throw new Error('保留待办事项，不自动删除业务数据');
  }
}
