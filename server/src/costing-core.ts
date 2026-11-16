import Decimal from 'decimal.js';
import { z } from 'zod';

export const positiveDecimal = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine((value) => {
    try {
      return new Decimal(value).isPositive();
    } catch {
      return false;
    }
  }, '必须是大于0的数字');

const unitAliases: Record<string, string> = {
  g: '克',
  G: '克',
  克: '克',
  kg: '千克',
  KG: '千克',
  千克: '千克',
  公斤: '千克',
  斤: '斤',
  mg: '毫克',
  毫克: '毫克',
  ml: '毫升',
  ML: '毫升',
  毫升: '毫升',
  l: '升',
  L: '升',
  升: '升',
  个: '个',
  只: '个',
  枚: '个',
  盒: '盒',
  袋: '袋',
  包: '包',
  瓶: '瓶',
};

const unitFactors: Record<string, { family: string; factor: Decimal }> = {
  毫克: { family: 'mass', factor: new Decimal('0.001') },
  克: { family: 'mass', factor: new Decimal(1) },
  千克: { family: 'mass', factor: new Decimal(1000) },
  斤: { family: 'mass', factor: new Decimal(500) },
  毫升: { family: 'volume', factor: new Decimal(1) },
  升: { family: 'volume', factor: new Decimal(1000) },
  个: { family: 'count', factor: new Decimal(1) },
  盒: { family: 'box', factor: new Decimal(1) },
  袋: { family: 'bag', factor: new Decimal(1) },
  包: { family: 'pack', factor: new Decimal(1) },
  瓶: { family: 'bottle', factor: new Decimal(1) },
};

export function normalizeCostUnit(unit: string): string {
  const trimmed = unit.trim();
  return unitAliases[trimmed] ?? trimmed;
}

export function convertCostQuantity(quantity: string, fromUnit: string, toUnit: string): Decimal {
  const from = unitFactors[normalizeCostUnit(fromUnit)];
  const to = unitFactors[normalizeCostUnit(toUnit)];
  if (!from || !to || from.family !== to.family)
    throw new Error(`不能把“${fromUnit}”换算为“${toUnit}”`);
  return new Decimal(quantity).mul(from.factor).div(to.factor);
}

export function unitCost(
  purchasePriceYuan: string,
  purchaseQuantity: string,
  purchaseUnit: string,
  baseUnit: string,
): string {
  const baseQuantity = convertCostQuantity(purchaseQuantity, purchaseUnit, baseUnit);
  if (!baseQuantity.isPositive()) throw new Error('采购净含量必须大于0');
  return new Decimal(purchasePriceYuan).div(baseQuantity).toDecimalPlaces(8).toFixed(8);
}

export interface CostLineInput {
  material_id: string;
  material_name: string;
  quantity: string;
  unit: string;
  base_unit: string;
  unit_cost_yuan_per_base: string;
}

export interface CostLineResult extends CostLineInput {
  base_quantity: string;
  line_cost_yuan: string;
}

export function calculateRecipeCost(
  lines: CostLineInput[],
  yieldQuantity: string,
): {
  lines: CostLineResult[];
  batch_cost_yuan: string;
  unit_cost_yuan: string;
} {
  const calculated = lines.map((line) => {
    const baseQuantity = convertCostQuantity(line.quantity, line.unit, line.base_unit);
    const lineCost = baseQuantity.mul(line.unit_cost_yuan_per_base);
    return {
      ...line,
      base_quantity: baseQuantity.toDecimalPlaces(8).toFixed(8),
      line_cost_yuan: lineCost.toDecimalPlaces(8).toFixed(8),
    };
  });
  const batch = calculated.reduce((total, line) => total.add(line.line_cost_yuan), new Decimal(0));
  const output = new Decimal(yieldQuantity);
  if (!output.isPositive()) throw new Error('成品产量必须大于0');
  return {
    lines: calculated,
    batch_cost_yuan: batch.toDecimalPlaces(8).toFixed(8),
    unit_cost_yuan: batch.div(output).toDecimalPlaces(8).toFixed(8),
  };
}

export function decimalText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && 'toString' in value) return String(value);
  return '';
}
