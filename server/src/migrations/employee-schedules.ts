import { MigrationInterface, QueryRunner } from 'typeorm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export class EmployeeSchedules1791170000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('employees', 'left_on'))) {
      await q.query('ALTER TABLE employees ADD COLUMN left_on DATE NULL DEFAULT NULL');
      await q.query(
        "UPDATE employees SET left_on=DATE(updated_at) WHERE status='left' AND left_on IS NULL",
      );
    }
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    for (const table of ['employee_schedules', 'employee_schedule_audit']) {
      if (await q.hasTable(table)) continue;
      const statement = schema.split(';').find((s) => s.includes('CREATE TABLE `' + table + '`'));
      if (!statement) throw new Error('排班迁移缺少表定义');
      await q.query(statement);
    }
  }
  async down(): Promise<void> {
    throw new Error('排班含真实业务数据，请使用兼容旧服务回滚，不可自动删表');
  }
}
