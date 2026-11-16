import { z } from 'zod';

const blockId = z.string().trim().min(1).max(64);
const textBlock = z
  .object({
    id: blockId,
    type: z.enum([
      'paragraph',
      'heading1',
      'heading2',
      'bullet',
      'number',
      'quote',
      'code',
      'todo',
    ]),
    text: z.string().max(20000),
    checked: z.boolean().optional(),
  })
  .strict();
const tableBlock = z
  .object({
    id: blockId,
    type: z.literal('table'),
    rows: z
      .array(z.array(z.string().max(2000)).min(1).max(20))
      .min(1)
      .max(100),
  })
  .strict();
const imageBlock = z
  .object({
    id: blockId,
    type: z.literal('image'),
    image_id: z.string().regex(/^\d+$/u),
    caption: z.string().max(500).default(''),
  })
  .strict();
const linkBlock = z
  .object({
    id: blockId,
    type: z.literal('link'),
    text: z.string().trim().min(1).max(500),
    url: z
      .string()
      .url()
      .max(2048)
      .refine(
        (value) => ['http:', 'https:'].includes(new URL(value).protocol),
        '仅支持HTTP/HTTPS链接',
      ),
  })
  .strict();

export interface RichTextMark {
  type: 'bold' | 'italic' | 'strike' | 'code' | 'underline' | 'link';
  attrs?: Record<string, unknown>;
}
export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  text?: string;
  marks?: RichTextMark[];
}

const nodeTypes = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'hardBreak',
  'horizontalRule',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
  'image',
]);
const markTypes = new Set(['bold', 'italic', 'strike', 'code', 'underline', 'link']);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));
const safeLink = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

function validateRichTextNode(
  value: unknown,
  depth: number,
  state: { nodes: number; textBytes: number },
): value is RichTextNode {
  if (
    !object(value) ||
    depth > 30 ||
    !exactKeys(value, ['type', 'attrs', 'content', 'text', 'marks'])
  )
    return false;
  if (typeof value.type !== 'string' || !nodeTypes.has(value.type)) return false;
  state.nodes += 1;
  if (state.nodes > 20_000) return false;
  if (value.type === 'text') {
    if (typeof value.text !== 'string' || value.text.length > 100_000) return false;
    state.textBytes += Buffer.byteLength(value.text);
    if (state.textBytes > 1_000_000 || value.content !== undefined || value.attrs !== undefined)
      return false;
  } else if (value.text !== undefined || value.marks !== undefined) return false;
  if (value.attrs !== undefined) {
    if (!object(value.attrs)) return false;
    if (value.type === 'heading') {
      if (!exactKeys(value.attrs, ['level']) || ![1, 2, 3].includes(Number(value.attrs.level)))
        return false;
    } else if (value.type === 'orderedList') {
      if (!exactKeys(value.attrs, ['start', 'type'])) return false;
      const start = Number(value.attrs.start ?? 1);
      if (!Number.isInteger(start) || start < 1 || start > 1_000_000) return false;
      if (
        value.attrs.type !== undefined &&
        value.attrs.type !== null &&
        typeof value.attrs.type !== 'string'
      )
        return false;
    } else if (value.type === 'bulletList') {
      if (
        !exactKeys(value.attrs, ['type']) ||
        (value.attrs.type !== undefined &&
          value.attrs.type !== null &&
          typeof value.attrs.type !== 'string')
      )
        return false;
    } else if (value.type === 'codeBlock') {
      if (
        !exactKeys(value.attrs, ['language']) ||
        (value.attrs.language !== undefined &&
          value.attrs.language !== null &&
          typeof value.attrs.language !== 'string')
      )
        return false;
    } else if (value.type === 'table') {
      if (
        !exactKeys(value.attrs, ['style']) ||
        (value.attrs.style !== undefined &&
          value.attrs.style !== null &&
          typeof value.attrs.style !== 'string')
      )
        return false;
    } else if (value.type === 'image') {
      if (
        !exactKeys(value.attrs, ['image_id', 'alt', 'title', 'caption']) ||
        typeof value.attrs.image_id !== 'string' ||
        !/^\d+$/u.test(value.attrs.image_id) ||
        (value.attrs.alt !== undefined && typeof value.attrs.alt !== 'string') ||
        (value.attrs.title !== undefined &&
          value.attrs.title !== null &&
          typeof value.attrs.title !== 'string') ||
        (value.attrs.caption !== undefined && typeof value.attrs.caption !== 'string')
      )
        return false;
    } else if (value.type === 'tableCell' || value.type === 'tableHeader') {
      if (!exactKeys(value.attrs, ['colspan', 'rowspan', 'colwidth'])) return false;
      const colspan = Number(value.attrs.colspan ?? 1);
      const rowspan = Number(value.attrs.rowspan ?? 1);
      if (!Number.isInteger(colspan) || colspan < 1 || colspan > 20) return false;
      if (!Number.isInteger(rowspan) || rowspan < 1 || rowspan > 100) return false;
      if (
        value.attrs.colwidth !== null &&
        value.attrs.colwidth !== undefined &&
        (!Array.isArray(value.attrs.colwidth) ||
          value.attrs.colwidth.some(
            (width) => !Number.isInteger(width) || Number(width) < 1 || Number(width) > 10000,
          ))
      )
        return false;
    } else if (!exactKeys(value.attrs, [])) return false;
  }
  if (value.marks !== undefined) {
    if (!Array.isArray(value.marks) || value.marks.length > 20) return false;
    for (const mark of value.marks) {
      if (!object(mark) || !exactKeys(mark, ['type', 'attrs'])) return false;
      if (typeof mark.type !== 'string' || !markTypes.has(mark.type)) return false;
      if (mark.type === 'link') {
        if (
          !object(mark.attrs) ||
          !exactKeys(mark.attrs, ['href', 'target', 'rel', 'class']) ||
          !safeLink(mark.attrs.href)
        )
          return false;
      } else if (
        mark.attrs !== undefined &&
        (!object(mark.attrs) || Object.keys(mark.attrs).length)
      )
        return false;
    }
  }
  if (value.content !== undefined) {
    if (!Array.isArray(value.content) || value.content.length > 10_000) return false;
    if (!value.content.every((child) => validateRichTextNode(child, depth + 1, state)))
      return false;
  }
  return true;
}

