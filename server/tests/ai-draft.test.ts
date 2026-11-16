import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiDraftSchema,
  aiSystemPrompt,
  matchCategoryCatalog,
  matchDepartmentCatalog,
  mergeOrderLineItems,
  soleDepartmentAssignee,
} from '../src/ai-draft';
import { normalizeAiExpectedDelivery } from '../src/ai-time';
const valid = {
  title: '蛋糕订单',
  content: '一个生日蛋糕',
  expected_delivery_at: '2026-09-23 15:30',
};
test('AI可选备注null或缺省归一为空字符串，保留正常备注', () => {
  assert.equal(aiDraftSchema.parse({ ...valid, note: null }).note, '');
  assert.equal(aiDraftSchema.parse(valid).note, '');
  assert.equal(aiDraftSchema.parse({ ...valid, note: '不要坚果' }).note, '不要坚果');
});
test('AI备注其他错误类型仍拒绝，不放宽标题详情时间', () => {
  for (const note of [123, true, {}, []])
    assert.equal(aiDraftSchema.safeParse({ ...valid, note }).success, false);
  assert.equal(aiDraftSchema.safeParse({ ...valid, note: 'x'.repeat(10001) }).success, false);
  for (const patch of [
    { title: null },
    { title: '' },
    { content: null },
    { content: 1 },
    { expected_delivery_at: '2026-09-23' },
    { expected_delivery_at: '2026-02-30 15:30' },
  ])
    assert.equal(aiDraftSchema.safeParse({ ...valid, ...patch, note: null }).success, false);
});
test('AI同名目录仅匹配建议公司，无同名资料返回null', async () => {
  const { matchCompanyCatalog } = await import('../src/ai-draft');
  const catalog = [
    { id: '1', name: '蛋糕部', company_code: 'tri' },
    { id: '2', name: '蛋糕部', company_code: 'tmy' },
  ];
  assert.equal(matchCompanyCatalog(catalog, '蛋糕部', 'tmy'), '2');
  assert.equal(matchCompanyCatalog(catalog, '蛋糕部', 'tri'), '1');
  assert.equal(matchCompanyCatalog(catalog.slice(0, 1), '蛋糕部', 'tmy'), null);
  assert.equal(matchCompanyCatalog(catalog, null, 'tri'), null);
});
test('一张订单的多个商品即使被模型拆开，也会合并回一张完整任务', () => {
  const source = '一乐食堂9月24号\n2*10=20个三明治\n13个焦糖布丁\n11个布丁烧';
  const common = {
    content: '',
    category_name: null,
    department_name: null,
    priority: 'normal' as const,
    task_type: 'order' as const,
    expected_delivery_at: null,
    note: '',
  };
  const result = mergeOrderLineItems(
    [
      { ...common, title: '三明治', content: '2*10=20个三明治' },
      { ...common, title: '焦糖布丁', content: '13个焦糖布丁' },
      { ...common, title: '布丁烧', content: '11个布丁烧' },
    ],
    source,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].title, '一乐食堂9月24号订单');
  assert.equal(result[0].content, source);
});
test('食堂布丁订单强制匹配趣趣特的门店配送分类和蛋糕部，覆盖模型误判', () => {
  const categories = [
    { id: '1', name: '定制蛋糕' },
    { id: '2', name: '门店供应配送' },
  ];
  const departments = [
    { id: '4', name: '蛋糕部' },
    { id: '5', name: '制面部' },
  ];
  const text = '一乐食堂 13个焦糖布丁 11个布丁烧';
  assert.equal(matchCategoryCatalog(categories, '定制蛋糕', 'tri', text), '2');
  assert.equal(matchCategoryCatalog(categories, '定制蛋糕', 'tmy', text), '2');
  assert.equal(matchDepartmentCatalog(departments, '制面部', text), '4');
});
test('员工没有公司属性，部门只有一个在职员工时自动带出执行人', () => {
  const employees = [{ id: '7', department_id: '4', status: 'active', deleted_at: null }];
  assert.equal(soleDepartmentAssignee(employees, '4'), '7');
  assert.equal(
    soleDepartmentAssignee(
      [...employees, { id: '9', department_id: '4', status: 'active', deleted_at: null }],
      '4',
    ),
    null,
  );
});
test('AI提示词明确同次交付合并、布丁归趣趣特并限制现有目录', () => {
  const prompt = aiSystemPrompt('2026-09-24 15:00', [], []);
  assert.match(prompt, /绝不能按商品品种拆成多张任务/u);
  assert.match(prompt, /焦糖布丁/u);
  assert.match(prompt, /趣趣特/u);
  assert.match(prompt, /门店供应配送/u);
  assert.match(prompt, /09:00/u);
  assert.match(prompt, /禁止编造日期/u);
});

test('AI时间有日期无小时补09:00，无日期强制留空等待人工填写', () => {
  const now = '2026-09-26 10:30:00';
  assert.equal(normalizeAiExpectedDelivery('一乐食堂9月28号送货', null, now), '2026-09-28 09:00');
  assert.equal(
    normalizeAiExpectedDelivery('明天下午3点送货', '2026-09-27 15:00', now),
    '2026-09-27 15:00',
  );
  assert.equal(normalizeAiExpectedDelivery('请做20个布丁', '2026-09-27 09:00', now), null);
});
