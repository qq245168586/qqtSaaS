import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyMatchSchema, taskSchema } from '../src/contracts';
test('fallback nullable keyword and learned company reasons survive task drafts', () => {
  const match = {
    source: 'fallback',
    reason: '未匹配，默认主营公司',
    confidence: 0,
    keyword: null,
    sample_count: 0,
    agreement: 0,
  };
  assert.equal(companyMatchSchema.parse(match).keyword, null);
  const draft = taskSchema
    .omit({ id: true, status: true })
    .partial()
    .parse({
      company_code: 'tri',
      company_match: { ...match, source: 'learned', keyword: '御牛纪' },
    });
  assert.equal(draft.company_code, 'tri');
  assert.equal(draft.company_match?.keyword, '御牛纪');
});
