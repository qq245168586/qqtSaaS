import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { z } from "zod";
import { enterWiki, errorMessage, request, upload } from "../src/api";
import { useAppStore } from "../src/use-app-store";
import { RichWikiEditor, emptyWikiDocument } from "./RichWikiEditor";

const blockTypes = [
  ["paragraph", "正文"],
  ["heading1", "大标题"],
  ["heading2", "小标题"],
  ["bullet", "项目符号"],
  ["number", "编号列表"],
  ["quote", "引用"],
  ["code", "代码"],
  ["todo", "待办"],
] as const;
const blockTypeSchema = z.enum(blockTypes.map(([value]) => value));
type BlockType = z.infer<typeof blockTypeSchema>;
const textBlockSchema = z.object({
  id: z.string(),
  type: blockTypeSchema,
  text: z.string(),
  checked: z.boolean().optional(),
});
type TextBlock = z.infer<typeof textBlockSchema>;
const tableBlockSchema = z.object({
  id: z.string(),
  type: z.literal("table"),
  rows: z.array(z.array(z.string())),
});
const imageBlockSchema = z.object({
  id: z.string(),
  type: z.literal("image"),
  image_id: z.string(),
  caption: z.string(),
});
const linkBlockSchema = z.object({
  id: z.string(),
  type: z.literal("link"),
  text: z.string(),
  url: z.string(),
});
const blockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  tableBlockSchema,
  imageBlockSchema,
  linkBlockSchema,
]);
type Block = z.infer<typeof blockSchema>;
const richTextBlockSchema = z.object({
  id: z.string(),
  type: z.literal("richtext"),
  doc: z.record(z.string(), z.unknown()),
});
type RichTextBlock = z.infer<typeof richTextBlockSchema> & {
  doc: JSONContent;
};
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
const pageDetailSchema = pageSummarySchema.extend({
  blocks: z.array(pageBlockSchema),
});
type PageDetail = z.infer<typeof pageDetailSchema>;
const pageListSchema = z.object({
  items: z.array(pageSummarySchema),
  total: z.number(),
});
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
const versionListSchema = z.object({
  items: z.array(versionSchema),
  total: z.number(),
});
const uploadedImageSchema = z.object({
  id: z.string(),
  file_name: z.string(),
  url: z.string().url(),
});

function isTextBlock(block: Block): block is TextBlock {
  return blockTypeSchema.safeParse(block.type).success;
}

function uid() {
  return crypto.randomUUID();
}

function emptyBlock(type: BlockType = "paragraph"): Block {
  return {
    id: uid(),
    type,
    text: "",
    ...(type === "todo" ? { checked: false } : {}),
  };
}

function textContent(text: string): JSONContent[] | undefined {
  return text ? [{ type: "text", text }] : undefined;
}

function legacyNode(block: Block): JSONContent {
  if (block.type === "heading1" || block.type === "heading2")
    return {
      type: "heading",
      attrs: { level: block.type === "heading1" ? 1 : 2 },
      content: textContent(block.text),
    };
  if (block.type === "bullet" || block.type === "number")
    return {
      type: block.type === "bullet" ? "bulletList" : "orderedList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: textContent(block.text) }],
        },
      ],
    };
  if (block.type === "quote")
    return {
      type: "blockquote",
      content: [{ type: "paragraph", content: textContent(block.text) }],
    };
  if (block.type === "code")
    return { type: "codeBlock", content: textContent(block.text) };
  if (block.type === "todo")
    return {
      type: "paragraph",
      content: textContent(`${block.checked ? "☑" : "☐"} ${block.text}`),
    };
  if (block.type === "table")
    return {
      type: "table",
      content: block.rows.map((row, rowIndex) => ({
        type: "tableRow",
        content: row.map((cell) => ({
          type: rowIndex === 0 ? "tableHeader" : "tableCell",
          attrs: { colspan: 1, rowspan: 1, colwidth: null },
          content: [{ type: "paragraph", content: textContent(cell) }],
        })),
      })),
    };
  if (block.type === "image")
    return {
      type: "image",
      attrs: {
        image_id: block.image_id,
        alt: block.caption,
        title: null,
        caption: block.caption,
      },
    };
  if (block.type === "link")
    return {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: block.text,
          marks: [
            {
              type: "link",
              attrs: {
                href: block.url,
                target: "_blank",
                rel: "noopener noreferrer nofollow",
                class: null,
              },
            },
          ],
        },
      ],
    };
  return { type: "paragraph", content: textContent(block.text) };
}

