import { MigrationInterface, QueryRunner } from 'typeorm';
export class TaskRevenue1790760000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!(await runner.hasColumn('tasks', 'customer_name')))
      await runner.query(
        'ALTER TABLE tasks ADD COLUMN customer_name VARCHAR(100) NULL DEFAULT NULL',
      );
    if (!(await runner.hasColumn('tasks', 'order_amount')))
      await runner.query(
        'ALTER TABLE tasks ADD COLUMN order_amount DECIMAL(12,2) NULL DEFAULT NULL',
      );
  }
  async down(): Promise<void> {
    throw new Error('保留客户与金额业务数据，不自动删除字段。');
  }
}
