import type { EntityManager } from 'typeorm';
import type { User } from './auth';
import { db, rows, type Row } from './db';

import { businessToday, employeeAvailable } from './employee-policy';
export const deliveryPersonnelFields = [
  'maker_name',
  'warehouse_name',
  'sales_name',
  'deliverer_name',
] as const;
export type DeliveryPersonnelField = (typeof deliveryPersonnelFields)[number];

export type PersonnelHabit = {
  name: string;
  score: number;
  usage_count: number;
  customer_matches: number;
  product_matches: number;
  last_used_at: string;
};

export type DeliveryPersonnelSuggestion = {
  defaults: Record<DeliveryPersonnelField, string | null>;
  options: Record<DeliveryPersonnelField, PersonnelHabit[]>;
};

export function rankPersonnelHabits(source: Row[], limit = 8): DeliveryPersonnelSuggestion {
  const options = Object.fromEntries(
    deliveryPersonnelFields.map((field) => [field, [] as PersonnelHabit[]]),
  ) as Record<DeliveryPersonnelField, PersonnelHabit[]>;
  for (const row of source) {
    const role = String(row.field_name ?? row.role) as DeliveryPersonnelField;
    const name = String(row.name ?? '').trim();
    if (!deliveryPersonnelFields.includes(role) || !name) continue;
    const usageCount = Number(row.usage_count ?? 0);
    const customerMatches = Number(row.customer_matches ?? 0);
    const productMatches = Number(row.product_matches ?? 0);
    options[role].push({
      name,
      usage_count: usageCount,
      customer_matches: customerMatches,
      product_matches: productMatches,
      score: usageCount + customerMatches * 6 + productMatches * 4,
      last_used_at: String(row.last_used_at ?? ''),
    });
  }
  for (const field of deliveryPersonnelFields)
    options[field] = options[field]
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.customer_matches - a.customer_matches ||
          b.product_matches - a.product_matches ||
          b.last_used_at.localeCompare(a.last_used_at) ||
          a.name.localeCompare(b.name, 'zh-CN'),
      )
      .slice(0, limit);
  return {
    defaults: Object.fromEntries(
      deliveryPersonnelFields.map((field) => [field, options[field][0]?.name ?? null]),
    ) as Record<DeliveryPersonnelField, string | null>,
    options,
  };
}

export async function suggestDeliveryPersonnel(
  user: User,
  context: { customer_name: string; products: string[]; delivery_date?: string },
  manager: EntityManager = db.manager,
): Promise<DeliveryPersonnelSuggestion> {
  const products = [...new Set(context.products.map((name) => name.trim()).filter(Boolean))].slice(
    0,
    5,
  );
  const productMatches = products.length
    ? `SUM(CASE WHEN EXISTS (
        SELECT 1 FROM delivery_note_items line
        WHERE line.company_id=history.company_id AND line.delivery_note_id=history.id
          AND line.product_name IN (${products.map(() => '?').join(',')})
      ) THEN 1 ELSE 0 END)`
    : '0';
  const history = await rows(
    `SELECT field_name,name,COUNT(*) usage_count,
      SUM(CASE WHEN ?<>'' AND customer_name_snapshot=? THEN 1 ELSE 0 END) customer_matches,
      ${productMatches} product_matches,MAX(updated_at) last_used_at
    FROM (
      SELECT id,company_id,customer_name_snapshot,updated_at,deleted_at,is_draft,
        'maker_name' field_name,maker_name name FROM delivery_notes
      UNION ALL
      SELECT id,company_id,customer_name_snapshot,updated_at,deleted_at,is_draft,
        'warehouse_name' field_name,warehouse_name name FROM delivery_notes
      UNION ALL
      SELECT id,company_id,customer_name_snapshot,updated_at,deleted_at,is_draft,
        'sales_name' field_name,sales_name name FROM delivery_notes
      UNION ALL
      SELECT id,company_id,customer_name_snapshot,updated_at,deleted_at,is_draft,
        'deliverer_name' field_name,deliverer_name name FROM delivery_notes
    ) history
    WHERE company_id=? AND deleted_at IS NULL AND is_draft=0
      AND name IS NOT NULL AND TRIM(name)<>''
    GROUP BY field_name,name`,
    [context.customer_name.trim(), context.customer_name.trim(), ...products, user.company_id],
    manager,
  );
  const employees = await rows('SELECT name,status,left_on,deleted_at FROM employees', [], manager);
  return rankPersonnelHabits(
    history.filter((row) =>
      employeeNameAvailable(
        String(row.name ?? '').trim(),
        employees,
        context.delivery_date ?? businessToday(),
      ),
    ),
  );
}

export function employeeNameAvailable(
  name: string,
  employees: readonly Row[],
  date: string,
): boolean {
  const matches = employees.filter((e) => String(e.name).trim() === name);
  return !matches.length || matches.some((e) => employeeAvailable(e, date));
}
