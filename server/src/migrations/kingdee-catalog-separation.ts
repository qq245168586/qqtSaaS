import { MigrationInterface, QueryRunner } from 'typeorm';
import type { Row } from '../db';

async function indexExists(runner: QueryRunner, table: string, index: string): Promise<boolean> {
  const rows = (await runner.query(
    'SELECT INDEX_NAME FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1',
    [table, index],
  )) as Row[];
  return rows.length > 0;
}

/** Keeps delivery history/autocomplete products independent from the Kingdee BOM catalog. */
export class KingdeeCatalogSeparation1790730000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE IF NOT EXISTS kingdee_products (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      company_id BIGINT UNSIGNED NOT NULL,
      kingdee_code VARCHAR(50) NOT NULL,
      name VARCHAR(100) NOT NULL,
      category_name VARCHAR(100) NOT NULL DEFAULT '',
      barcode VARCHAR(100) NOT NULL DEFAULT '',
      spec VARCHAR(100) NOT NULL DEFAULT '',
      unit VARCHAR(20) NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      kingdee_disabled TINYINT(1) NOT NULL DEFAULT 0,
      backflush_enabled TINYINT(1) NOT NULL DEFAULT 0,
      backflush_warehouse VARCHAR(100) NOT NULL DEFAULT '',
      backflush_position VARCHAR(100) NOT NULL DEFAULT '',
      cost_method VARCHAR(50) NOT NULL DEFAULT '',
      kingdee_synced_at DATETIME NULL DEFAULT NULL,
      created_by BIGINT UNSIGNED NULL DEFAULT NULL,
      updated_by BIGINT UNSIGNED NULL DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL DEFAULT NULL,
      PRIMARY KEY(id),
      UNIQUE KEY uk_company_kingdee_code(company_id,kingdee_code),
      KEY idx_company_name_spec(company_id,name,spec),
      KEY idx_company_active(company_id,kingdee_disabled,deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // Preserve the original IDs because saved BOMs and learned aliases already reference them.
    await runner.query(`INSERT INTO kingdee_products(
      id,company_id,kingdee_code,name,category_name,barcode,spec,unit,active,
      kingdee_disabled,backflush_enabled,backflush_warehouse,backflush_position,cost_method,
      kingdee_synced_at,created_by,updated_by,created_at,updated_at,deleted_at
    ) SELECT
      id,company_id,kingdee_code,name,category_name,barcode,spec,unit,active,
      kingdee_disabled,backflush_enabled,backflush_warehouse,backflush_position,cost_method,
      kingdee_synced_at,created_by,updated_by,created_at,updated_at,deleted_at
    FROM products WHERE kingdee_code IS NOT NULL
    ON DUPLICATE KEY UPDATE
      kingdee_code=VALUES(kingdee_code),name=VALUES(name),category_name=VALUES(category_name),
      barcode=VALUES(barcode),spec=VALUES(spec),unit=VALUES(unit),active=VALUES(active),
      kingdee_disabled=VALUES(kingdee_disabled),backflush_enabled=VALUES(backflush_enabled),
      backflush_warehouse=VALUES(backflush_warehouse),backflush_position=VALUES(backflush_position),
      cost_method=VALUES(cost_method),kingdee_synced_at=VALUES(kingdee_synced_at),
      updated_by=VALUES(updated_by),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at)`);

    // Rows created by a Kingdee sync belong only to the BOM catalog. Older delivery rows that
    // were enriched by name/spec remain in the delivery catalog and are stripped of Kingdee data.
    await runner.query(`DELETE FROM products
      WHERE kingdee_code IS NOT NULL AND kingdee_synced_at IS NOT NULL AND (
        created_at >= DATE_SUB(kingdee_synced_at,INTERVAL 5 MINUTE)
        OR created_at >= DATE_SUB(
          (SELECT MIN(imported_at) FROM (SELECT created_at imported_at FROM kingdee_catalog_imports) imports),
          INTERVAL 5 MINUTE
        )
      )`);
    await runner.query(`UPDATE products SET
      kingdee_code=NULL,category_name='',barcode='',kingdee_disabled=0,
      backflush_enabled=0,backflush_warehouse='',backflush_position='',cost_method='',
      kingdee_synced_at=NULL
      WHERE kingdee_code IS NOT NULL`);

    // The temporary loss of the delivery unique key allowed a few repeated autocomplete rows.
    // Keep their oldest stable ID while applying the latest user-entered unit and price.
    await runner.query(`CREATE TEMPORARY TABLE delivery_product_dedupe AS
      SELECT company_id,name,spec,MIN(id) keep_id,MAX(id) latest_id
      FROM products GROUP BY company_id,name,spec HAVING COUNT(*)>1`);
    await runner.query(`UPDATE products kept
      JOIN delivery_product_dedupe d ON d.keep_id=kept.id
      JOIN products latest ON latest.id=d.latest_id
      SET kept.unit=latest.unit,kept.default_price=latest.default_price,
          kept.active=GREATEST(kept.active,latest.active),kept.updated_by=latest.updated_by,
          kept.updated_at=GREATEST(kept.updated_at,latest.updated_at),kept.deleted_at=latest.deleted_at`);
    await runner.query(`DELETE repeated FROM products repeated
      JOIN delivery_product_dedupe d
        ON d.company_id=repeated.company_id AND d.name=repeated.name AND d.spec=repeated.spec
      WHERE repeated.id<>d.keep_id`);
    await runner.query('DROP TEMPORARY TABLE delivery_product_dedupe');

    if (await indexExists(runner, 'products', 'uk_company_kingdee_code'))
      await runner.query('ALTER TABLE products DROP INDEX uk_company_kingdee_code');
    if (await indexExists(runner, 'products', 'idx_company_name_spec'))
      await runner.query('ALTER TABLE products DROP INDEX idx_company_name_spec');
    if (!(await indexExists(runner, 'products', 'uk_company_name_spec')))
      await runner.query(
        'CREATE UNIQUE INDEX uk_company_name_spec ON products(company_id,name,spec)',
      );

    // A delivery line is valid even when it never appeared in a catalog. Add missing history only
    // as autocomplete data; saving a delivery still accepts any free-form product text.
    await runner.query(`INSERT INTO products(
      company_id,name,spec,unit,default_price,active,created_by,updated_by
    ) SELECT n.company_id,i.product_name,COALESCE(i.spec,''),MAX(i.unit),MAX(i.unit_price),1,
             MAX(n.created_by),MAX(n.updated_by)
        FROM delivery_note_items i JOIN delivery_notes n ON n.id=i.delivery_note_id
       WHERE n.deleted_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM products p
          WHERE p.company_id=n.company_id AND p.name=i.product_name AND p.spec=COALESCE(i.spec,'')
       )
       GROUP BY n.company_id,i.product_name,COALESCE(i.spec,'')`);
  }

  async down(): Promise<void> {
    throw new Error('金蝶与送货商品目录分离后不能自动合并，请使用迁移前备份。');
  }
}
