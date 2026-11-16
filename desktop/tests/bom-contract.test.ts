import assert from 'node:assert/strict';
import test from 'node:test';
import { toBomParseRequest } from '../src/bom-contract.ts';

test('BOM解析表单将配方正文转换为服务端 text 字段', () => {
  const request = toBomParseRequest({
    company_code: 'tri',
    source_text: '蓝莓蛋糕\n鸡蛋 100g',
  });

  assert.deepEqual(request, {
    company_code: 'tri',
    text: '蓝莓蛋糕\n鸡蛋 100g',
  });
  assert.equal('source_text' in request, false);
});
