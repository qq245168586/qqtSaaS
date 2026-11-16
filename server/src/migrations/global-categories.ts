import { MigrationInterface, QueryRunner } from 'typeorm';
import type { Row } from '../db';

/** Business categories are shared master data; document ownership remains company-scoped. */
export class GlobalCategories1793383200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE categories MODIFY company_id BIGINT UNSIGNED NULL DEFAULT NULL',
    );

    const canonical = (await runner.query(
      `SELECT TRIM(name) name,MIN(id) keep_id
         FROM categories
        WHERE deleted_at IS NULL
        GROUP BY TRIM(name)
        ORDER BY MIN(id)`,
    )) as Row[];
    for (const category of canonical) {
      const duplicates = (await runner.query(
        'SELECT id FROM categories WHERE deleted_at IS NULL AND TRIM(name)=? AND id<>? ORDER BY id',
        [category.name, category.keep_id],
      )) as Row[];
      for (const duplicate of duplicates) {
        await runner.query('UPDATE tasks SET category_id=? WHERE category_id=?', [
          category.keep_id,
          duplicate.id,
        ]);
        await runner.query('DELETE FROM categories WHERE id=?', [duplicate.id]);
      }
    }

    await runner.query(
      'UPDATE categories SET name=TRIM(name),company_id=NULL,updated_at=updated_at',
    );
    const indexes = (await runner.query(
      "SELECT DISTINCT INDEX_NAME FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='categories'",
    )) as Row[];
    for (const name of ['uk_company_name', 'idx_company_id']) {
      if (indexes.some((index) => index.INDEX_NAME === name))
        await runner.query(`ALTER TABLE categories DROP INDEX ${name}`);
    }

    const columns = (await runner.query(
      "SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='categories' AND COLUMN_NAME='active_name'",
    )) as Row[];
    if (!columns.length)
      await runner.query(
        'ALTER TABLE categories ADD COLUMN active_name VARCHAR(50) GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN TRIM(name) ELSE NULL END) STORED',
      );
    const activeIndex = (await runner.query(
      "SELECT INDEX_NAME FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='categories' AND INDEX_NAME='uk_category_active_name' LIMIT 1",
    )) as Row[];
    if (!activeIndex.length)
      await runner.query('CREATE UNIQUE INDEX uk_category_active_name ON categories(active_name)');
  }

  async down(): Promise<void> {
    throw new Error('全局业务分类迁移不可按公司自动拆分，请使用迁移前完整备份。');
  }
}
