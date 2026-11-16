import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesText } from '../src/search';

test('customer, product and personnel support Chinese, full pinyin and initials', () => {
  for (const [value, chinese, pinyin, initials] of [
    ['御牛纪-海岸城店', '御牛纪', 'yuniuji', 'ynj'],
    ['天美意客户', '美意', 'tianmeiyi', 'tmy'],
    ['奶油蛋糕', '蛋糕', 'naiyoudangao', 'nydg'],
    ['张景美', '景美', 'zhangjingmei', 'zjm'],
  ]) {
    for (const query of [chinese, pinyin, initials])
      assert.equal(matchesText(value, query), true, `${value}: ${query}`);
    assert.equal(matchesText(value, 'zzzzzz'), false);
  }
});
test('search preserves the first-phase NFKC, mixed terms and AND semantics', () => {
  const value = '天美意客户 A12 深圳 13800138000';
  assert(matchesText(value, 'ＴＭＹ ａ１２'));
  assert(matchesText(value, 'tmy 深圳 1380'));
  assert(matchesText(value, '  '));
  assert(!matchesText(value, 'tmy 上海'));
  assert.equal(value, '天美意客户 A12 深圳 13800138000');
});
