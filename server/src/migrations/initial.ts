import { MigrationInterface, QueryRunner } from 'typeorm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export class InitialSchema1770000000000 implements MigrationInterface {
  public async up(runner: QueryRunner): Promise<void> {
    for (const statement of readFileSync(join(__dirname, 'schema.sql'), 'utf8')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await runner.query(statement);
  }
  public async down(): Promise<void> {
    throw new Error('禁止自动删除业务库；回滚请使用经过验证的备份。');
  }
}
