import Decimal from 'decimal.js';
import { z } from 'zod';

export const eggProfileSchema = z.object({
  yolk_grams: z.number().min(0.001).max(1000).default(17),
  white_grams: z.number().min(0.001).max(1000).default(33),
  whole_grams: z.number().min(0.001).max(2000).default(50),
  output_unit: z.enum(['个', 'g', 'kg']).default('个'),
});
export type EggProfile = z.infer<typeof eggProfileSchema>;
export interface EggMaterial {
  raw_line: string;
  parsed_name: string;
  parsed_spec: string;
  input_quantity: string;
  input_unit: string;
  material_remark: string;
}
type EggPart = 'yolk' | 'white' | 'whole';

export function eggUnit(unit: string): string {
  const value = unit.normalize('NFKC').trim().toLowerCase();
  if (['个', '颗', '枚', '只'].includes(value)) return '个';
  if (['g', '克', '公克'].includes(value)) return 'g';
  if (['kg', '公斤', '千克'].includes(value)) return 'kg';
  return value;
}

export function eggQuantity(count: string, unit: string, wholeGrams = 50): string {
  const normalized = eggUnit(unit);
  if (!['个', 'g', 'kg'].includes(normalized)) throw new Error('鸡蛋用量单位无法换算');
  const weight = eggProfileSchema.parse({ whole_grams: wholeGrams }).whole_grams;
  const value = new Decimal(count);
  if (!value.isFinite() || !value.isPositive()) throw new Error('鸡蛋数量必须大于零');
  return (normalized === '个' ? value : value.mul(weight).div(normalized === 'kg' ? 1000 : 1))
    .toDecimalPlaces(12)
    .toString();
}

export function eggPart(material: EggMaterial): EggPart | null {
  const name = material.parsed_name.normalize('NFKC').replace(/\s+/gu, '');
  // Only ordinary hen eggs are pooled. Purchased liquids, powders and other species stay separate.
  if (
    /采购|购买|外购|袋装|盒装|成品|蛋液|蛋白液|蛋黄液|蛋粉|蛋白粉|蛋黄粉|鸭|鹅|鹌鹑|咸蛋/u.test(
      `${name} ${material.raw_line} ${material.material_remark}`,
    )
  )
    return null;
  if (/^(?:鸡|鲜鸡|鲜)?蛋黄$/u.test(name)) return 'yolk';
  if (/^(?:鸡|鲜鸡|鲜)?(?:蛋白|蛋清)$/u.test(name)) return 'white';
  if (/^(?:鲜|土|全)?鸡蛋$|^全蛋$/u.test(name)) return 'whole';
  return null;
}

function gramsPerPart(part: EggPart, profile: EggProfile): Decimal {
  return new Decimal(
    part === 'yolk'
      ? profile.yolk_grams
      : part === 'white'
        ? profile.white_grams
        : profile.yolk_grams + profile.white_grams,
  );
}

export type EggFold<T> =
  | { kind: 'original'; material: T }
  | { kind: 'whole_egg'; material: EggMaterial; egg_count: string };

export function foldRecipeEggs<T extends EggMaterial>(
  materials: T[],
  rawProfile: z.input<typeof eggProfileSchema> = {},
): EggFold<T>[] {
  const profile = eggProfileSchema.parse(rawProfile);
  const groups = new Map<string, Array<{ material: T; part: EggPart }>>();
  for (const material of materials) {
    const part = eggPart(material);
    if (!part) continue;
    const key = material.parsed_spec.normalize('NFKC').trim();
    const group = groups.get(key) ?? [];
    group.push({ material, part });
    groups.set(key, group);
  }
  const emitted = new Set<string>();
  const result: EggFold<T>[] = [];
  for (const material of materials) {
    const part = eggPart(material);
    const key = material.parsed_spec.normalize('NFKC').trim();
    const group = groups.get(key);
    if (!part || !group?.some((item) => item.part !== 'whole')) {
      result.push({ kind: 'original', material });
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    const totals = { yolk: new Decimal(0), white: new Decimal(0), whole: new Decimal(0) };
    for (const item of group) {
      const quantity = new Decimal(item.material.input_quantity);
      if (!quantity.isFinite() || !quantity.isPositive()) throw new Error('蛋类材料数量必须大于零');
      const unit = eggUnit(item.material.input_unit);
      if (!['个', 'g', 'kg'].includes(unit))
        throw new Error(`“${item.material.raw_line}”的单位无法折算，请将原始配方写成个、克或千克`);
      const equivalent =
        unit === '个'
          ? quantity
          : quantity.mul(unit === 'kg' ? 1000 : 1).div(gramsPerPart(item.part, profile));
      totals[item.part] = totals[item.part].plus(equivalent);
    }
    const split = Decimal.max(totals.yolk, totals.white).ceil();
    const count = totals.whole.ceil().plus(split);
    const quantity =
      profile.output_unit === '个'
        ? count
        : count.mul(profile.whole_grams!).div(profile.output_unit === 'kg' ? 1000 : 1);
    const unusedYolk = split.minus(totals.yolk);
    const unusedWhite = split.minus(totals.white);
    const display = (amount: Decimal) => amount.toDecimalPlaces(6).toString();
    const lossGrams = [
      profile.yolk_grams ? `蛋黄${display(unusedYolk.mul(profile.yolk_grams))}g` : '',
      profile.white_grams ? `蛋白${display(unusedWhite.mul(profile.white_grams))}g` : '',
    ]
      .filter(Boolean)
      .join('、');
    const remarks = [
      `整蛋规则v1：整蛋另用${display(totals.whole)}颗，拆蛋${split.toString()}颗，共消耗${count.toString()}颗鸡蛋`,
      `未使用蛋黄${display(unusedYolk)}颗份、蛋白${display(unusedWhite)}颗份，计入本配方损耗，不跨配方抵扣`,
      ...(lossGrams ? [`损耗重量：${lossGrams}`] : []),
      `换算快照：蛋黄${profile.yolk_grams ? `${profile.yolk_grams}g/颗` : '按颗份'}；蛋白${profile.white_grams ? `${profile.white_grams}g/颗` : '按颗份'}；库存鸡蛋${profile.whole_grams ? `${profile.whole_grams}g/颗` : '按个'}；导出${profile.output_unit}`,
      ...group.map((item) => item.material.material_remark).filter(Boolean),
    ].join('；');
    const rawLine = group.map((item) => item.material.raw_line).join('；');
    if (rawLine.length > 1000 || remarks.length > 1000)
      throw new Error('蛋类合并后的原文或备注超过1000字，请精简后再解析');
    result.push({
      kind: 'whole_egg',
      egg_count: count.toString(),
      material: {
        raw_line: rawLine,
        parsed_name: '鸡蛋',
        parsed_spec: material.parsed_spec,
        input_quantity: quantity.toDecimalPlaces(12).toString(),
        input_unit: profile.output_unit,
        material_remark: remarks,
      },
    });
  }
  return result;
}
