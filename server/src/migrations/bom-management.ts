import { MigrationInterface, QueryRunner } from 'typeorm';
import type { Row } from '../db';

async function columnExists(runner: QueryRunner, table: string, column: string): Promise<boolean> {
  const rows = (await runner.query(
    'SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
    [table, column],
  )) as Row[];
  return rows.length > 0;
}

async function indexExists(runner: QueryRunner, table: string, index: string): Promise<boolean> {
  const rows = (await runner.query(
    'SELECT INDEX_NAME FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1',
    [table, index],
  )) as Row[];
  return rows.length > 0;
}

/** Kingdee product snapshots, explainable matching rules and BOM drafts. */
export class BomManagement1790600000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const productColumns = [
      ['kingdee_code', 'VARCHAR(50) NULL DEFAULT NULL'],
      ['category_name', "VARCHAR(100) NOT NULL DEFAULT ''"],
      ['barcode', "VARCHAR(100) NOT NULL DEFAULT ''"],
      ['kingdee_disabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
      ['backflush_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
      ['backflush_warehouse', "VARCHAR(100) NOT NULL DEFAULT ''"],
      ['backflush_position', "VARCHAR(100) NOT NULL DEFAULT ''"],
      ['cost_method', "VARCHAR(50) NOT NULL DEFAULT ''"],
      ['kingdee_synced_at', 'DATETIME NULL DEFAULT NULL'],
    ] as const;
    for (const [name, definition] of productColumns)
      if (!(await columnExists(runner, 'products', name)))
        await runner.query(`ALTER TABLE products ADD COLUMN \`${name}\` ${definition}`);
    if (!(await indexExists(runner, 'products', 'uk_company_kingdee_code')))
      await runner.query(
        'CREATE UNIQUE INDEX uk_company_kingdee_code ON products(company_id,kingdee_code)',
      );

    await runner.query(`CREATE TABLE IF NOT EXISTS kingdee_catalog_imports (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      company_id BIGINT UNSIGNED NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_sha256 CHAR(64) NOT NULL,
      total_count INT NOT NULL,
      created_count INT NOT NULL,
      updated_count INT NOT NULL,
      unchanged_count INT NOT NULL,
      created_by BIGINT UNSIGNED NULL DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      UNIQUE KEY uk_company_file(company_id,file_sha256),
      KEY idx_company_created(company_id,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await runner.query(`CREATE TABLE IF NOT EXISTS boms (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      company_id BIGINT UNSIGNED NOT NULL,
      bom_number VARCHAR(50) NOT NULL,
      bom_category VARCHAR(100) NOT NULL DEFAULT '',
      finished_product_id BIGINT UNSIGNED NULL DEFAULT NULL,
      finished_product_name VARCHAR(100) NOT NULL,
      finished_product_spec VARCHAR(100) NOT NULL DEFAULT '',
      finished_product_code VARCHAR(50) NOT NULL DEFAULT '',
      finished_product_unit VARCHAR(20) NOT NULL,
      yield_quantity DECIMAL(18,6) NOT NULL DEFAULT 1,
      version VARCHAR(20) NOT NULL DEFAULT 'V1.0',
      status ENUM('draft','needs_review','pending_material','exportable','exported') NOT NULL DEFAULT 'draft',
      source_text TEXT NOT NULL,
      warehouse_name VARCHAR(100) NOT NULL DEFAULT '',
      remark VARCHAR(1000) NOT NULL DEFAULT '',
      created_by BIGINT UNSIGNED NULL DEFAULT NULL,
      updated_by BIGINT UNSIGNED NULL DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL DEFAULT NULL,
      PRIMARY KEY(id),
      UNIQUE KEY uk_company_bom_number(company_id,bom_number),
      KEY idx_company_status(company_id,status),
      KEY idx_finished_product(finished_product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await runner.query(`CREATE TABLE IF NOT EXISTS bom_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      bom_id BIGINT UNSIGNED NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      raw_line VARCHAR(1000) NOT NULL,
      parsed_name VARCHAR(100) NOT NULL,
      parsed_spec VARCHAR(100) NOT NULL DEFAULT '',
      input_quantity DECIMAL(18,6) NOT NULL,
      input_unit VARCHAR(20) NOT NULL,
      product_id BIGINT UNSIGNED NULL DEFAULT NULL,
      product_name VARCHAR(100) NOT NULL DEFAULT '',
      product_code VARCHAR(50) NOT NULL DEFAULT '',
      product_spec VARCHAR(100) NOT NULL DEFAULT '',
      bom_unit VARCHAR(20) NOT NULL,
      material_quantity DECIMAL(18,6) NOT NULL,
      material_remark VARCHAR(1000) NOT NULL DEFAULT '',
      match_status ENUM('matched','suggested','unmatched','pending_product') NOT NULL DEFAULT 'unmatched',
      match_confidence DECIMAL(5,2) NOT NULL DEFAULT 0,
      match_method VARCHAR(40) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      KEY idx_bom_sort(bom_id,sort_order),
      KEY idx_product(product_id),
      CONSTRAINT fk_bom_items_bom FOREIGN KEY(bom_id) REFERENCES boms(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await runner.query(`CREATE TABLE IF NOT EXISTS material_alias_rules (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      company_id BIGINT UNSIGNED NOT NULL,
      source_name VARCHAR(100) NOT NULL,
      normalized_source_name VARCHAR(100) NOT NULL,
      source_spec VARCHAR(100) NOT NULL DEFAULT '',
      source_unit VARCHAR(20) NOT NULL DEFAULT '',
      product_id BIGINT UNSIGNED NOT NULL,
      preferred_bom_unit VARCHAR(20) NOT NULL DEFAULT '',
      locked TINYINT(1) NOT NULL DEFAULT 0,
      usage_count INT NOT NULL DEFAULT 1,
      correction_count INT NOT NULL DEFAULT 0,
      last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by BIGINT UNSIGNED NULL DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      UNIQUE KEY uk_company_alias(company_id,normalized_source_name,source_spec,source_unit),
      KEY idx_alias_product(product_id),
      KEY idx_alias_frequency(company_id,usage_count,last_used_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await runner.query(`CREATE TABLE IF NOT EXISTS bom_exports (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      bom_id BIGINT UNSIGNED NOT NULL,
      template_sha256 CHAR(64) NOT NULL,
      output_sha256 CHAR(64) NOT NULL,
      exported_by BIGINT UNSIGNED NULL DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      KEY idx_bom_created(bom_id,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }

  async down(): Promise<void> {
    throw new Error('BOM 与金蝶商品数据不可自动删除，请使用迁移前备份。');
  }
}
