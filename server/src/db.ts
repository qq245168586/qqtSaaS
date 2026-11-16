import 'reflect-metadata';
import 'dotenv/config';
import { DataSource, EntityManager } from 'typeorm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InitialSchema1770000000000 } from './migrations/initial';
import { CompanyLearningLinks1790100000000 } from './migrations/company-learning-links';
import { GlobalTemplates1790091000000 } from './migrations/global-templates';
import { GlobalDirectory1790435000000 } from './migrations/global-directory';
import { BomManagement1790600000000 } from './migrations/bom-management';
import { KingdeeProductDuplicates1790610000000 } from './migrations/kingdee-product-duplicates';
import { KingdeeCatalogSeparation1790730000000 } from './migrations/kingdee-catalog-separation';
import { OrderChannels1790750000000 } from './migrations/order-channels';
import { TaskRevenue1790760000000 } from './migrations/task-revenue';
import { EmployeeSchedules1791170000000 } from './migrations/employee-schedules';
import { EmployeeRest1791295000000 } from './migrations/employee-rest';
import { Costing1792600000000 } from './migrations/costing';
import { WikiPages1792770000000 } from './migrations/wiki';
import { WikiRichContent1792773600000 } from './migrations/wiki-rich-content';
import { TaskEntryProgress1793376000000 } from './migrations/task-entry-progress';
import { GlobalCategories1793383200000 } from './migrations/global-categories';
import { RetailOrderDetails1793390400000 } from './migrations/retail-order-details';
import { WikiDirectories1794570000000 } from './migrations/wiki-directories';
import { Todos1794528000000 } from './migrations/todos';
import { TodoRecurrence1794700800000 } from './migrations/todo-recurrence';
export type Row = Record<string, unknown>;
const writableColumns = new Map<string, Set<string>>();
for (const match of readFileSync(join(__dirname, 'migrations/schema.sql'), 'utf8').matchAll(
  /CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE/g,
)) {
  writableColumns.set(
    match[1],
    new Set(Array.from(match[2].matchAll(/^  `([^`]+)`/gm), (m) => m[1])),
  );
}
function assertColumns(table: string, keys: string[]): void {
  const allowed = writableColumns.get(table);
  if (!allowed || keys.some((key) => !allowed.has(key)))
    throw new Error('Unapproved database identifier');
}
export const db = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USER ?? 'tmytri',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? 'tmy_tri_manager',
  charset: 'utf8mb4_unicode_ci',
  timezone: '+08:00',
  supportBigNumbers: true,
  bigNumberStrings: true,
  dateStrings: true,
  synchronize: false,
  migrations: [
    InitialSchema1770000000000,
    GlobalTemplates1790091000000,
    CompanyLearningLinks1790100000000,
    GlobalDirectory1790435000000,
    BomManagement1790600000000,
    KingdeeProductDuplicates1790610000000,
    KingdeeCatalogSeparation1790730000000,
    OrderChannels1790750000000,
    TaskRevenue1790760000000,
    EmployeeSchedules1791170000000,
    EmployeeRest1791295000000,
    Costing1792600000000,
    WikiPages1792770000000,
    WikiRichContent1792773600000,
    TaskEntryProgress1793376000000,
    GlobalCategories1793383200000,
    RetailOrderDetails1793390400000,
    Todos1794528000000,
    WikiDirectories1794570000000,
    TodoRecurrence1794700800000,
  ],
  extra: { connectionLimit: 10 },
});
export async function rows(
  sql: string,
  parameters: unknown[] = [],
  manager: EntityManager = db.manager,
): Promise<Row[]> {
  const result: unknown = await manager.query(sql, parameters);
  if (!Array.isArray(result)) throw new Error('Expected database rows');
  return result as Row[];
}
export async function execute(
  sql: string,
  parameters: unknown[] = [],
  manager: EntityManager = db.manager,
): Promise<void> {
  await manager.query(sql, parameters);
}
export async function insert(
  table: string,
  values: Row,
  manager: EntityManager = db.manager,
): Promise<string> {
  const keys = Object.keys(values);
  assertColumns(table, keys);
  const result: unknown = await manager.query(
    `INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    Object.values(values),
  );
  if (
    typeof result !== 'object' ||
    result === null ||
    !('insertId' in result) ||
    !['string', 'number'].includes(typeof result.insertId)
  )
    throw new Error('Missing inserted ID');
  return String(result.insertId);
}
export async function update(
  table: string,
  id: string,
  company: string,
  values: Row,
  manager: EntityManager = db.manager,
): Promise<void> {
  const keys = Object.keys(values);
  assertColumns(table, keys);
  if (!keys.length) return;
  await execute(
    `UPDATE \`${table}\` SET ${keys.map((k) => `\`${k}\`=?`).join(',')} WHERE id=? AND company_id=?`,
    [...Object.values(values), id, company],
    manager,
  );
}
export function now(): string {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}
