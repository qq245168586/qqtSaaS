import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptAiKey, encryptAiKey } from '../src/ai-config';

test('AI Key使用服务器密钥加密保存且可正确解密', () => {
  const before = process.env.AI_ENCRYPTION_KEY;
  try {
    process.env.AI_ENCRYPTION_KEY = 'test-encryption-key-that-is-at-least-32-bytes';
    const encrypted = encryptAiKey('sk-example-secret');
    assert.match(encrypted, /^v1:/u);
    assert.equal(encrypted.includes('sk-example-secret'), false);
    assert.equal(decryptAiKey(encrypted), 'sk-example-secret');
  } finally {
    if (before === undefined) delete process.env.AI_ENCRYPTION_KEY;
    else process.env.AI_ENCRYPTION_KEY = before;
  }
});
