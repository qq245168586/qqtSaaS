import type { MigrationInterface, QueryRunner } from 'typeorm';
export class WikiDirectories1794570000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS wiki_directories (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      path VARCHAR(500) COLLATE utf8mb4_bin NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_wiki_directory_path(path)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    if (!(await q.hasColumn('wiki_pages', 'directory_path'))) {
      await q.query(
        "ALTER TABLE wiki_pages ADD directory_path VARCHAR(500) COLLATE utf8mb4_bin NOT NULL DEFAULT '/', ADD KEY idx_wiki_directory(directory_path,deleted_at)",
      );
    }
  }
  async down(): Promise<void> {
    throw new Error('目录分类不可自动删除，请保留原数据');
  }
}
