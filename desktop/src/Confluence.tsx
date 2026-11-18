import { VoiceDocument } from './voice/VoiceDocument';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Drawer,
  Empty,
  Image,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tree,
  Typography,
  Upload,
  message,
  type TreeDataNode,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  FileAddOutlined,
  FontSizeOutlined,
  LinkOutlined,
  PictureOutlined,
  PlusOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { z } from 'zod';
import { api, errorText, ipc } from './api';
import type { JSONContent } from '@tiptap/core';
import { RichWikiEditor, emptyWikiDocument } from './RichWikiEditor';

const textBlockTypes = [
  ['paragraph', '正文'],
  ['heading1', '大标题'],
  ['heading2', '小标题'],
  ['bullet', '项目符号'],
  ['number', '编号列表'],
  ['quote', '引用'],
  ['code', '代码'],
  ['todo', '待办'],
] as const;
const textBlockTypeSchema = z.enum(textBlockTypes.map(([value]) => value));
type TextBlockType = z.infer<typeof textBlockTypeSchema>;
const textBlockSchema = z.object({
  id: z.string(),
  type: textBlockTypeSchema,
  text: z.string(),
  checked: z.boolean().optional(),
});
type TextBlock = z.infer<typeof textBlockSchema>;
const tableBlockSchema = z.object({
  id: z.string(),
  type: z.literal('table'),
  rows: z.array(z.array(z.string())),
});
const imageBlockSchema = z.object({
  id: z.string(),
  type: z.literal('image'),
  image_id: z.string(),
  caption: z.string(),
});
const linkBlockSchema = z.object({
  id: z.string(),
  type: z.literal('link'),
  text: z.string(),
  url: z.string(),
});
const blockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  tableBlockSchema,
  imageBlockSchema,
  linkBlockSchema,
]);
type Block = z.infer<typeof blockSchema>;
type TableBlock = z.infer<typeof tableBlockSchema>;
const richTextBlockSchema = z.object({
  id: z.string(),
  type: z.literal('richtext'),
  doc: z.record(z.string(), z.unknown()),
});
type RichTextBlock = z.infer<typeof richTextBlockSchema> & { doc: JSONContent };
const pageBlockSchema = z.union([blockSchema, richTextBlockSchema]);
type PageBlock = Block | RichTextBlock;
const pageSummarySchema = z.object({
  id: z.string(),
  parent_id: z.string().nullable(),
  directory_path: z.string(),
  title: z.string(),
  icon: z.string(),
  position: z.number(),
  version: z.number(),
  updated_at: z.string(),
  updated_by_name: z.string(),
});
type PageSummary = z.infer<typeof pageSummarySchema>;
const pageDetailSchema = pageSummarySchema.extend({ blocks: z.array(pageBlockSchema) });
type PageDetail = z.infer<typeof pageDetailSchema>;
const pageListSchema = z.object({ items: z.array(pageSummarySchema), total: z.number() });
const versionSchema = z.object({
  id: z.string(),
  page_id: z.string(),
  version: z.number(),
  title: z.string(),
  icon: z.string(),
  created_at: z.string(),
  created_by_name: z.string(),
});
type PageVersion = z.infer<typeof versionSchema>;
const versionListSchema = z.object({ items: z.array(versionSchema), total: z.number() });
const uploadedImageSchema = z.object({
  id: z.string(),
  file_name: z.string(),
  url: z.string().url(),
});

function isTextBlock(block: Block): block is TextBlock {
  return textBlockTypeSchema.safeParse(block.type).success;
}

function CachedWikiImage({ id, caption }: { id: string; caption: string }) {
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setFailed(false);
    void ipc(
      window.desktop.wikiImage(id),
      z.object({ bytes: z.instanceof(Uint8Array), type: z.string() }),
    )
      .then((data) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(
          new Blob([new Uint8Array(data.bytes)], { type: data.type }),
        );
        setSource(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, revision]);
  if (failed)
    return <Button onClick={() => setRevision((current) => current + 1)}>重试图片</Button>;
  return source ? <Image src={source} alt={caption || '页面图片'} /> : <Spin size="small" />;
}

function newTextBlock(type: TextBlockType = 'paragraph'): Block {
  return {
    id: crypto.randomUUID(),
    type,
    text: '',
    ...(type === 'todo' ? { checked: false } : {}),
  };
}

