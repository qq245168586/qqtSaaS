import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { WebPasswordGate, webPasswordRequired } from '../src/public-access';
function status(error: unknown, expected: number): boolean {
  return error instanceof HttpException && error.getStatus() === expected;
}
test('网页固定密码支持中文，缺失/错误401；桌面与未配置不要求密码', () => {
  const gate = new WebPasswordGate();
  assert.throws(
    () => gate.check('web', undefined, 'a', '固定密码'),
    (e) => status(e, 401),
  );
  assert.throws(
    () => gate.check('web', 'wrong', 'a', '固定密码'),
    (e) => status(e, 401),
  );
  assert.doesNotThrow(() => gate.check('web', '固定密码', 'a', '固定密码'));
  assert.doesNotThrow(() => gate.check('desktop', undefined, 'a', '固定密码'));
  assert.doesNotThrow(() => gate.check('web', undefined, 'a', ''));
});
test('每IP十次失败限流429，其他IP独立，15分钟失效，正确密码清除失败', () => {
  const gate = new WebPasswordGate();
  for (let i = 0; i < 10; i++)
    assert.throws(
      () => gate.check('web', 'bad', 'a', 'correct', 1000),
      (e) => status(e, 401),
    );
  assert.throws(
    () => gate.check('web', 'correct', 'a', 'correct', 1001),
    (e) => status(e, 429),
  );
  assert.doesNotThrow(() => gate.check('web', 'correct', 'b', 'correct', 1001));
  assert.doesNotThrow(() => gate.check('web', 'correct', 'a', 'correct', 901000));
  for (let i = 0; i < 9; i++)
    assert.throws(
      () => gate.check('web', 'bad', 'a', 'correct', 901001),
      (e) => status(e, 401),
    );
  gate.check('web', 'correct', 'a', 'correct', 901002);
  assert.throws(
    () => gate.check('web', 'bad', 'a', 'correct', 901003),
    (e) => status(e, 401),
  );
  assert.doesNotThrow(() => gate.check('web', 'correct', 'a', 'correct', 901004));
});
test('access-mode只公布是否配置，不泄露密码', () => {
  const previous = process.env.WEB_ACCESS_PASSWORD;
  try {
    process.env.WEB_ACCESS_PASSWORD = 'testsecret';
    assert.equal(webPasswordRequired(), true);
    process.env.WEB_ACCESS_PASSWORD = '';
    assert.equal(webPasswordRequired(), false);
  } finally {
    if (previous === undefined) delete process.env.WEB_ACCESS_PASSWORD;
    else process.env.WEB_ACCESS_PASSWORD = previous;
  }
});
