import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { AiErrorCode, AiRequestError, aiFieldHint } from '../src/ai-errors';
import { aiCompletion } from '../src/external';
const config = {
  api_base_url: 'https://example.com/v1',
  api_key: 'secret-test-key',
  model_name: 'test-model',
};
const messages = [{ role: 'user' as const, content: 'private-test-prompt' }];
test('AI服务失败按认证/限流/连接/超时/结果分类，不返回上游正文或敏感内容', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'warn', (message: string) => logs.push(message));
  const cases: Array<{ status: number; body: string; code: AiErrorCode }> = [
    { status: 401, body: 'secret-test-key', code: AiErrorCode.Authentication },
    { status: 429, body: 'private-test-prompt', code: AiErrorCode.RateLimit },
    { status: 500, body: 'upstream stacktrace', code: AiErrorCode.Unavailable },
    { status: 200, body: 'invalid json', code: AiErrorCode.Json },
    { status: 200, body: '{"choices":[]}', code: AiErrorCode.Fields },
  ];
  const fetchMock = t.mock.method(globalThis, 'fetch');
  for (const item of cases) {
    fetchMock.mock.mockImplementation(async () => new Response(item.body, { status: item.status }));
    await assert.rejects(
      () => aiCompletion(config, messages, true),
      (error) =>
        error instanceof AiRequestError &&
        error.errorCode === item.code &&
        !error.message.includes(item.body),
    );
  }
  for (const name of ['TimeoutError', 'TypeError']) {
    fetchMock.mock.mockImplementation(async () => {
      const e = new Error('private-test-prompt');
      e.name = name;
      throw e;
    });
    await assert.rejects(
      () => aiCompletion(config, messages, true),
      (error) =>
        error instanceof AiRequestError &&
        error.errorCode === (name === 'TimeoutError' ? AiErrorCode.Timeout : AiErrorCode.Network),
    );
  }
  assert.equal(logs.length, 7);
  for (const value of logs) {
    assert.doesNotMatch(value, /private-test-prompt|secret-test-key|stacktrace/);
    assert.match(value, /error_id/);
  }
});
test('识别字段问题定位到条目及中文字段，不暴露原始校验信息', () => {
  const result = z
    .object({ items: z.array(z.object({ progress: z.number().max(100) })) })
    .safeParse({ items: [{ progress: 101 }] });
  assert.equal(result.success, false);
  if (result.success) throw Error('expected failure');
  assert.match(aiFieldHint(result.error.issues), /第1项的进度/);
  assert.doesNotMatch(aiFieldHint(result.error.issues), /too_big|101/);
});