function newTableBlock(): TableBlock {
  return {
    id: crypto.randomUUID(),
    type: 'table',
    rows: [
      ['列 1', '列 2'],
      ['', ''],
    ],
  };
}

function textContent(text: string): JSONContent[] | undefined {
  return text ? [{ type: 'text', text }] : undefined;
}

function legacyNode(block: Block): JSONContent {
  if (block.type === 'heading1' || block.type === 'heading2')
    return {
      type: 'heading',
      attrs: { level: block.type === 'heading1' ? 1 : 2 },
      content: textContent(block.text),
    };
  if (block.type === 'bullet' || block.type === 'number')
    return {
      type: block.type === 'bullet' ? 'bulletList' : 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: textContent(block.text) }],
        },
      ],
    };
  if (block.type === 'quote')
    return {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: textContent(block.text) }],
    };
  if (block.type === 'code') return { type: 'codeBlock', content: textContent(block.text) };
  if (block.type === 'todo')
    return {
      type: 'paragraph',
      content: textContent(`${block.checked ? '☑' : '☐'} ${block.text}`),
    };
  if (block.type === 'table')
    return {
      type: 'table',
      content: block.rows.map((row, rowIndex) => ({
        type: 'tableRow',
        content: row.map((cell) => ({
          type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
          attrs: { colspan: 1, rowspan: 1, colwidth: null },
          content: [{ type: 'paragraph', content: textContent(cell) }],
        })),
      })),
    };
  if (block.type === 'image')
    return {
      type: 'image',
      attrs: { image_id: block.image_id, alt: block.caption, title: null, caption: block.caption },
    };
  if (block.type === 'link')
    return {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: block.text,
          marks: [
            {
              type: 'link',
              attrs: {
                href: block.url,
                target: '_blank',
                rel: 'noopener noreferrer nofollow',
                class: null,
              },
            },
          ],
        },
      ],
    };
  return { type: 'paragraph', content: textContent(block.text) };
}

function richBlocks(blocks: PageBlock[]): RichTextBlock[] {
  if (blocks.length === 1 && blocks[0]?.type === 'richtext') return [blocks[0]];
  return [
    {
      id: crypto.randomUUID(),
      type: 'richtext',
      doc: {
        type: 'doc',
        content: blocks.length
          ? blocks.map((block) => legacyNode(block as Block))
          : emptyWikiDocument().content,
      },
    },
  ];
}

function displayTime(value: string): string {
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}+08:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(parsed);
}

function treeNodes(pages: PageSummary[], keyword: string): TreeDataNode[] {
  if (keyword) return pages.map((page) => ({ key: page.id, title: `${page.icon} ${page.title}` }));
  const children = new Map<string | null, PageSummary[]>();
  const ids = new Set(pages.map((page) => page.id));
  for (const page of pages) {
    const parent = page.parent_id && ids.has(page.parent_id) ? page.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), page]);
  }
  const build = (parent: string | null): TreeDataNode[] =>
    (children.get(parent) ?? []).map((page) => ({
      key: page.id,
      title: `${page.icon} ${page.title}`,
      children: build(page.id),
    }));
  return build(null);
}

function BlockControls({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <Space.Compact className="confluence-block-actions">
      <Button aria-label="上移" disabled={index === 0} onClick={() => onMove(-1)}>
        <ArrowUpOutlined />
      </Button>
      <Button aria-label="下移" disabled={index === count - 1} onClick={() => onMove(1)}>
        <ArrowDownOutlined />
      </Button>
      <Button danger aria-label="删除内容块" onClick={onRemove}>
        <DeleteOutlined />
      </Button>
    </Space.Compact>
  );
}

