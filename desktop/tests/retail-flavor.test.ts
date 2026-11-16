import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retailFlavor } from '../src/retail-flavor';

test('按业务示例提取口味，不把尺寸、重量、水果装饰或品类当口味', () => {
  const examples = [
    ['蛋糕夹心鲜水果夹心', '鲜水果夹心'],
    ['6寸薄荷柑橘生子蛋糕', '薄荷柑橘'],
    ['6寸焙茶蛋糕订单', '焙茶'],
    ['4寸芒果泰奶米布丁', '泰奶'],
    ['伯爵红茶80克', '伯爵红茶'],
    ['海盐芝士芒果', '海盐芝士'],
    ['薄荷生巧奥利奥', '薄荷生巧、奥利奥'],
    ['水果蛋糕', ''],
    ['茶切', ''],
    ['茶歇订单', ''],
    ['定制生日蛋糕', ''],
    ['口味待定', ''],
  ];
  for (const [content, expected] of examples)
    assert.equal(retailFlavor({ content }), expected, content);
});

test('历史原文和夹心备注可识别，重复字段合并，不臆测未知口味', () => {
  assert.equal(
    retailFlavor({ source_text: '口味：焙茶', note: '鲜水果夹心', title: '焙茶蛋糕' }),
    '鲜水果夹心、焙茶',
  );
  assert.equal(retailFlavor({ content: '蛋糕', note: '夹心：奥利奥' }), '奥利奥');
  assert.equal(retailFlavor({ content: '口味：神秘新品' }), '');
  assert.equal(retailFlavor({}), '');
});

test('不从地址、联系人和否定要求推断口味', () => {
  assert.equal(retailFlavor({ content: '定制蛋糕；地址：薄荷路咖啡大厦；联系人：茉莉' }), '');
  assert.equal(retailFlavor({ content: '不要奥利奥，口味焙茶' }), '焙茶');
});
