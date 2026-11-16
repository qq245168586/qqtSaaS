import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWikiBlocks, wikiBlocksSchema, wikiImageIds, wikiPlainText } from '../src/wiki-core';

test('知识库块校验、纯文本检索内容和JSON往返一致', () => {
  const blocks = wikiBlocksSchema.parse([
    { id: 'a', type: 'heading1', text: '门店制度' },
    { id: 'b', type: 'todo', text: '每天核对订单', checked: true },
  ]);
  assert.equal(wikiPlainText(blocks), '门店制度\n每天核对订单');
  assert.deepEqual(parseWikiBlocks(JSON.stringify(blocks)), blocks);
});

test('Word式富文本保存连续正文、表格、图片和安全链接', () => {
  const blocks = wikiBlocksSchema.parse([
    {
      id: 'doc-1',
      type: 'richtext',
      doc: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '会议纪要' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '直接连续输入正文，' },
              {
                type: 'text',
                text: '查看资料',
                marks: [
                  {
                    type: 'link',
                    attrs: {
                      href: 'https://example.com/doc',
                      target: '_blank',
                      rel: 'noopener noreferrer nofollow',
                      class: null,
                    },
                  },
                ],
              },
            ],
          },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableHeader',
                    attrs: { colspan: 1, rowspan: 1, colwidth: null },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: '项目' }] }],
                  },
                ],
              },
            ],
          },
          { type: 'image', attrs: { image_id: '21', alt: '', title: null, caption: '现场图' } },
        ],
      },
    },
  ]);
  assert.match(wikiPlainText(blocks), /会议纪要/);
  assert.match(wikiPlainText(blocks), /项目/);
  assert.match(wikiPlainText(blocks), /https:\/\/example.com\/doc/);
  assert.deepEqual(wikiImageIds(blocks), ['21']);
  assert.equal(
    wikiBlocksSchema.safeParse([
      {
        id: 'bad-doc',
        type: 'richtext',
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: '危险',
                  marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
                },
              ],
            },
          ],
        },
      },
    ]).success,
    false,
  );
});

test('知识库拒绝重复块编号和未知块类型', () => {
  assert.equal(
    wikiBlocksSchema.safeParse([
      { id: 'same', type: 'paragraph', text: '一' },
      { id: 'same', type: 'paragraph', text: '二' },
    ]).success,
    false,
  );
  assert.equal(
    wikiBlocksSchema.safeParse([{ id: 'x', type: 'html', text: '<script>' }]).success,
    false,
  );
});

test('Confluence支持表格、图片和安全超链接并纳入检索正文', () => {
  const blocks = wikiBlocksSchema.parse([
    {
      id: 'table',
      type: 'table',
      rows: [
        ['项目', '负责人'],
        ['上新', '张三'],
      ],
    },
    { id: 'image', type: 'image', image_id: '12', caption: '门店陈列' },
    { id: 'link', type: 'link', text: '查看官网', url: 'https://example.com/docs' },
  ]);
  assert.equal(
    wikiPlainText(blocks),
    '项目\n负责人\n上新\n张三\n门店陈列\n查看官网\nhttps://example.com/docs',
  );
  assert.equal(
    wikiBlocksSchema.safeParse([
      { id: 'bad', type: 'link', text: '危险链接', url: 'javascript:alert(1)' },
    ]).success,
    false,
  );
  assert.equal(
    wikiBlocksSchema.safeParse([{ id: 'bad-table', type: 'table', rows: [['A', 'B'], ['C']] }])
      .success,
    false,
  );
});
