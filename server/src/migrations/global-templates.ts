import { MigrationInterface, QueryRunner } from 'typeorm';
import type { Row } from '../db';
/** MySQL DDL auto-commits: every step is restartable. Run during a maintenance window. */
export class GlobalTemplates1790091000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE print_templates MODIFY company_id BIGINT UNSIGNED NULL DEFAULT NULL',
    );
    const indexRows = (await runner.query(
      "SELECT DISTINCT INDEX_NAME FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='print_templates'",
    )) as Row[];
    for (const name of ['uk_company_name', 'idx_company_default']) {
      if (indexRows.some((index) => index.INDEX_NAME === name))
        await runner.query(`ALTER TABLE print_templates DROP INDEX ${name}`);
    }
    const candidates: Row[] = (await runner.query(
      'SELECT id FROM print_templates WHERE deleted_at IS NULL ORDER BY is_default DESC,updated_at DESC,id DESC LIMIT 1',
    )) as Row[];
    await runner.query(
      "UPDATE print_templates SET company_id=NULL,is_default=0,config_json=JSON_REMOVE(config_json,'$.companyId'),updated_at=updated_at",
    );
    if (candidates[0])
      await runner.query(
        'UPDATE print_templates SET is_default=1,updated_at=updated_at WHERE id=?',
        [candidates[0].id],
      );
    await runner.query(
      "UPDATE print_templates SET config_json=JSON_SET(config_json,'$.isDefault',IF(is_default=1,CAST('true' AS JSON),CAST('false' AS JSON))),updated_at=updated_at",
    );
    const columns = (await runner.query(
      "SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='print_templates' AND COLUMN_NAME='global_default_slot'",
    )) as Row[];
    if (columns.length === 0)
      await runner.query(
        'ALTER TABLE print_templates ADD COLUMN global_default_slot TINYINT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL AND is_default=1 THEN 1 ELSE NULL END) STORED',
      );
    const globalIndex = (await runner.query(
      "SELECT INDEX_NAME FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='print_templates' AND INDEX_NAME='uk_global_default' LIMIT 1",
    )) as Row[];
    if (globalIndex.length === 0)
      await runner.query(
        'CREATE UNIQUE INDEX uk_global_default ON print_templates(global_default_slot)',
      );
  }
  async down(): Promise<void> {
    throw new Error('全局模板迁移不能按公司自动回滚，请使用迁移前完整备份。');
  }
}
