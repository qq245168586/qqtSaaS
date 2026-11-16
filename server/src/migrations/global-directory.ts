import { MigrationInterface, QueryRunner } from 'typeorm';
import type { Row } from '../db';

/** Departments and employees are shared master data, independent from document ownership. */
export class GlobalDirectory1790435000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE departments MODIFY company_id BIGINT UNSIGNED NULL DEFAULT NULL',
    );
    await runner.query('ALTER TABLE employees MODIFY company_id BIGINT UNSIGNED NULL DEFAULT NULL');

    const canonical = (await runner.query(
      `SELECT name,MIN(id) keep_id
         FROM departments
        WHERE deleted_at IS NULL
        GROUP BY name
        ORDER BY MIN(id)`,
    )) as Row[];
    for (const department of canonical) {
      const duplicates = (await runner.query(
        'SELECT id FROM departments WHERE name=? AND id<>? ORDER BY id',
        [department.name, department.keep_id],
      )) as Row[];
      for (const duplicate of duplicates) {
        await runner.query('UPDATE employees SET department_id=? WHERE department_id=?', [
          department.keep_id,
          duplicate.id,
        ]);
        await runner.query('UPDATE tasks SET department_id=? WHERE department_id=?', [
          department.keep_id,
          duplicate.id,
        ]);
        await runner.query('DELETE FROM departments WHERE id=?', [duplicate.id]);
      }
    }

    await runner.query('UPDATE departments SET company_id=NULL,updated_at=updated_at');
    await runner.query('UPDATE employees SET company_id=NULL,updated_at=updated_at');

    const departmentIndexes = (await runner.query(
      "SELECT DISTINCT INDEX_NAME FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='departments'",
    )) as Row[];
    for (const name of ['uk_company_name', 'idx_company_id']) {
      if (departmentIndexes.some((index) => index.INDEX_NAME === name))
        await runner.query(`ALTER TABLE departments DROP INDEX ${name}`);
    }
    const employeeIndexes = (await runner.query(
      "SELECT DISTINCT INDEX_NAME FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees'",
    )) as Row[];
    for (const name of ['idx_company_id', 'idx_company_name']) {
      if (employeeIndexes.some((index) => index.INDEX_NAME === name))
        await runner.query(`ALTER TABLE employees DROP INDEX ${name}`);
    }

    const columns = (await runner.query(
      "SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='departments' AND COLUMN_NAME='active_name'",
    )) as Row[];
    if (!columns.length)
      await runner.query(
        'ALTER TABLE departments ADD COLUMN active_name VARCHAR(50) GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN name ELSE NULL END) STORED',
      );
    const activeIndex = (await runner.query(
      "SELECT INDEX_NAME FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='departments' AND INDEX_NAME='uk_department_active_name' LIMIT 1",
    )) as Row[];
    if (!activeIndex.length)
      await runner.query(
        'CREATE UNIQUE INDEX uk_department_active_name ON departments(active_name)',
      );
  }

  async down(): Promise<void> {
    throw new Error('全局部门和员工迁移不可按公司自动拆分，请使用迁移前完整备份。');
  }
}
