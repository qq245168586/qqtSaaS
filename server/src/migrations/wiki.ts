import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WikiPages1792770000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS wiki_pages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      parent_id BIGINT UNSIGNED NULL,
      title VARCHAR(200) NOT NULL,
      icon VARCHAR(16) NOT NULL DEFAULT '📄',
      content_json JSON NOT NULL,
      content_text MEDIUMTEXT NOT NULL,
      position INT NOT NULL DEFAULT 0,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      created_by BIGINT UNSIGNED NULL,
      updated_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      PRIMARY KEY(id),
      KEY idx_wiki_parent_position(parent_id,position,id),
      KEY idx_wiki_updated(updated_at,id),
      CONSTRAINT fk_wiki_parent FOREIGN KEY(parent_id) REFERENCES wiki_pages(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await q.query(`CREATE TABLE IF NOT EXISTS wiki_page_versions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      page_id BIGINT UNSIGNED NOT NULL,
      version INT UNSIGNED NOT NULL,
      title VARCHAR(200) NOT NULL,
      icon VARCHAR(16) NOT NULL,
      content_json JSON NOT NULL,
      content_text MEDIUMTEXT NOT NULL,
      created_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      UNIQUE KEY uk_wiki_page_version(page_id,version),
      KEY idx_wiki_version_created(page_id,created_at,id),
      CONSTRAINT fk_wiki_version_page FOREIGN KEY(page_id) REFERENCES wiki_pages(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }

  async down(): Promise<void> {
    throw new Error('知识库页面及版本历史不可自动删除，请使用迁移前备份恢复');
  }
}
