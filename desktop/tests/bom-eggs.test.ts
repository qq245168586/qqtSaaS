import assert from 'node:assert/strict';
import test from 'node:test';
import { eggPart, foldRecipeEggs, eggQuantity, type EggMaterial } from '../src/bom-eggs.ts';

const material = (name: string, quantity: string, unit = '个', spec = ''): EggMaterial => ({
  parsed_name: name,
  input_quantity: quantity,
  input_unit: unit,
  parsed_spec: spec,
  raw_line: `${name} ${quantity}${unit}`,
  material_remark: '',
});
const profile = { yolk_grams: 18, white_grams: 32, whole_grams: 60, output_unit: '个' as const };

test('等量蛋黄蛋白只计一份整蛋，不叠加计料', () => {
  const result = foldRecipeEggs([material('蛋黄', '3'), material('蛋白', '3')], {
    output_unit: '个',
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.material.parsed_name, '鸡蛋');
  assert.equal(result[0]?.material.input_quantity, '3');
});

test('不等量蛋黄蛋白按最大数量计整蛋，剩余部分记损耗', () => {
  const result = foldRecipeEggs([material('蛋黄', '3'), material('蛋白', '5')], profile);
  assert.equal(result[0]?.material.input_quantity, '5');
  assert.match(result[0]!.material.material_remark, /未使用蛋黄2颗份、蛋白0颗份/u);
  assert.match(result[0]!.material.raw_line, /蛋黄 3个；蛋白 5个/u);
});

test('仅蛋黄或仅蛋清也按整蛋计料', () => {
  for (const name of ['蛋黄', '蛋清']) {
    assert.equal(foldRecipeEggs([material(name, '3')], profile)[0]?.material.input_quantity, '3');
  }
});

test('克数按各自出成重量换算，不能用克数1:1比较', () => {
  const result = foldRecipeEggs(
    [material('蛋黄', '90', '克'), material('蛋白', '96', 'g')],
    profile,
  );
  assert.equal(result[0]?.material.input_quantity, '5');
  assert.match(result[0]!.material.material_remark, /蛋黄0颗份、蛋白2颗份/u);
});

test('混合单位、重复材料先汇总需求，再向上取整', () => {
  const result = foldRecipeEggs(
    [material('蛋黄', '1'), material('蛋黄', '18', 'g'), material('蛋白', '0.064', 'kg')],
    profile,
  );
  assert.equal(result[0]?.material.input_quantity, '2');
  assert.equal(
    foldRecipeEggs([material('蛋黄', '19', 'g')], profile)[0]?.material.input_quantity,
    '2',
  );
});

test('独立整蛋用量另加，不与拆蛋消耗重复抵扣', () => {
  const result = foldRecipeEggs(
    [material('鸡蛋', '2'), material('蛋黄', '3'), material('蛋白', '5')],
    profile,
  );
  assert.equal(result[0]?.material.input_quantity, '7');
});

test('原配方整蛋克数按去壳蛋液出成重量折算，库存重量只用于导出', () => {
  const result = foldRecipeEggs([material('全蛋', '100', 'g'), material('蛋黄', '3')], profile);
  assert.equal(result[0]?.material.input_quantity, '5');
});

test('按金蝶库存重量导出，不能把蛋黄克数直接改名鸡蛋', () => {
  const result = foldRecipeEggs([material('蛋黄', '90', 'g'), material('蛋白', '96', 'g')], {
    ...profile,
    output_unit: 'kg',
  });
  assert.equal(result[0]?.material.input_quantity, '0.3');
  assert.equal(result[0]?.material.input_unit, 'kg');
  assert.match(result[0]!.material.material_remark, /库存鸡蛋60g\/颗/u);
});

test('缺少设置也按整蛋50g、蛋黄17g、蛋白33g自动折算，不要求确认', () => {
  const result = foldRecipeEggs([material('蛋黄', '90', 'g'), material('蛋白', '96', 'g')]);
  assert.equal(result[0]?.material.input_quantity, '6');
  assert.match(result[0]!.material.material_remark, /库存鸡蛋50g\/颗/u);
  assert.equal(
    foldRecipeEggs([material('蛋黄', '3')], { output_unit: 'kg' })[0]?.material.input_quantity,
    '0.15',
  );
  assert.equal(eggQuantity('6', 'kg'), '0.3');
  assert.equal(eggQuantity('6', '克'), '300');
  assert.equal(eggQuantity('6', '枚'), '6');
});

test('采购蛋液、蛋粉、非鸡蛋及成品名称不参与整蛋合并', () => {
  const originals = ['采购蛋黄', '蛋白液', '蛋黄粉', '鸭蛋黄', '蛋黄酥', '乳清蛋白'].map((name) =>
    material(name, '100', 'g'),
  );
  for (const item of originals) assert.equal(eggPart(item), null);
  assert.deepEqual(
    foldRecipeEggs(originals, profile).map((item) => item.material),
    originals,
  );
});

test('不同规格分开折算，普通材料保持原顺序和内容', () => {
  const flour = material('面粉', '80', 'g');
  const result = foldRecipeEggs(
    [material('蛋黄', '3', '个', 'A'), flour, material('蛋白', '5', '个', 'B')],
    profile,
  );
  assert.deepEqual(
    result.map((item) => item.material.input_quantity),
    ['3', '80', '5'],
  );
  assert.strictEqual(result[1]?.material, flour);
});

test('重复运行已折算结果不再折算，不修改输入对象', () => {
  const source = [material('蛋黄', '3'), material('蛋白', '5')];
  const before = JSON.stringify(source);
  const once = foldRecipeEggs(source, profile).map((item) => item.material);
  assert.deepEqual(
    foldRecipeEggs(once, profile).map((item) => item.material),
    once,
  );
  assert.equal(JSON.stringify(source), before);
});

test('非法数量、配置及未知单位不能静默生成BOM', () => {
  assert.throws(() => foldRecipeEggs([material('蛋黄', '-1')], profile));
  assert.throws(() => foldRecipeEggs([material('蛋黄', 'Infinity')], profile));
  assert.throws(() => foldRecipeEggs([material('蛋黄', '1')], { ...profile, yolk_grams: 0 }));
  assert.throws(() => foldRecipeEggs([material('蛋黄', '1', '碗')], profile));
});