function TableEditor({
  block,
  onChange,
}: {
  block: TableBlock;
  onChange: (next: TableBlock) => void;
}) {
  const updateCell = (row: number, column: number, value: string) =>
    onChange({
      ...block,
      rows: block.rows.map((cells, rowIndex) =>
        rowIndex === row
          ? cells.map((cell, columnIndex) => (columnIndex === column ? value : cell))
          : cells,
      ),
    });
  const columnCount = block.rows[0]?.length ?? 1;
  return (
    <div className="confluence-table-editor">
      <table>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, columnIndex) => (
                <td key={columnIndex}>
                  <Input
                    aria-label={`第${rowIndex + 1}行第${columnIndex + 1}列`}
                    value={cell}
                    maxLength={2000}
                    onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Space wrap>
        <Button
          size="small"
          onClick={() => onChange({ ...block, rows: [...block.rows, Array(columnCount).fill('')] })}
        >
          + 行
        </Button>
        <Button
          size="small"
          disabled={block.rows.length <= 1}
          onClick={() => onChange({ ...block, rows: block.rows.slice(0, -1) })}
        >
          − 行
        </Button>
        <Button
          size="small"
          disabled={columnCount >= 20}
          onClick={() => onChange({ ...block, rows: block.rows.map((row) => [...row, '']) })}
        >
          + 列
        </Button>
        <Button
          size="small"
          disabled={columnCount <= 1}
          onClick={() => onChange({ ...block, rows: block.rows.map((row) => row.slice(0, -1)) })}
        >
          − 列
        </Button>
      </Space>
    </div>
  );
}

function Editor({
  blocks,
  onChange,
  onUpload,
}: {
  blocks: Block[];
  onChange: (next: Block[]) => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const update = (index: number, next: Block) =>
    onChange(blocks.map((block, current) => (current === index ? next : block)));
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const source = next[index];
    const destination = next[target];
    if (!source || !destination) return;
    next[index] = destination;
    next[target] = source;
    onChange(next);
  };
  const remove = (index: number) => {
    const next = blocks.filter((_, current) => current !== index);
    onChange(next.length ? next : [newTextBlock()]);
  };
  return (
    <div className="confluence-blocks">
      {blocks.map((block, index) => (
        <div className={`confluence-block confluence-${block.type}`} key={block.id}>
          <div className="confluence-block-check">
            {block.type === 'todo' ? (
              <Checkbox
                aria-label="完成待办"
                checked={Boolean(block.checked)}
                onChange={(event) => update(index, { ...block, checked: event.target.checked })}
              />
            ) : (
              <span>⠿</span>
            )}
          </div>
          <div className="confluence-block-body">
            {isTextBlock(block) ? (
              <div className="confluence-text-editor">
                <Select
                  aria-label="内容类型"
                  value={block.type}
                  options={textBlockTypes.map(([value, label]) => ({ value, label }))}
                  onChange={(value) =>
                    update(index, { ...block, type: textBlockTypeSchema.parse(value) })
                  }
                />
                <Input.TextArea
                  aria-label="页面内容"
                  autoSize={{ minRows: block.type === 'code' ? 4 : 1, maxRows: 20 }}
                  placeholder={index === 0 ? '直接输入页面内容…' : '继续输入…'}
                  value={block.text}
                  onChange={(event) => update(index, { ...block, text: event.target.value })}
                />
              </div>
            ) : block.type === 'table' ? (
              <TableEditor block={block} onChange={(next) => update(index, next)} />
            ) : block.type === 'image' ? (
              <div className="confluence-image-editor">
                <CachedWikiImage id={block.image_id} caption={block.caption} />
                <Input
                  aria-label="图片说明"
                  placeholder="图片说明（可选）"
                  value={block.caption}
                  maxLength={500}
                  onChange={(event) => update(index, { ...block, caption: event.target.value })}
                />
              </div>
            ) : (
              <div className="confluence-link-editor">
                <Input
                  aria-label="链接文字"
                  placeholder="显示文字"
                  value={block.text}
                  maxLength={500}
                  onChange={(event) => update(index, { ...block, text: event.target.value })}
                />
                <Input
                  aria-label="链接地址"
                  placeholder="https://example.com"
                  value={block.url}
                  maxLength={2048}
                  onChange={(event) => update(index, { ...block, url: event.target.value })}
                />
              </div>
            )}
          </div>
          <BlockControls
            index={index}
            count={blocks.length}
            onMove={(offset) => move(index, offset)}
            onRemove={() => remove(index)}
          />
        </div>
      ))}
      <div className="confluence-insert">
        <span>添加：</span>
        <Button size="small" onClick={() => onChange([...blocks, newTextBlock()])}>
          <FontSizeOutlined /> 文字
        </Button>
        <Button size="small" onClick={() => onChange([...blocks, newTableBlock()])}>
          <TableOutlined /> Table
        </Button>
        <Button
          size="small"
          onClick={() =>
            onChange([
              ...blocks,
              { id: crypto.randomUUID(), type: 'link', text: '链接', url: 'https://' },
            ])
          }
        >
          <LinkOutlined /> 链接
        </Button>
        <Upload
          accept="image/png,image/jpeg,image/webp"
          showUploadList={false}
          beforeUpload={(file) => {
            void onUpload(file);
            return false;
          }}
        >
          <Button size="small">
            <PictureOutlined /> 图片
          </Button>
        </Upload>
      </div>
    </div>
  );
}

