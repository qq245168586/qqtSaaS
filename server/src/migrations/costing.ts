import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Costing1792600000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS cost_materials (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      scope ENUM('shared','tri','tmy') NOT NULL DEFAULT 'shared',
      standard_name VARCHAR(120) NOT NULL,
      normalized_name VARCHAR(120) NOT NULL,
      identity_key CHAR(64) NOT NULL,
      aliases_json JSON NOT NULL,
      category VARCHAR(100) NOT NULL DEFAULT '',
      brand VARCHAR(100) NOT NULL DEFAULT '',
      spec VARCHAR(100) NOT NULL DEFAULT '',
      purchase_unit VARCHAR(20) NOT NULL,
      base_unit VARCHAR(20) NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_by BIGINT UNSIGNED NULL,
      updated_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      PRIMARY KEY(id),
      UNIQUE KEY uk_cost_material_identity(identity_key),
      KEY idx_cost_material_scope_name(scope,normalized_name),
      KEY idx_cost_material_active(active,updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await q.query(`CREATE TABLE IF NOT EXISTS cost_price_versions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      material_id BIGINT UNSIGNED NOT NULL,
      purchase_quantity DECIMAL(30,10) NOT NULL,
      purchase_price_yuan DECIMAL(30,10) NOT NULL,
      unit_cost_yuan_per_base DECIMAL(30,10) NOT NULL,
      effective_date DATE NOT NULL,
      source VARCHAR(200) NOT NULL DEFAULT '',
      created_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      UNIQUE KEY uk_cost_price_value(material_id,effective_date,purchase_quantity,purchase_price_yuan),
      KEY idx_cost_price_current(material_id,effective_date,id),
      CONSTRAINT fk_cost_price_material FOREIGN KEY(material_id) REFERENCES cost_materials(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await q.query(`CREATE TABLE IF NOT EXISTS cost_sops (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      scope ENUM('shared','tri','tmy') NOT NULL DEFAULT 'shared',
      product_name VARCHAR(120) NOT NULL,
      product_spec VARCHAR(100) NOT NULL DEFAULT '',
      yield_quantity DECIMAL(30,10) NOT NULL,
      yield_unit VARCHAR(20) NOT NULL,
      version VARCHAR(30) NOT NULL DEFAULT 'V1.0',
      calculation_date DATE NOT NULL,
      source_text MEDIUMTEXT NOT NULL,
      batch_cost_yuan DECIMAL(30,10) NOT NULL,
      unit_cost_yuan DECIMAL(30,10) NOT NULL,
      created_by BIGINT UNSIGNED NULL,
      updated_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      PRIMARY KEY(id),
      KEY idx_cost_sop_updated(updated_at,id),
      KEY idx_cost_sop_product(product_name,version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await q.query(`CREATE TABLE IF NOT EXISTS cost_sop_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      sop_id BIGINT UNSIGNED NOT NULL,
      sort_order INT NOT NULL,
      material_id BIGINT UNSIGNED NOT NULL,
      material_name VARCHAR(120) NOT NULL,
      quantity DECIMAL(30,10) NOT NULL,
      unit VARCHAR(20) NOT NULL,
      base_unit VARCHAR(20) NOT NULL,
      price_version_id BIGINT UNSIGNED NOT NULL,
      unit_cost_yuan_per_base DECIMAL(30,10) NOT NULL,
      base_quantity DECIMAL(30,10) NOT NULL,
      line_cost_yuan DECIMAL(30,10) NOT NULL,
      note VARCHAR(500) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      KEY idx_cost_sop_item_sort(sop_id,sort_order),
      KEY idx_cost_sop_item_material(material_id),
      CONSTRAINT fk_cost_sop_item_sop FOREIGN KEY(sop_id) REFERENCES cost_sops(id) ON DELETE CASCADE,
      CONSTRAINT fk_cost_sop_item_material FOREIGN KEY(material_id) REFERENCES cost_materials(id),
      CONSTRAINT fk_cost_sop_item_price FOREIGN KEY(price_version_id) REFERENCES cost_price_versions(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await q.query(`CREATE TABLE IF NOT EXISTS cost_calculation_snapshots (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      sop_id BIGINT UNSIGNED NOT NULL,
      calculation_date DATE NOT NULL,
      batch_cost_yuan DECIMAL(30,10) NOT NULL,
      unit_cost_yuan DECIMAL(30,10) NOT NULL,
      snapshot_json JSON NOT NULL,
      created_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      KEY idx_cost_snapshot_sop(sop_id,created_at),
      CONSTRAINT fk_cost_snapshot_sop FOREIGN KEY(sop_id) REFERENCES cost_sops(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await q.query(`CREATE TABLE IF NOT EXISTS cost_import_jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      kind VARCHAR(30) NOT NULL,
      item_count INT NOT NULL,
      created_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      KEY idx_cost_import_created(created_at,id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }

  async down(): Promise<void> {
    throw new Error('成本价格版本与核算快照不可自动删除，请使用迁移前备份恢复');
  }
}
