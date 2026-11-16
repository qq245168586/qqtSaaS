import { MigrationInterface, QueryRunner } from 'typeorm';

/** Separate retail product, address, delivery fee and order-taker data from free-form text. */
export class RetailOrderDetails1793390400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!(await runner.hasColumn('tasks', 'product_summary')))
      await runner.query(
        'ALTER TABLE tasks ADD COLUMN product_summary VARCHAR(500) NULL DEFAULT NULL AFTER customer_name',
      );
    if (!(await runner.hasColumn('tasks', 'delivery_address')))
      await runner.query(
        'ALTER TABLE tasks ADD COLUMN delivery_address VARCHAR(500) NULL DEFAULT NULL AFTER product_summary',
      );
    if (!(await runner.hasColumn('tasks', 'delivery_fee')))
      await runner.query(
        'ALTER TABLE tasks ADD COLUMN delivery_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER order_amount',
      );
    if (!(await runner.hasColumn('tasks', 'order_taker_employee_id')))
      await runner.query(
        'ALTER TABLE tasks ADD COLUMN order_taker_employee_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER assignee_employee_id',
      );
    const indexes = (await runner.query(
      "SELECT INDEX_NAME FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tasks' AND INDEX_NAME='idx_company_order_taker' LIMIT 1",
    )) as unknown[];
    if (!indexes.length)
      await runner.query(
        'CREATE INDEX idx_company_order_taker ON tasks(company_id,order_taker_employee_id)',
      );
  }

  async down(): Promise<void> {
    throw new Error('保留零售订单拆分字段，不自动删除商品、地址、配送费和接单人数据。');
  }
}
