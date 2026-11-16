import type { Delivery } from './contracts';
import type { CompanyId, DeliveryNote } from './types';
export function printModel(note: Delivery, companyId: CompanyId): DeliveryNote {
  return {
    id: note.id,
    companyId: note.company_code ?? companyId,
    number: note.note_number ?? '草稿',
    date: note.delivery_date.slice(0, 10),
    customerName: note.customer_name_snapshot,
    customerAddress: note.customer_address_snapshot ?? '',
    customerPhone: note.customer_phone_snapshot ?? '',
    page: 1,
    totalPages: 1,
    items: note.items.map((item, index) => ({
      id: item.id ?? String(index),
      name: item.product_name,
      specification: item.spec ?? '',
      unit: item.unit,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      remark: item.remark ?? '',
    })),
    maker: note.maker_name ?? '',
    keeper: note.warehouse_name ?? '',
    salesperson: note.sales_name ?? '',
    deliveryPerson: note.deliverer_name ?? '',
  };
}
