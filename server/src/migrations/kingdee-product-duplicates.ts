import { MigrationInterface, QueryRunner } from 'typeorm';
import type { Row } from '../db';

async function indexExists(runner: QueryRunner, index: string): Promise<boolean> {
  const records = (await runner.query(
    'SELECT INDEX_NAME FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1',
    ['products', index],
  )) as Row[];
  return records.length > 0;
}

/** Kingdee permits distinct product codes with the same name and specification. */
export class KingdeeProductDuplicates1790610000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (await indexExists(runner, 'uk_company_name_spec'))
      await runner.query('ALTER TABLE products DROP INDEX uk_company_name_spec');
    if (!(await indexExists(runner, 'idx_company_name_spec')))
      await runner.query('CREATE INDEX idx_company_name_spec ON products(company_id,name,spec)');
  }

  async down(): Promise<void> {
    throw new Error('金蝶允许同名同规格不同编码，不能自动恢复唯一约束。');
  }
}