function Viewer({ blocks }: { blocks: Block[] }) {
  const open = (url: string) =>
    void ipc(window.desktop.openExternal(url), z.null()).catch((error) =>
      message.error(errorText(error)),
    );
  return (
    <article className="confluence-document">
      {blocks.map((block, index) => {
        if (block.type === 'heading1') return <h2 key={block.id}>{block.text}</h2>;
        if (block.type === 'heading2') return <h3 key={block.id}>{block.text}</h3>;
        if (block.type === 'bullet') return <div key={block.id}>• {block.text}</div>;
        if (block.type === 'number')
          return (
            <div key={block.id}>
              {index + 1}. {block.text}
            </div>
          );
        if (block.type === 'quote') return <blockquote key={block.id}>{block.text}</blockquote>;
        if (block.type === 'code') return <pre key={block.id}>{block.text}</pre>;
        if (block.type === 'todo')
          return (
            <Checkbox key={block.id} checked={Boolean(block.checked)} disabled>
              {block.text}
            </Checkbox>
          );
        if (block.type === 'table')
          return (
            <div className="confluence-table-view" key={block.id}>
              <table>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, columnIndex) =>
                        rowIndex === 0 ? (
                          <th key={columnIndex}>{cell}</th>
                        ) : (
                          <td key={columnIndex}>{cell}</td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        if (block.type === 'image')
          return (
            <figure key={block.id}>
              <CachedWikiImage id={block.image_id} caption={block.caption} />
              {block.caption && <figcaption>{block.caption}</figcaption>}
            </figure>
          );
        if (block.type === 'link')
          return (
            <button
              className="confluence-external-link"
              key={block.id}
              onClick={() => open(block.url)}
            >
              {block.text} ↗
            </button>
          );
        return <p key={block.id}>{block.text}</p>;
      })}
    </article>
  );
}

export function Confluence() {
  const [directories, setDirectories] = useState<string[]>([]);
  const [directoryPath, setDirectoryPath] = useState('/');
  const [selectedDirectory, setSelectedDirectory] = useState('/');
  const [newDirectory, setNewDirectory] = useState('');
  const [directoryCreating, setDirectoryCreating] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const loadDirectories = useCallback(async () => {
    const result = await api(
      'GET',
      '/wiki/directories',
      z.object({ items: z.array(z.object({ id: z.string(), path: z.string() })) }),
    );
    setDirectories(result.items.map((item) => item.path));
  }, []);
  useEffect(() => {
    void loadDirectories().catch((error) => message.error(errorText(error)));
  }, [loadDirectories]);
  const createDirectory = async () => {
    if (!newDirectory.trim()) return;
    setFolderBusy(true);
    try {
      const result = await api('POST', '/wiki/directories', z.object({ path: z.string() }), {
        path: newDirectory,
      });
      await loadDirectories();
      setSelectedDirectory(result.path);
      if (editing) {
        setDirectoryPath(result.path);
        setDirty(true);
      }
      setNewDirectory('');
      setDirectoryCreating(false);
      void message.success('目录已创建');
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setFolderBusy(false);
    }
  };
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('📄');
  const [blocks, setBlocks] = useState<PageBlock[]>(richBlocks([]));
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [creating, setCreating] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [returnToId, setReturnToId] = useState<string | null>(null);

  const loadPages = useCallback(
    async (search: string) => {
      const result = await api(
        'GET',
        `/wiki/pages${search.trim() ? `?keyword=${encodeURIComponent(search.trim())}` : ''}`,
        pageListSchema,
      );
      setPages(result.items);
      if (!creating) setSelectedId((current) => current ?? result.items[0]?.id ?? null);
    },
    [creating],
  );

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void loadPages(keyword)
          .catch((error) => message.error(errorText(error)))
          .finally(() => setLoading(false)),
      220,
    );
    return () => window.clearTimeout(timer);
  }, [keyword, loadPages]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    void api('GET', `/wiki/pages/${selectedId}`, pageDetailSchema)
      .then((page) => {
        setDetail(page);
        setTitle(page.title);
        setDirectoryPath(page.directory_path);
        setSelectedDirectory(page.directory_path);
        setIcon(page.icon);
        setBlocks(richBlocks(page.blocks as PageBlock[]));
        setEditing(false);
        setDirty(false);
      })
      .catch((error) => message.error(errorText(error)))
      .finally(() => setLoading(false));
  }, [selectedId]);

  const changeBlocks = (next: PageBlock[]) => {
    setBlocks(next);
    setDirty(true);
  };

  const cancelEdit = () => {
    if (creating) {
      setCreating(false);
      setDirty(false);
      setEditing(false);
      setSelectedId(returnToId ?? pages[0]?.id ?? null);
      return;
    }
    if (!detail) return;
    setTitle(detail.title);
    setDirectoryPath(detail.directory_path);
    setIcon(detail.icon);
    setBlocks(richBlocks(detail.blocks as PageBlock[]));
    setDirty(false);
    setEditing(false);
  };

  const save = async () => {
    if (!detail && !creating) return;
    setSaving(true);
    try {
      const saved = detail
        ? await api('PUT', `/wiki/pages/${detail.id}`, pageDetailSchema, {
            parent_id: detail.parent_id,
            directory_path: directoryPath,
            title: title.trim() || '未命名页面',
            icon: icon.trim() || '📄',
            blocks,
            position: detail.position,
            expected_version: detail.version,
            create_version: true,
          })
        : await api('POST', '/wiki/pages', pageDetailSchema, {
            parent_id: createParentId,
            directory_path: directoryPath,
            title: title.trim() || '未命名页面',
            icon: icon.trim() || '📄',
            blocks,
            position: pages.length,
          });
      setDetail(saved);
      setTitle(saved.title);
      setDirectoryPath(saved.directory_path);
      setIcon(saved.icon);
      setBlocks(richBlocks(saved.blocks as PageBlock[]));
      setDirty(false);
      setEditing(false);
      setCreating(false);
      setSelectedId(saved.id);
      await loadPages(keyword);
      void message.success('页面已保存');
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    try {
      const form = new FormData();
      form.append('file', file);
      const image = await api('POST', '/wiki/images', uploadedImageSchema, form);
      return image.id;
    } catch (error) {
      void message.error(errorText(error));
      return null;
    }
  };

  const openPage = (id: string) => {
    if (id === selectedId && !creating) return;
    if (editing && dirty && !window.confirm('当前修改尚未保存，确定离开？')) return;
    setCreating(false);
    setEditing(false);
    setDirty(false);
    setSelectedId(id);
  };

  const startCreate = (asChild: boolean) => {
    if (dirty && !window.confirm('当前修改尚未保存，确定离开？')) return;
    setReturnToId(selectedId);
    setCreateParentId(asChild ? selectedId : null);
    setDirectoryPath(asChild ? (detail?.directory_path ?? selectedDirectory) : selectedDirectory);
    setSelectedId(null);
    setDetail(null);
    setTitle('');
    setIcon('📄');
    setBlocks(richBlocks([]));
    setCreating(true);
    setEditing(true);
    setDirty(false);
  };

  const loadHistory = async () => {
    if (!detail) return;
    const result = await api('GET', `/wiki/pages/${detail.id}/versions`, versionListSchema);
    setVersions(result.items);
    setHistoryOpen(true);
  };

  const removePage = () => {
    if (!detail) return;
    Modal.confirm({
      title: `删除“${detail.title}”？`,
      content: '有子页面时不能删除。删除后不会出现在目录中。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await api('DELETE', `/wiki/pages/${detail.id}`, z.null());
        setSelectedId(null);
        setDetail(null);
        await loadPages(keyword);
        void message.success('页面已删除');
      },
    });
  };

  const nodes = useMemo(() => {
    const paths = [...new Set(['/', ...directories, ...pages.map((page) => page.directory_path)])];
    const build = (path: string): TreeDataNode => ({
      key: `directory:${path}`,
      title: `📁 ${path === '/' ? '文档（根目录）' : path.split('/').at(-1)}`,
      children: [
        ...paths
          .filter(
            (other) => other !== '/' && (other.slice(0, other.lastIndexOf('/')) || '/') === path,
          )
          .map(build),
        ...treeNodes(
          pages.filter((page) => page.directory_path === path),
          keyword.trim(),
        ),
      ],
    });
    return [build('/')];
  }, [keyword, pages, directories]);
  const documentBlock = richBlocks(blocks)[0];
  const documentContent = documentBlock?.doc ?? emptyWikiDocument();
  const changeDocument = (doc: JSONContent) =>
    changeBlocks([
      {
        id: documentBlock?.id ?? crypto.randomUUID(),
        type: 'richtext',
        doc,
      },
    ]);
  const openExternal = (url: string) =>
    void ipc(window.desktop.openExternal(url), z.null()).catch((error) =>
      message.error(errorText(error)),
    );
  return (
    <section className="confluence-page">
      <div className="confluence-heading">
        <div className="confluence-heading-title">
          <h1>Confluence</h1>
          <span>团队文档</span>
        </div>
        <Space>
          <Button onClick={() => void loadHistory()} disabled={!detail}>
            历史版本
          </Button>
          {editing ? (
            <>
              <Button onClick={cancelEdit}>取消</Button>
              <Button type="primary" loading={saving} onClick={() => void save()}>
                保存
              </Button>
            </>
          ) : (
            <Button
              icon={<EditOutlined />}
              type="primary"
              disabled={!detail || creating}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          )}
        </Space>
      </div>
      <div className="confluence-layout">
        <Card className="confluence-sidebar" styles={{ body: { padding: 12 } }}>
          <Input.Search
            allowClear
            placeholder="搜索页面"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Space className="confluence-create-actions">
            <Button icon={<PlusOutlined />} type="primary" onClick={() => startCreate(false)}>
              页面
            </Button>
            <Button icon={<FileAddOutlined />} disabled={!detail} onClick={() => startCreate(true)}>
              子页
            </Button>
            <Button onClick={() => setDirectoryCreating((value) => !value)}>目录</Button>
          </Space>
          {directoryCreating && (
            <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
              <Input
                aria-label="新目录路径"
                placeholder="如：操作流程/生产"
                value={newDirectory}
                onChange={(event) => setNewDirectory(event.target.value)}
                onPressEnter={() => void createDirectory()}
              />
              <Button loading={folderBusy} onClick={() => void createDirectory()}>
                创建
              </Button>
            </Space.Compact>
          )}
          <Typography.Text type="secondary">
            当前目录：{selectedDirectory === '/' ? '未分类' : selectedDirectory}
          </Typography.Text>
          {nodes.length ? (
            <Tree
              blockNode
              defaultExpandAll
              selectedKeys={selectedId ? [selectedId] : [`directory:${selectedDirectory}`]}
              treeData={nodes}
              onSelect={(keys) => {
                const id = keys[0];
                if (typeof id === 'string') {
                  if (id.startsWith('directory:')) setSelectedDirectory(id.slice(10));
                  else openPage(id);
                }
              }}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有页面" />
          )}
        </Card>
        <Card className="confluence-editor" styles={{ body: { padding: 26 } }}>
          {loading ? (
            <div className="confluence-loading">
              <Spin />
            </div>
          ) : detail || creating ? (
            <>
              {editing ? (
                <>
                  <div className="confluence-meta">
                    <Input
                      aria-label="页面图标"
                      className="confluence-icon-input"
                      value={icon}
                      maxLength={16}
                      onChange={(event) => {
                        setIcon(event.target.value);
                        setDirty(true);
                      }}
                    />
                    <Input
                      aria-label="页面标题"
                      className="confluence-title-input"
                      placeholder="页面标题"
                      autoFocus={creating}
                      value={title}
                      maxLength={200}
                      onChange={(event) => {
                        setTitle(event.target.value);
                        setDirty(true);
                      }}
                    />
                  </div>
                  <div className="confluence-directory-field">
                    <label htmlFor="wiki-directory">保存目录</label>
                    <Select
                      id="wiki-directory"
                      aria-label="保存目录"
                      showSearch
                      optionFilterProp="label"
                      value={directoryPath}
                      options={[...new Set(['/', ...directories, directoryPath])].map((path) => ({
                        value: path,
                        label: path === '/' ? '未分类（/）' : path,
                      }))}
                      onChange={(path) => {
                        setDirectoryPath(path);
                        setDirty(true);
                      }}
                    />
                    <Button type="text" onClick={() => setDirectoryCreating(true)}>
                      新建目录
                    </Button>
                  </div>
                  <div className="confluence-save-state">
                    {creating ? '新页面 · 保存后加入左侧目录' : '编辑模式 · 保存后生成新版本'}
                  </div>
                  <VoiceDocument
                    key={detail?.id ?? 'new'}
                    onInsert={(draft) => {
                      if (!title.trim()) setTitle(draft.title);
                      const additions: JSONContent[] = draft.sections.flatMap((section) => [
                        ...(section.heading
                          ? [
                              {
                                type: 'heading',
                                attrs: { level: 2 },
                                content: [{ type: 'text', text: section.heading }],
                              },
                            ]
                          : []),
                        ...section.text
                          .split('\n')
                          .map((text) => ({
                            type: 'paragraph',
                            ...(text ? { content: [{ type: 'text', text }] } : {}),
                          })),
                      ]);
                      changeDocument({
                        type: 'doc',
                        content: [...(documentContent.content ?? []), ...additions],
                      });
                    }}
                  />
                  <RichWikiEditor
                    key={`${detail?.id ?? 'new'}:edit`}
                    content={documentContent}
                    editable
                    onChange={changeDocument}
                    onUpload={uploadImage}
                    openExternal={openExternal}
                  />
                  {detail && (
                    <div className="confluence-danger">
                      <Button danger onClick={removePage}>
                        删除页面
                      </Button>
                    </div>
                  )}
                </>
              ) : detail ? (
                <>
                  <div className="confluence-view-title">
                    <span>{detail.icon}</span>
                    <h2>{detail.title}</h2>
                  </div>
                  <div className="confluence-directory-path">
                    目录：{detail.directory_path === '/' ? '未分类（/）' : detail.directory_path}
                  </div>
                  <div className="confluence-view-meta">
                    v{detail.version} · {detail.updated_by_name || '系统'} ·{' '}
                    {displayTime(detail.updated_at)}
                  </div>
                  <RichWikiEditor
                    key={`${detail.id}:read:${detail.version}`}
                    content={documentContent}
                    editable={false}
                    onUpload={uploadImage}
                    openExternal={openExternal}
                  />
                </>
              ) : null}
            </>
          ) : (
            <Empty description="新建一个页面开始记录" />
          )}
        </Card>
      </div>
      <Drawer title="历史版本" width={420} open={historyOpen} onClose={() => setHistoryOpen(false)}>
        {versions.length ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {versions.map((version) => (
              <Card size="small" key={version.id}>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Typography.Text strong>
                    v{version.version} · {version.icon} {version.title}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {displayTime(version.created_at)} · {version.created_by_name || '系统'}
                  </Typography.Text>
                  <Button
                    size="small"
                    onClick={() => {
                      if (!detail) return;
                      void api(
                        'POST',
                        `/wiki/pages/${detail.id}/versions/${version.id}/restore`,
                        pageDetailSchema,
                      )
                        .then((restored) => {
                          setDetail(restored);
                          setTitle(restored.title);
                          setIcon(restored.icon);
                          setBlocks(richBlocks(restored.blocks as PageBlock[]));
                          setDirty(false);
                          setEditing(false);
                          setHistoryOpen(false);
                          void message.success('历史版本已恢复');
                        })
                        .catch((error) => message.error(errorText(error)));
                    }}
                  >
                    恢复此版本
                  </Button>
                </Space>
              </Card>
            ))}
          </Space>
        ) : (
          <Empty description="暂无历史版本" />
        )}
      </Drawer>
    </section>
  );
}
