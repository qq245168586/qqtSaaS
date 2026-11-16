import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantForClient,
  normalizeTodoDraft,
  assistantInput,
  assistantModelResponse,
  assistantSystemPrompt,
  assistantDate,
  checkAssistantScope,
  matchAssistantEmployee,
} from '../src/ai-assistant';
import { AiController } from '../src/external';
import { db } from '../src/db';
import type { AuthRequest } from '../src/auth';
const now = '2026-10-09 10:30:00';
const seed = {
  module: 'schedule' as const,
  source_excerpt: '张景美明天9点上班',
  value: {
    employee_name: '张景美',
    work_date: '2026-10-10',
    shift_kind: 'work',
    start_time: '09:00',
  },
};
test('指定模块、原文依据和混合模块边界不能被模型绕过', () => {
  const result = assistantModelResponse.parse({ items: [seed] });
  assert.throws(
    () =>
      checkAssistantScope(
        result,
        assistantInput.parse({ text: seed.source_excerpt, module: 'delivery' }),
      ),
    /指定模块/,
  );
  assert.throws(
    () => checkAssistantScope(result, assistantInput.parse({ text: '完全不同的原文' })),
    /原文/,
  );
  assert.equal(
    assistantModelResponse.safeParse({ items: [{ ...seed, module: 'delete' }] }).success,
    false,
  );
  assert.equal(assistantInput.safeParse({ text: '内容', execute: true }).success, false);
  assert.throws(
    () => checkAssistantScope({ items: [], clarification: '' }, { text: '内容', module: 'auto' }),
    /没有识别/,
  );
});
test('无日期不接受模型虚构日期，明确日期范围可逐天展开', () => {
  assert.equal(assistantDate('张景美9点上班', '2026-10-10', now), null);
  assert.equal(assistantDate('张景美明天9点上班', '2026-10-11', now), '2026-10-10');
  assert.equal(assistantDate('张景美11月12日至15日上班', '2026-11-14', now), '2026-11-14');
  assert.equal(assistantDate('张景美11月12日至15日上班', '2026-11-16', now), '2026-11-12');
});
test('员工精确唯一匹配且按日期验证离职，未知名字不带出', () => {
  const employees = [{ id: '8', name: '张景美', status: 'left', left_on: '2026-10-10' }];
  assert.equal(matchAssistantEmployee(employees, '张景美', '2026-10-09'), '8');
  assert.equal(matchAssistantEmployee(employees, '张景美', '2026-10-10'), null);
  assert.equal(
    matchAssistantEmployee([...employees, { id: '9', name: '张景美' }], '张景美', '2026-10-09'),
    null,
  );
  assert.equal(matchAssistantEmployee(employees, '不存在', '2026-10-09'), null);
});
test('模块规则包含人工创建、自由商品、例休与调休分离及不支持的操作', () => {
  const prompt = assistantSystemPrompt(now, 'auto', [], [], []);
  for (const rule of [
    '永远不执行保存',
    '同一次交付',
    '完全自由输入',
    '480分钟',
    '不扣调休小时',
    '过去、今天和未来日期都可以预填排班',
    '仓库库存',
    'product_summary',
    'delivery_address',
    'delivery_fee',
    'order_taker_name',
    '商品本身金额',
  ])
    assert.ok(prompt.includes(rule), rule);
});
test('全局解析只读；四类草稿保留缺失字段并过滤模型伪造ID，不写业务表', async (t) => {
  t.mock.method(db.manager, 'query', async (sql: string) => {
    assert.match(sql, /^SELECT/, '解析不可写库');
    if (sql.includes('FROM ai_configs')) return [];
    if (sql.includes('FROM employees'))
      return [
        {
          id: '8',
          name: '张景美',
          department_id: '2',
          status: 'active',
          left_on: null,
          deleted_at: null,
        },
      ];
    if (sql.includes('FROM categories')) return [];
    if (sql.includes('FROM departments')) return [{ id: '2', name: '蛋糕部' }];
    if (sql.includes('FROM customers'))
      return [
        { id: '5', name: '自定义客户', company_code: 'tmy', address: '历史地址', phone: '123' },
      ];
    if (sql.includes('FROM tasks')) return [{ name: '微信', usage_count: 1, last_used_at: '' }];
    if (sql.includes('company_choice_samples')) return [];
    throw Error('Unexpected SQL: ' + sql);
  });
  const original = {
    base: process.env.AI_API_BASE_URL,
    key: process.env.AI_API_KEY,
    model: process.env.AI_MODEL_NAME,
  };
  process.env.AI_API_BASE_URL = 'https://example.com/v1';
  process.env.AI_API_KEY = 'test';
  process.env.AI_MODEL_NAME = 'test';
  t.after(() => {
    for (const [key, value] of Object.entries({
      AI_API_BASE_URL: original.base,
      AI_API_KEY: original.key,
      AI_MODEL_NAME: original.model,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const retailText =
    '客户买蓝莓乳酪蛋糕10个，商品金额88元，配送费12元，送到南山科技园，张景美制作，接单人张景美';
  const todoText = '记录待办：确认采购，下周再定日期，进度25%';
  const deliveryText = '给自定义客户开送货单，商品叫自由新品';
  let scheduleText = '张景美上班';
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      module: 'retail',
                      source_excerpt: retailText,
                      value: {
                        title: '布丁订单',
                        content: retailText,
                        product_summary: '蓝莓乳酪',
                        delivery_address: '南山科技园',
                        employee_name: '张景美',
                        order_taker_name: '张景美',
                        order_amount: 88,
                        delivery_fee: 12,
                        assignee_employee_id: '999',
                      },
                    },
                    {
                      module: 'delivery',
                      source_excerpt: deliveryText,
                      value: {
                        customer_name_snapshot: '自定义客户',
                        items: [
                          {
                            product_name: '自由新品',
                            unit: '包',
                            quantity: null,
                            unit_price: null,
                            product_id: '999',
                          },
                        ],
                      },
                    },
                    {
                      module: 'todo',
                      source_excerpt: todoText,
                      value: { title: '确认采购', progress: 25 },
                    },
                    {
                      module: 'schedule',
                      source_excerpt: scheduleText,
                      value: {
                        employee_name: '张景美',
                        work_date: null,
                        shift_kind: 'work',
                        employee_id: '999',
                      },
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
  );
  const req = {
    user: {
      id: '1',
      company_id: '2',
      company_code: 'tmy',
      username: 'public',
      real_name: '共享',
      role: 'boss',
      employee_id: null,
      must_change_password: false,
      public_access: true,
    },
  } as AuthRequest;
  const result = await new AiController().assistant(req, {
    text: [retailText, deliveryText, todoText, scheduleText].join('\n'),
    module: 'auto',
    supported_modules: ['retail', 'delivery', 'schedule', 'todo'],
  });
  const items = result.items as Array<{ module: string; value: Record<string, unknown> }>;
  assert.equal(items.length, 4);
  assert.equal(items[2].module, 'todo');
  assert.match(String(items[2].value.starts_at), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.ok(
    Math.abs(
      Date.now() - Date.parse(String(items[2].value.starts_at).replace(' ', 'T') + ':00+08:00'),
    ) < 120_000,
  );
  assert.equal(items[2].value.ends_at, null);
  assert.equal(items[2].value.progress, 0);
  assert.equal(items[2].value.company_code, undefined);
  assert.equal(items[0].value.expected_delivery_at, null);
  assert.equal(items[0].value.company_code, 'tri');
  assert.equal(items[0].value.order_amount, 88);
  assert.equal(items[0].value.delivery_fee, 12);
  assert.equal(items[0].value.product_summary, '蓝莓乳酪');
  assert.equal(items[0].value.delivery_address, '南山科技园');
  assert.equal(items[0].value.assignee_employee_id, '8');
  assert.equal(items[0].value.order_taker_employee_id, '8');
  assert.equal(items[1].value.delivery_date, '');
  assert.equal(items[1].value.customer_address_snapshot, '历史地址');
  const line = (items[1].value.items as Array<Record<string, unknown>>)[0];
  assert.equal(line.quantity, '');
  assert.equal(line.unit_price, '');
  assert.equal(line.product_id, undefined);
  assert.equal(items[3].value.employee_id, '8');
  assert.equal(items[3].value.work_date, null);
  scheduleText = '张景美2026年9月30日上班';
  const historical = await new AiController().assistant(req, {
    text: [retailText, deliveryText, todoText, scheduleText].join('\n'),
    module: 'auto',
    supported_modules: ['retail', 'delivery', 'schedule', 'todo'],
  });
  const historicalItems = historical.items as Array<{
    module: string;
    value: Record<string, unknown>;
    warnings: string[];
  }>;
  assert.equal(historicalItems[3].value.work_date, '2026-09-30');
  assert.equal(historicalItems[3].value.employee_id, '8');
  assert.equal(
    historicalItems[3].warnings.some((warning) => /过去|未来日期/.test(warning)),
    false,
  );
});

test('真实模型的null默认枚举及日期/ISO格式可归一化，不放过非法枚举和缺失日期', () => {
  const draft = (date: string | null) =>
    assistantModelResponse.parse({
      items: [
        {
          module: 'retail',
          source_excerpt: '10月12日布丁订单',
          value: { title: '布丁订单', priority: null, task_type: null, expected_delivery_at: date },
        },
      ],
    }).items[0];
  for (const date of ['2026-10-12', '2026-10-12T09:00:00', '2026-10-12 09:00']) {
    const result = draft(date);
    assert.equal(result.module, 'retail');
    if (result.module !== 'retail') throw new Error('wrong module');
    assert.equal(result.value.priority, 'normal');
    assert.equal(result.value.task_type, 'order');
    assert.equal(result.value.expected_delivery_at, '2026-10-12 09:00');
  }
  const noDate = draft(null);
  if (noDate.module === 'retail') assert.equal(noDate.value.expected_delivery_at, null);
  assert.equal(
    assistantModelResponse.safeParse({
      items: [
        { module: 'retail', source_excerpt: '原文', value: { title: '标题', priority: 'invalid' } },
      ],
    }).success,
    false,
  );
});

test('排班未提及加班/调休时模型null视为零，负时长仍拒绝', () => {
  const result = assistantModelResponse.parse({
    items: [{ ...seed, value: { ...seed.value, overtime_minutes: null, timeoff_minutes: null } }],
  }).items[0];
  if (result.module !== 'schedule') throw new Error('wrong module');
  assert.equal(result.value.overtime_minutes, 0);
  assert.equal(result.value.timeoff_minutes, 0);
  assert.equal(
    assistantModelResponse.safeParse({
      items: [{ ...seed, value: { ...seed.value, overtime_minutes: -60 } }],
    }).success,
    false,
  );
});

test('待办起止时间分别依据原文，缺日期不虚构，不能将未完成识别为完成', () => {
  const parse = (source: string, starts_text: string, ends_text: string) => {
    const item = assistantModelResponse.parse({
      items: [
        {
          module: 'todo',
          source_excerpt: source,
          value: {
            title: '采购确认',
            starts_text,
            ends_text,
            starts_at: '2030-01-01 10:00',
            ends_at: '2030-02-01 10:00',
            progress: 100,
          },
        },
      ],
    }).items[0];
    if (item.module !== 'todo') throw Error('module');
    return normalizeTodoDraft(item.value, source, now);
  };
  const dated = parse('明天9点开始，后天18点截止，进度25%', '明天9点', '后天18点');
  assert.equal(dated.starts_at, '2026-10-10 09:00');
  assert.equal(dated.ends_at, '2026-10-11 18:00');
  assert.equal(dated.progress, 0);
  const sameDay = parse('明天9点开始，18点截止', '明天9点', '18点');
  assert.equal(sameDay.ends_at, '2026-10-10 18:00');
  const missing = parse('采购确认还没完成', '', '');
  assert.equal(missing.starts_at, now.slice(0, 16));
  assert.equal(missing.ends_at, null);
  assert.equal(missing.progress, 0);
  assert.equal(parse('采购已完成', '', '').progress, 0);
  assert.equal(parse('采购进度100%', '', '').progress, 0);
  const invented = parse('确认采购', '明天9点', '后天18点');
  assert.equal(invented.starts_at, now.slice(0, 16));
  assert.equal(invented.ends_at, null);
  const reversed = parse('后天开始，明天截止', '后天', '明天');
  assert.ok(reversed.starts_at! > reversed.ends_at!);
});

test('旧客户端仅返回原有三类模块，待办给出可读升级提示，新客户端得到完整草稿', () => {
  const result = assistantModelResponse.parse({
    items: [seed, { module: 'todo', source_excerpt: '盘点待办', value: { title: '盘点' } }],
  });
  const legacy = assistantForClient(
    result,
    assistantInput.parse({ text: '盘点待办' }).supported_modules,
  );
  assert.equal(legacy.items.length, 1);
  assert.equal(legacy.items[0].module, 'schedule');
  assert.match(legacy.clarification, /当前 App 版本尚不支持/);
  assert.match(legacy.clarification, /待办事项/);
  const modern = assistantForClient(result, ['retail', 'delivery', 'schedule', 'todo']);
  assert.equal(modern.items.length, 2);
  assert.equal(modern.clarification, '');
});

test('盘点待办保留部分已完成备注，不把整项标为完成，下周五截止且开始默认当前时间', () => {
  const source = '做一个待办事项，要盘点2楼的物料，下周五要做完，帮我备注铁塔奶油已经盘点好了';
  const get = (text: string) => {
    const item = assistantModelResponse.parse({
      items: [
        {
          module: 'todo',
          source_excerpt: text,
          value: {
            title: '盘点2楼物料',
            note: '铁塔奶油已经盘点好了',
            ends_text: '下周五',
            ends_at: '2026-11-20 09:00',
            progress: 100,
          },
        },
      ],
    }).items[0];
    if (item.module !== 'todo') throw Error('module');
    return normalizeTodoDraft(item.value, text, '2026-11-13 18:00:00');
  };
  const value = get(source);
  assert.equal(value.starts_at, '2026-11-13 18:00');
  assert.equal(value.ends_at, '2026-11-20 09:00');
  assert.equal(value.progress, 0);
  assert.equal(value.note, '铁塔奶油已经盘点好了');
  assert.equal(get('盘点2楼物料，下周五要做完，备注铁塔奶油已完成').progress, 0);
  assert.equal(get('计划明天已完成').progress, 0);
});