function richBlocks(blocks: PageBlock[]): RichTextBlock[] {
  if (blocks.length === 1 && blocks[0]?.type === "richtext") return [blocks[0]];
  return [
    {
      id: uid(),
      type: "richtext",
      doc: {
        type: "doc",
        content: blocks.length
          ? blocks.map((block) => legacyNode(block as Block))
          : emptyWikiDocument().content,
      },
    },
  ];
}

function timeLabel(value: string) {
  const normalized = value.includes("T")
    ? value
    : value.replace(" ", "T") + "+08:00";
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
}

function PageTree({
  pages,
  selectedId,
  keyword,
  onSelect,
}: {
  pages: PageSummary[];
  selectedId: string | null;
  keyword: string;
  onSelect: (id: string) => void;
}) {
  const children = useMemo(() => {
    const groups = new Map<string | null, PageSummary[]>();
    for (const page of pages) {
      const key =
        keyword || !pages.some((candidate) => candidate.id === page.parent_id)
          ? null
          : page.parent_id;
      groups.set(key, [...(groups.get(key) ?? []), page]);
    }
    return groups;
  }, [keyword, pages]);
  const render = (parentId: string | null, depth: number): React.ReactNode =>
    (children.get(parentId) ?? []).map((page) => (
      <div key={page.id}>
        <button
          className={`tree-page ${selectedId === page.id ? "active" : ""}`}
          style={{ paddingLeft: 14 + depth * 18 }}
          onClick={() => onSelect(page.id)}
        >
          <span>{page.icon}</span>
          <span>{page.title}</span>
        </button>
        {!keyword && render(page.id, depth + 1)}
      </div>
    ));
  return <div className="page-tree">{render(null, 0)}</div>;
}

