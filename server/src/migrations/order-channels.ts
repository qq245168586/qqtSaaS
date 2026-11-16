import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderChannels1790750000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!(await runner.hasColumn('tasks', 'order_channel')))
      await runner.query(
        'ALTER TABLE tasks ADD COLUMN order_channel VARCHAR(50) NULL DEFAULT NULL',
      );
  }
  async down(): Promise<void> {
    throw new Error('渠道已包含业务数据，不自动删除；回滚代码时保留兼容字段。');
  }
}
