import { MigrationInterface, QueryRunner } from 'typeorm';
import type { Row } from '../db';
export class CompanyLearningLinks1790100000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE IF NOT EXISTS company_choice_samples (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,entity_type ENUM('task','delivery') NOT NULL,entity_id BIGINT UNSIGNED NOT NULL,
 keyword VARCHAR(40) NOT NULL,company_code ENUM('tri','tmy') NOT NULL,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(id),UNIQUE KEY uk_entity_keyword(entity_type,entity_id,keyword),KEY idx_keyword_time(keyword,updated_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const columns = (await runner.query(
      "SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='delivery_notes' AND COLUMN_NAME='conversion_request_id'",
    )) as Row[];
    if (!columns.length)
      await runner.query(
        'ALTER TABLE delivery_notes ADD COLUMN conversion_request_id VARCHAR(64) NULL DEFAULT NULL',
      );
    const indices = (await runner.query(
      "SELECT DISTINCT INDEX_NAME FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='delivery_notes'",
    )) as Row[];
    if (indices.some((row) => row.INDEX_NAME === 'uk_source_task'))
      await runner.query('ALTER TABLE delivery_notes DROP INDEX uk_source_task');
    if (!indices.some((row) => row.INDEX_NAME === 'idx_source_task'))
      await runner.query('CREATE INDEX idx_source_task ON delivery_notes(source_task_id)');
    if (!indices.some((row) => row.INDEX_NAME === 'uk_task_conversion'))
      await runner.query(
        'CREATE UNIQUE INDEX uk_task_conversion ON delivery_notes(source_task_id,conversion_request_id)',
      );
  }
  async down(): Promise<void> {
    throw new Error('学习与多单关联迁移不可自动回滚，避免丢失多张单据；请使用备份。');
  }
}
