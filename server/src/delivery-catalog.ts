import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import type { User } from './auth';
import { execute, rows } from './db';
import { deliverySchema } from './validation';

/** Runs inside the delivery transaction; unique keys serialize concurrent catalog additions. */
export async function rememberDeliveryCatalog(
  delivery: z.infer<typeof deliverySchema>,
  company: User,
  manager: EntityManager,
): Promise<string | null> {
  if (delivery.is_draft) return delivery.customer_id;
  let customerId = delivery.customer_id;
  if (!customerId) {
    await execute(
      `INSERT INTO customers(company_id,name,address,phone,active,created_by,updated_by)
       VALUES(?,?,?,?,1,?,?) ON DUPLICATE KEY UPDATE
       address=IF(VALUES(address)='',address,VALUES(address)),
       phone=IF(VALUES(phone)='',phone,VALUES(phone)),
       active=1,deleted_at=NULL,updated_by=VALUES(updated_by)`,
      [
        company.company_id,
        delivery.customer_name_snapshot,
        delivery.customer_address_snapshot,
        delivery.customer_phone_snapshot,
        company.id,
        company.id,
      ],
      manager,
    );
    const [customer] = await rows(
      'SELECT id FROM customers WHERE company_id=? AND name=?',
      [company.company_id, delivery.customer_name_snapshot],
      manager,
    );
    if (!customer) throw new Error('客户资料保存失败');
    customerId = String(customer.id);
  }
  for (const item of delivery.items) {
    await execute(
      `INSERT INTO products(company_id,name,spec,unit,default_price,active,created_by,updated_by)
       VALUES(?,?,?,?,?,1,?,?) ON DUPLICATE KEY UPDATE
       unit=VALUES(unit),default_price=VALUES(default_price),active=1,deleted_at=NULL,
       updated_by=VALUES(updated_by)`,
      [
        company.company_id,
        item.product_name,
        item.spec,
        item.unit,
        item.unit_price,
        company.id,
        company.id,
      ],
      manager,
    );
  }
  return customerId;
}