export function BlockEditor({
  blocks,
  imageUrls,
  onChange,
  onUpload,
}: {
  blocks: Block[];
  imageUrls: Record<string, string>;
  onChange: (blocks: Block[]) => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const update = (index: number, next: Block) =>
    onChange(
      blocks.map((block, current) => (current === index ? next : block)),
    );
  const add = (type: BlockType) => onChange([...blocks, emptyBlock(type)]);
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const current = next[index];
    const other = next[target];
    if (!current || !other) return;
    next[index] = other;
    next[target] = current;
    onChange(next);
  };
  const remove = (index: number) => {
    const next = blocks.filter((_, current) => current !== index);
    onChange(next.length ? next : [emptyBlock()]);
  };
  return (
    <>
      <div className="block-list">
        {blocks.map((block, index) => (
          <div className={`editor-block block-${block.type}`} key={block.id}>
            <div className="block-gutter">
              {block.type === "todo" ? (
                <input
                  aria-label="完成待办"
                  type="checkbox"
                  checked={Boolean(block.checked)}
                  onChange={(event) =>
                    update(index, { ...block, checked: event.target.checked })
                  }
                />
              ) : (
                <span className="drag-dot">⠿</span>
              )}
            </div>
            <div className="block-main">
              {isTextBlock(block) ? (
                <>
                  <select
                    aria-label="内容类型"
                    value={block.type}
                    onChange={(event) =>
                      update(index, {
                        ...block,
                        type: blockTypeSchema.parse(event.target.value),
                      })
                    }
                  >
                    {blockTypes.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    aria-label="页面内容"
                    rows={block.type === "code" ? 5 : 2}
                    placeholder={
                      index === 0 ? "直接输入页面内容…" : "继续输入…"
                    }
                    value={block.text}
                    onChange={(event) =>
                      update(index, { ...block, text: event.target.value })
                    }
                  />
                </>
              ) : block.type === "table" ? (
                <div className="table-editor">
                  <table>
                    <tbody>
                      {block.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((cell, columnIndex) => (
                            <td key={columnIndex}>
                              <input
                                value={cell}
                                onChange={(event) =>
                                  update(index, {
                                    ...block,
                                    rows: block.rows.map((cells, currentRow) =>
                                      currentRow === rowIndex
                                        ? cells.map((value, currentColumn) =>
                                            currentColumn === columnIndex
                                              ? event.target.value
                                              : value,
                                          )
                                        : cells,
                                    ),
                                  })
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="table-tools">
                    <button
                      onClick={() =>
                        update(index, {
                          ...block,
                          rows: [
                            ...block.rows,
                            Array(block.rows[0]?.length ?? 1).fill(""),
                          ],
                        })
                      }
                    >
                      + 行
                    </button>
                    <button
                      onClick={() =>
                        update(index, {
                          ...block,
                          rows: block.rows.map((row) => [...row, ""]),
                        })
                      }
                    >
                      + 列
                    </button>
                  </div>
                </div>
              ) : block.type === "image" ? (
                <div className="image-editor">
                  {imageUrls[block.image_id] && (
                    <img
                      src={imageUrls[block.image_id]}
                      alt={block.caption || "页面图片"}
                    />
                  )}
                  <input
                    placeholder="图片说明（可选）"
                    value={block.caption}
                    onChange={(event) =>
                      update(index, { ...block, caption: event.target.value })
                    }
                  />
                </div>
              ) : (
                <div className="link-editor">
                  <input
                    placeholder="显示文字"
                    value={block.text}
                    onChange={(event) =>
                      update(index, { ...block, text: event.target.value })
                    }
                  />
                  <input
                    placeholder="https://example.com"
                    value={block.url}
                    onChange={(event) =>
                      update(index, { ...block, url: event.target.value })
                    }
                  />
                </div>
              )}
            </div>
            <div className="block-actions">
              <button
                title="上移"
                onClick={() => move(index, -1)}
                disabled={index === 0}
              >
                ↑
              </button>
              <button
                title="下移"
                onClick={() => move(index, 1)}
                disabled={index === blocks.length - 1}
              >
                ↓
              </button>
              <button title="删除内容块" onClick={() => remove(index)}>
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="insert-bar">
        <span>添加</span>
        {blockTypes.map(([type, label]) => (
          <button key={type} onClick={() => add(type)}>
            {label}
          </button>
        ))}
        <button
          onClick={() =>
            onChange([
              ...blocks,
              {
                id: uid(),
                type: "table",
                rows: [
                  ["列 1", "列 2"],
                  ["", ""],
                ],
              },
            ])
          }
        >
          Table
        </button>
        <button
          onClick={() =>
            onChange([
              ...blocks,
              { id: uid(), type: "link", text: "链接", url: "https://" },
            ])
          }
        >
          链接
        </button>
        <label className="upload-button">
          上传图片
          <input
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onUpload(file);
              event.target.value = "";
            }}
          />
        </label>
      </div>
    </>
  );
}

export function BlockViewer({
  blocks,
  imageUrls,
}: {
  blocks: Block[];
  imageUrls: Record<string, string>;
}) {
  return (
    <div className="document-view">
      {blocks.map((block, index) => {
        if (block.type === "heading1")
          return <h2 key={block.id}>{block.text}</h2>;
        if (block.type === "heading2")
          return <h3 key={block.id}>{block.text}</h3>;
        if (block.type === "bullet")
          return <div key={block.id}>• {block.text}</div>;
        if (block.type === "number")
          return (
            <div key={block.id}>
              {index + 1}. {block.text}
            </div>
          );
        if (block.type === "quote")
          return <blockquote key={block.id}>{block.text}</blockquote>;
        if (block.type === "code")
          return <pre key={block.id}>{block.text}</pre>;
        if (block.type === "todo")
          return (
            <label key={block.id}>
              <input
                type="checkbox"
                checked={Boolean(block.checked)}
                readOnly
              />{" "}
              {block.text}
            </label>
          );
        if (block.type === "table")
          return (
            <div className="table-view" key={block.id}>
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
        if (block.type === "image")
          return (
            <figure key={block.id}>
              {imageUrls[block.image_id] && (
                <img
                  src={imageUrls[block.image_id]}
                  alt={block.caption || "页面图片"}
                />
              )}
              {block.caption && <figcaption>{block.caption}</figcaption>}
            </figure>
          );
        if (block.type === "link")
          return (
            <a
              key={block.id}
              href={block.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {block.text} ↗
            </a>
          );
        return <p key={block.id}>{block.text}</p>;
      })}
    </div>
  );
}

export function WikiApp() {
  const { user } = useAppStore();
  const [booted, setBooted] = useState(false);
  const [directories, setDirectories] = useState<string[]>([]);
  const [directoryPath, setDirectoryPath] = useState("/");
  const [selectedDirectory, setSelectedDirectory] = useState("/");
  const [newDirectory, setNewDirectory] = useState("");
  const [directoryCreating, setDirectoryCreating] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const loadDirectories = useCallback(async () => {
    const result = await request(
      "/wiki/directories",
      z.object({
        items: z.array(z.object({ id: z.string(), path: z.string() })),
      }),
    );
    setDirectories(result.items.map((item) => item.path));
  }, []);
  useEffect(() => {
    if (user)
      void loadDirectories().catch((error) => setStatus(errorMessage(error)));
  }, [user, loadDirectories]);
  const createDirectory = async () => {
    if (!newDirectory.trim()) return;
    setFolderBusy(true);
    try {
      const result = await request(
        "/wiki/directories",
        z.object({ path: z.string() }),
        "POST",
        { path: newDirectory },
      );
      await loadDirectories();
      setSelectedDirectory(result.path);
      if (editing) {
        setDirectoryPath(result.path);
        setDirty(true);
      }
      setNewDirectory("");
      setDirectoryCreating(false);
      setStatus("目录已创建");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setFolderBusy(false);
    }
  };
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [keyword, setKeyword] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("📄");
  const [blocks, setBlocks] = useState<PageBlock[]>(richBlocks([]));
  const [editing, setEditing] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("已保存");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [creating, setCreating] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [returnToId, setReturnToId] = useState<string | null>(null);
  const directoryPaths = [
    ...new Set([
      "/",
      ...directories,
      ...pages.map((page) => page.directory_path),
    ]),
  ].sort();
  const directoryTree = (path: string): React.ReactNode => (
    <details key={path} open className="directory-group">
      <summary onClick={() => setSelectedDirectory(path)}>
        📁 {path === "/" ? "文档（根目录）" : path.split("/").at(-1)}
      </summary>
      <div className="directory-children">
        {directoryPaths
          .filter(
            (other) =>
              other !== "/" &&
              (other.slice(0, other.lastIndexOf("/")) || "/") === path,
          )
          .map(directoryTree)}
        <PageTree
          pages={pages.filter((page) => page.directory_path === path)}
          selectedId={selectedId}
          keyword={keyword}
          onSelect={openPage}
        />
      </div>
    </details>
  );
  const currentRef = useRef({ title, icon, blocks, directoryPath });
  const versionRef = useRef(1);
  const saveChain = useRef(Promise.resolve());
  currentRef.current = { title, icon, blocks, directoryPath };

  useEffect(() => {
    void enterWiki()
      .then(() => setBooted(true))
      .catch((error) => {
        setStatus(errorMessage(error));
        setBooted(true);
      });
  }, []);

  const loadPages = useCallback(
    async (search = keyword) => {
      const result = await request(
        `/wiki/pages${search.trim() ? `?keyword=${encodeURIComponent(search.trim())}` : ""}`,
        pageListSchema,
      );
      setPages(result.items);
      if (!creating)
        setSelectedId((current) => current ?? result.items[0]?.id ?? null);
    },
    [creating, keyword],
  );

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(
      () => void loadPages().catch((error) => setStatus(errorMessage(error))),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [keyword, loadPages, user]);

  useEffect(() => {
    if (!selectedId || !user) return;
    void request(`/wiki/pages/${selectedId}`, pageDetailSchema)
      .then((page) => {
        setDetail(page);
        setTitle(page.title);
        setDirectoryPath(page.directory_path);
        setSelectedDirectory(page.directory_path);
        setIcon(page.icon);
        setBlocks(richBlocks(page.blocks as PageBlock[]));
        setEditing(false);
        versionRef.current = page.version;
        setDirty(false);
        setStatus("已保存");
      })
      .catch((error) => setStatus(errorMessage(error)));
  }, [selectedId, user]);

  const markChanged = (change: () => void) => {
    change();
    setDirty(true);
    setStatus("等待保存");
  };

  const queueSave = useCallback(
    (createVersion: boolean) => {
      if (!detail && !creating) return Promise.resolve();
      const pageId = detail?.id ?? null;
      const snapshot = currentRef.current;
      const signature = JSON.stringify(snapshot);
      setSaving(true);
      setStatus(createVersion ? "正在保存版本…" : "正在保存…");
      const operation = saveChain.current.then(async () => {
        const result = pageId
          ? await request(`/wiki/pages/${pageId}`, pageDetailSchema, "PUT", {
              parent_id: detail?.parent_id ?? null,
              directory_path: snapshot.directoryPath,
              title: snapshot.title.trim() || "未命名页面",
              icon: snapshot.icon.trim() || "📄",
              blocks: snapshot.blocks,
              position: detail?.position ?? pages.length,
              expected_version: versionRef.current,
              create_version: createVersion,
            })
          : await request("/wiki/pages", pageDetailSchema, "POST", {
              parent_id: createParentId,
              directory_path: snapshot.directoryPath,
              title: snapshot.title.trim() || "未命名页面",
              icon: snapshot.icon.trim() || "📄",
              blocks: snapshot.blocks,
              position: pages.length,
            });
        versionRef.current = result.version;
        setPages((current) =>
          current.map((page) =>
            page.id === pageId ? { ...page, ...result } : page,
          ),
        );
        if (pageId === null || selectedId === pageId) {
          setDetail(result);
          if (JSON.stringify(currentRef.current) === signature) {
            setDirty(false);
            setStatus(`版本 ${result.version} 已保存`);
            setEditing(false);
            setCreating(false);
            setSelectedId(result.id);
            void loadPages("");
          }
        }
      });
      saveChain.current = operation.catch(() => undefined);
      return operation
        .catch((error) => setStatus(errorMessage(error)))
        .finally(() => setSaving(false));
    },
    [createParentId, creating, detail, loadPages, pages.length, selectedId],
  );

  const cancelEditing = () => {
    if (creating) {
      setCreating(false);
      setEditing(false);
      setDirty(false);
      setStatus("已取消新建");
      setSelectedId(returnToId ?? pages[0]?.id ?? null);
      return;
    }
    if (!detail) return;
    setTitle(detail.title);
    setDirectoryPath(detail.directory_path);
    setIcon(detail.icon);
    setBlocks(richBlocks(detail.blocks as PageBlock[]));
    setDirty(false);
    setStatus("已取消修改");
    setEditing(false);
  };

  const startCreate = (asChild: boolean) => {
    if (dirty && !window.confirm("当前修改尚未保存，确定离开？")) return;
    setReturnToId(selectedId);
    setCreateParentId(asChild ? selectedId : null);
    setDirectoryPath(
      asChild
        ? (detail?.directory_path ?? selectedDirectory)
        : selectedDirectory,
    );
    setSelectedId(null);
    setDetail(null);
    setTitle("");
    setIcon("📄");
    setBlocks(richBlocks([]));
    setCreating(true);
    setEditing(true);
    setDirty(false);
    setStatus(asChild ? "正在新建子页面" : "正在新建页面");
  };

  const openPage = (id: string) => {
    if (id === selectedId && !creating) return;
    if (dirty && !window.confirm("当前修改尚未保存，确定离开？")) return;
    setCreating(false);
    setEditing(false);
    setDirty(false);
    setSelectedId(id);
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    try {
      const form = new FormData();
      form.append("file", file);
      setStatus("正在上传图片…");
      const image = await upload("/wiki/images", uploadedImageSchema, form);
      setImageUrls((current) => ({ ...current, [image.id]: image.url }));
      setStatus("图片已插入，等待保存");
      return image.id;
    } catch (error) {
      setStatus(errorMessage(error));
      return null;
    }
  };

  const openHistory = async () => {
    if (!detail) return;
    const result = await request(
      `/wiki/pages/${detail.id}/versions`,
      versionListSchema,
    );
    setVersions(result.items);
    setHistoryOpen(true);
  };

  const restore = async (versionId: string) => {
    if (!detail || !window.confirm("恢复后会生成一个新的版本，确定继续吗？"))
      return;
    const page = await request(
      `/wiki/pages/${detail.id}/versions/${versionId}/restore`,
      pageDetailSchema,
      "POST",
      {},
    );
    setDetail(page);
    setTitle(page.title);
    setIcon(page.icon);
    setBlocks(richBlocks(page.blocks as PageBlock[]));
    versionRef.current = page.version;
    setDirty(false);
    setStatus(`已恢复为版本 ${page.version}`);
    setHistoryOpen(false);
    await loadPages();
  };

  const removePage = async () => {
    if (!detail || !window.confirm(`确定删除“${detail.title}”吗？`)) return;
    await request(`/wiki/pages/${detail.id}`, z.null(), "DELETE");
    setSelectedId(null);
    setDetail(null);
    await loadPages();
  };

  const documentBlock = richBlocks(blocks)[0];
  const documentContent = documentBlock?.doc ?? emptyWikiDocument();
  const changeDocument = (doc: JSONContent) =>
    markChanged(() =>
      setBlocks([
        {
          id: documentBlock?.id ?? uid(),
          type: "richtext",
          doc,
        },
      ]),
    );
  const resolveImage = useCallback(
    async (id: string) => {
      const cached = imageUrls[id];
      if (cached) return cached;
      const image = await request(`/wiki/images/${id}`, uploadedImageSchema);
      setImageUrls((current) => ({ ...current, [id]: image.url }));
      return image.url;
    },
    [imageUrls],
  );

  if (!booted) return <div className="boot-screen">正在打开知识库…</div>;
  if (!user) return <div className="boot-screen">{status}</div>;

  return (
    <div className="wiki-shell">
      <header className="topbar">
        <div className="top-brand">
          <span>趣</span>
          <strong>Confluence</strong>
        </div>
        <div className="top-actions">
          <span className={`save-state ${dirty ? "pending" : ""}`}>
            {saving ? "保存中…" : status}
          </span>
          <button onClick={() => void openHistory()} disabled={!detail}>
            历史版本
          </button>
          {editing ? (
            <>
              <button onClick={cancelEditing} disabled={saving}>
                取消
              </button>
              <button
                className="primary"
                onClick={() => void queueSave(true)}
                disabled={(!detail && !creating) || saving}
              >
                保存
              </button>
            </>
          ) : (
            <button
              className="primary"
              onClick={() => setEditing(true)}
              disabled={!detail || creating}
            >
              Edit
            </button>
          )}
        </div>
      </header>
      <div className={`wiki-workspace ${historyOpen ? "with-history" : ""}`}>
        <aside className="sidebar">
          <div className="sidebar-head">
            <p className="eyebrow">SPACE</p>
            <h2>天美意 · 趣趣特</h2>
          </div>
          <input
            className="search"
            type="search"
            placeholder="搜索标题和正文"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <div className="sidebar-buttons">
            <button className="primary" onClick={() => startCreate(false)}>
              ＋ 页面
            </button>
            <button onClick={() => startCreate(true)} disabled={!detail}>
              ＋ 子页
            </button>
            <button onClick={() => setDirectoryCreating((value) => !value)}>
              ＋ 目录
            </button>
          </div>
          {directoryCreating && (
            <div className="directory-create">
              <input
                aria-label="新目录路径"
                placeholder="如：操作流程/生产"
                value={newDirectory}
                onChange={(event) => setNewDirectory(event.target.value)}
              />
              <button
                disabled={folderBusy}
                onClick={() => void createDirectory()}
              >
                创建
              </button>
            </div>
          )}
          <p className="directory-current">
            当前目录：{selectedDirectory === "/" ? "未分类" : selectedDirectory}
          </p>
          {directoryTree("/")}
          {!pages.length && (
            <p className="sidebar-empty">还没有页面，先新建一页。</p>
          )}
        </aside>

        <main className="editor-canvas">
          {detail || creating ? (
            <article className="page-editor">
              <div className="page-meta">
                {editing ? (
                  <input
                    className="icon-input"
                    aria-label="页面图标"
                    maxLength={8}
                    value={icon}
                    onChange={(event) =>
                      markChanged(() => setIcon(event.target.value))
                    }
                  />
                ) : (
                  <span className="page-icon">{icon}</span>
                )}
                <span>
                  {creating
                    ? "新页面 · 保存后加入左侧目录"
                    : `最后更新 ${timeLabel(detail?.updated_at ?? "")} · v${versionRef.current}`}
                </span>
                {editing && detail && (
                  <button
                    className="danger-link"
                    onClick={() => void removePage()}
                  >
                    删除页面
                  </button>
                )}
              </div>
              {editing ? (
                <>
                  <input
                    className="title-input"
                    aria-label="页面标题"
                    placeholder="页面标题"
                    autoFocus={creating}
                    value={title}
                    maxLength={200}
                    onChange={(event) =>
                      markChanged(() => setTitle(event.target.value))
                    }
                  />
                  <div className="directory-field">
                    <label htmlFor="wiki-directory">保存目录</label>
                    <select
                      id="wiki-directory"
                      aria-label="保存目录"
                      value={directoryPath}
                      onChange={(event) =>
                        markChanged(() => setDirectoryPath(event.target.value))
                      }
                    >
                      {[...new Set(["/", ...directories, directoryPath])].map(
                        (path) => (
                          <option key={path} value={path}>
                            {path === "/" ? "未分类（/）" : path}
                          </option>
                        ),
                      )}
                    </select>
                    <button onClick={() => setDirectoryCreating(true)}>
                      新建目录
                    </button>
                  </div>
                  <RichWikiEditor
                    key={`${detail?.id ?? "new"}:edit`}
                    content={documentContent}
                    editable
                    onChange={changeDocument}
                    onUpload={uploadImage}
                    resolveImage={resolveImage}
                  />
                </>
              ) : (
                <>
                  <h1 className="page-view-title">{title}</h1>
                  <p className="directory-current">
                    目录：
                    {detail?.directory_path === "/"
                      ? "未分类（/）"
                      : detail?.directory_path}
                  </p>
                  <RichWikiEditor
                    key={`${detail?.id ?? "page"}:read:${detail?.version ?? 1}`}
                    content={documentContent}
                    editable={false}
                    onUpload={uploadImage}
                    resolveImage={resolveImage}
                  />
                </>
              )}
            </article>
          ) : (
            <div className="welcome-panel">
              <div className="welcome-icon">✦</div>
              <h1>从一页开始沉淀团队知识</h1>
              <p>
                左侧创建页面，可以继续添加子页面、搜索正文，并随时保留历史版本。
              </p>
              <button className="primary" onClick={() => startCreate(false)}>
                新建第一个页面
              </button>
            </div>
          )}
        </main>

        {historyOpen && (
          <aside className="history-panel">
            <div className="history-head">
              <h3>历史版本</h3>
              <button onClick={() => setHistoryOpen(false)}>×</button>
            </div>
            <p>每次点击“保存”都会留下一个可恢复的版本。</p>
            {versions.map((version) => (
              <div className="version-card" key={version.id}>
                <strong>版本 {version.version}</strong>
                <span>
                  {version.created_by_name || "管理员"} ·{" "}
                  {timeLabel(version.created_at)}
                </span>
                <small>
                  {version.icon} {version.title}
                </small>
                <button onClick={() => void restore(version.id)}>
                  恢复此版本
                </button>
              </div>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
