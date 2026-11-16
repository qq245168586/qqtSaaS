import type { MigrationInterface, QueryRunner } from 'typeorm';
import { businessToday } from '../employee-policy';

export class EmployeeRest1791295000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('employees', 'rest_start_month'))) {
      await q.query('ALTER TABLE employees ADD COLUMN rest_start_month CHAR(7) NULL');
    }
    // 现有员工从上线当月开始，不凭空生成之前月份未记录的休假余额。
    await q.query('UPDATE employees SET rest_start_month=? WHERE rest_start_month IS NULL', [
      businessToday().slice(0, 7),
    ]);
  }
  async down(): Promise<void> {
    throw new Error('例休累计起始月份属于真实业务配置，不可自动删除');
  }
}