const richTextDocSchema = z.custom<RichTextNode>((value) => {
  const state = { nodes: 0, textBytes: 0 };
  return validateRichTextNode(value, 0, state) && value.type === 'doc';
}, '富文本文档格式无效');
const richTextBlock = z
  .object({ id: blockId, type: z.literal('richtext'), doc: richTextDocSchema })
  .strict();

export const wikiBlockSchema = z.discriminatedUnion('type', [
  textBlock,
  tableBlock,
  imageBlock,
  linkBlock,
  richTextBlock,
]);

export const wikiBlocksSchema = z
  .array(wikiBlockSchema)
  .min(1)
  .max(500)
  .superRefine((blocks, context) => {
    const total = blocks.reduce((size, block) => {
      if (block.type === 'link')
        return size + Buffer.byteLength(block.text) + Buffer.byteLength(block.url);
      if ('text' in block) return size + Buffer.byteLength(block.text, 'utf8');
      if (block.type === 'richtext') return size + Buffer.byteLength(JSON.stringify(block.doc));
      if (block.type === 'table')
        return (
          size +
          block.rows.reduce(
            (rowSize, row) =>
              rowSize + row.reduce((cellSize, cell) => cellSize + Buffer.byteLength(cell), 0),
            0,
          )
        );
      return size + Buffer.byteLength(block.caption);
    }, 0);
    if (total > 1_000_000)
      context.addIssue({ code: z.ZodIssueCode.custom, message: '页面正文不能超过 1MB' });
    const ids = new Set<string>();
    for (const block of blocks) {
      if (ids.has(block.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: '页面块编号不能重复' });
        break;
      }
      ids.add(block.id);
      if (block.type === 'table') {
        const width = block.rows[0]?.length ?? 0;
        if (block.rows.some((row) => row.length !== width)) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: '表格每行列数必须一致' });
          break;
        }
      }
    }
  });

export type WikiBlock = z.infer<typeof wikiBlockSchema>;

function richTextValues(node: RichTextNode, images: string[], text: string[]): void {
  if (node.type === 'text' && node.text) text.push(node.text);
  if (node.type === 'image') {
    const id = node.attrs?.image_id;
    if (typeof id === 'string') images.push(id);
    const caption = node.attrs?.caption;
    if (typeof caption === 'string' && caption) text.push(caption);
  }
  for (const mark of node.marks ?? []) {
    const href = mark.type === 'link' ? mark.attrs?.href : undefined;
    if (typeof href === 'string') text.push(href);
  }
  for (const child of node.content ?? []) richTextValues(child, images, text);
}

export function wikiImageIds(blocks: WikiBlock[]): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    if (block.type === 'image') ids.push(block.image_id);
    if (block.type === 'richtext') richTextValues(block.doc, ids, []);
  }
  return [...new Set(ids)];
}

export function wikiPlainText(blocks: WikiBlock[]): string {
  return blocks
    .flatMap((block) => {
      if (block.type === 'link') return [block.text, block.url];
      if ('text' in block) return [block.text.trim()];
      if (block.type === 'richtext') {
        const text: string[] = [];
        richTextValues(block.doc, [], text);
        return text.map((value) => value.trim());
      }
      if (block.type === 'table') return block.rows.flat().map((cell) => cell.trim());
      return [block.caption];
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, 1_000_000);
}

export function parseWikiBlocks(value: unknown): WikiBlock[] {
  const decoded = typeof value === 'string' ? JSON.parse(value) : value;
  return wikiBlocksSchema.parse(decoded);
}
