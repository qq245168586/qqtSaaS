import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { AxiosError, AxiosHeaders } from 'axios';
import { assistantFailure } from '../src/assistant-errors';

test('旧客户端模块校验错误转中文，不再输出Zod JSON', () => {
  const result = z
    .discriminatedUnion('module', [z.object({ module: z.literal('retail') })])
    .safeParse({ module: 'todo' });
  assert.equal(result.success, false);
  if (result.success) throw Error('expected failure');
  const view = assistantFailure(result.error);
  assert.equal(view.code, 'AI_CLIENT_UNSUPPORTED');
  assert.equal(view.title, '客户端版本不兼容');
  assert.doesNotMatch(view.message, /invalid_union|discriminator|Expected/);
});
test('服务端错误码和排查编号有明确中文提示，未知正文不直接显示', () => {
  const request = (data: unknown, status = 502) =>
    new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
      data,
      status,
      statusText: 'error',
      headers: {},
      config: { headers: new AxiosHeaders() },
    });
  const view = assistantFailure(
    request({
      error_code: 'AI_OUTPUT_FIELDS',
      error_stage: 'validation',
      error_id: '12345678-1234-1234-1234-123456789abc',
      message: '第1项的进度格式不正确，请重新识别。',
    }),
  );
  assert.equal(view.code, 'AI_OUTPUT_FIELDS');
  assert.equal(view.stage, '识别结果校验');
  assert.equal(view.reference, '12345678');
  assert.match(view.message, /进度/);
  const raw = assistantFailure(request('<html>private stacktrace</html>'));
  assert.doesNotMatch(JSON.stringify(raw), /private|stacktrace|html/);
  assert.equal(assistantFailure(new AxiosError('Network Error', 'ERR_NETWORK')).code, 'AI_NETWORK');
  assert.equal(assistantFailure(new AxiosError('timeout', 'ECONNABORTED')).code, 'AI_TIMEOUT');
});
