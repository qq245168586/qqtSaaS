import type { Resource } from './contracts';

export type DeliveryProductPatch = {
  productName: string;
  specification: string;
  unit: string;
  unitPrice: string;
};

export function resolveDeliveryProduct(
  products: Resource[],
  raw: string,
  productId?: string,
): { product?: Resource; value: string; patch: DeliveryProductPatch } {
  const product = productId
    ? products.find((item) => item.id === productId)
    : products.find((item) => item.name === raw);
  const value = product?.name ?? raw;
  return {
    product,
    value,
    patch: {
      productName: value,
      specification: product?.spec ?? '',
      unit: product?.unit ?? '个',
      unitPrice: String(product?.default_price ?? 0),
    },
  };
}
