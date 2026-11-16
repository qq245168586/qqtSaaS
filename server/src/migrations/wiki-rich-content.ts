import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WikiRichContent1792773600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS wiki_images (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      oss_key VARCHAR(500) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_size BIGINT UNSIGNED NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      created_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      PRIMARY KEY(id),
      UNIQUE KEY uk_wiki_image_key(oss_key),
      KEY idx_wiki_image_created(created_at,id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }

  async down(): Promise<void> {
    throw new Error('Confluence图片不可自动删除，请使用迁移前备份恢复');
  }
}
