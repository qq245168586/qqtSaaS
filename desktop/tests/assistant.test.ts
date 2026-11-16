import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantResponseSchema,
  assistantDrafts,
  assistantSummary,
  emptyAssistant,
} from '../src/assistant-model';
import { initialState, reducer } from '../src/store';
test('预填只生成未确认草稿，保留缺失日期、数量、单价并标记待补充', () => {
  const response = assistantResponseSchema.parse({
    clarification: '',
    items: [
      {
        module: 'delivery',
        source_text: '给客户开单',
        warnings: ['请补日期'],
        value: {
          company_code: 'tmy',
          delivery_date: '',
          customer_name_snapshot: '客户',
          is_draft: false,
          items: [{ product_name: '新品', unit: '包', quantity: '', unit_price: '' }],
        },
      },
    ],
  });
  const drafts = assistantDrafts(response, () => 'test');
  assert.equal(drafts[0].saved, false);
  assert.equal(drafts[0].key, 'test');
  assert.equal(assistantSummary(drafts[0]).date, '待补送货日期');
  assert.match(assistantSummary(drafts[0]).details, /待填数量.*待填单价/);
});
test('AI内容在切换页面时由共享状态保留，退出会话清空', () => {
  const state = reducer(initialState(), {
    type: 'assistant',
    value: { ...emptyAssistant(), text: '张景美明天上班', module: 'schedule' },
  });
  assert.equal(state.assistant.text, '张景美明天上班');
  assert.deepEqual(reducer(state, { type: 'session', session: null }).assistant, emptyAssistant());
});
test('未知模块或畸形排班返回不能进入表单', () => {
  assert.equal(
    assistantResponseSchema.safeParse({
      clarification: '',
      items: [{ module: 'inventory', value: {} }],
    }).success,
    false,
  );
  assert.equal(
    assistantResponseSchema.safeParse({
      clarification: '',
      items: [
        {
          module: 'schedule',
          source_text: '排班',
          warnings: [],
          value: {
            employee_id: '1',
            employee_name: '员工',
            work_date: null,
            shift_kind: 'work',
            start_time: '08:00',
            overtime_minutes: -1,
            timeoff_minutes: 0,
            note: '',
          },
        },
      ],
    }).success,
    false,
  );
});

test('待办预填保留缺失时间且必须人工确认创建', () => {
  const response = assistantResponseSchema.parse({
    clarification: '',
    items: [
      {
        module: 'todo',
        source_text: '记录采购待办',
        warnings: ['请补时间'],
        value: { title: '采购', note: '确认库存', starts_at: null, ends_at: null, progress: 0 },
      },
    ],
  });
  const draft = assistantDrafts(response, () => 'todo-test')[0];
  assert.equal(draft.saved, false);
  assert.equal(draft.module, 'todo');
  assert.match(assistantSummary(draft).date, /待补开始时间.*待补截止时间/);
  assert.match(assistantSummary(draft).details, /一次性任务 · 状态：未完成/);
});
