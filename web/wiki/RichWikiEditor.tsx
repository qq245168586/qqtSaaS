import { useEffect, useRef, useState } from "react";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import type { JSONContent } from "@tiptap/core";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

export const emptyWikiDocument = (): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});

function RemoteImage({
  id,
  alt,
  resolveImage,
}: {
  id: string;
  alt: string;
  resolveImage: (id: string) => Promise<string>;
}) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void resolveImage(id)
      .then((url) => {
        if (active) setSource(url);
      })
      .catch(() => setFailed(true));
    return () => {
      active = false;
    };
  }, [id, resolveImage]);
  if (failed)
    return <span className="wiki-rich-image-error">图片加载失败</span>;
  if (!source)
    return <span className="wiki-rich-image-loading">图片加载中…</span>;
  return <img src={source} alt={alt} />;
}

function imageExtension(resolveImage: (id: string) => Promise<string>) {
  const WikiImageNode = ({ node, updateAttributes, editor }: NodeViewProps) => {
    const imageId = String(node.attrs.image_id ?? "");
    const caption = String(node.attrs.caption ?? "");
    const alt = String(node.attrs.alt ?? caption ?? "页面图片");
    return (
      <NodeViewWrapper className="wiki-rich-image" data-drag-handle>
        <RemoteImage id={imageId} alt={alt} resolveImage={resolveImage} />
        {editor.isEditable ? (
          <input
            value={caption}
            placeholder="图片说明（可选）"
            maxLength={500}
            onChange={(event) =>
              updateAttributes({ caption: event.target.value })
            }
          />
        ) : (
          caption && <figcaption>{caption}</figcaption>
        )}
      </NodeViewWrapper>
    );
  };
  return Image.extend({
    addAttributes() {
      return {
        image_id: { default: null },
        alt: { default: "" },
        title: { default: null },
        caption: { default: "" },
      };
    },
    addNodeView() {
      return ReactNodeViewRenderer(WikiImageNode);
    },
  });
}

export function RichWikiEditor({
  content,
  editable,
  onChange,
  onUpload,
  resolveImage,
}: {
  content: JSONContent;
  editable: boolean;
  onChange?: (content: JSONContent) => void;
  onUpload: (file: File) => Promise<string | null>;
  resolveImage: (id: string) => Promise<string>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: !editable,
          autolink: true,
          defaultProtocol: "https",
          isAllowedUri: (url, context) =>
            context.defaultValidate(url) && /^https?:\/\//iu.test(url),
          HTMLAttributes: {
            target: "_blank",
            rel: "noopener noreferrer",
          },
        },
      }),
      TableKit.configure({ table: { resizable: true } }),
      imageExtension(resolveImage),
      Placeholder.configure({ placeholder: "直接输入正文…" }),
    ],
    content,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => onChange?.(current.getJSON()),
    editorProps: { attributes: { class: "wiki-rich-content" } },
  });

  useEffect(() => editor?.setEditable(editable), [editable, editor]);
  if (!editor) return null;

  const link = () => {
    const previous = String(editor.getAttributes("link").href ?? "");
    const value = window.prompt("输入链接地址", previous || "https://");
    if (value === null) return;
    if (!value.trim()) editor.chain().focus().unsetLink().run();
    else if (/^https?:\/\//iu.test(value.trim()))
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: value.trim() })
        .run();
    else window.alert("链接必须以 http:// 或 https:// 开头");
  };

  return (
    <div
      className={`wiki-rich-editor ${editable ? "is-editing" : "is-reading"}`}
    >
      {editable && (
        <div
          className="wiki-rich-toolbar"
          role="toolbar"
          aria-label="文档工具栏"
        >
          <button
            title="撤销"
            onClick={() => editor.chain().focus().undo().run()}
          >
            ↶
          </button>
          <button
            title="重做"
            onClick={() => editor.chain().focus().redo().run()}
          >
            ↷
          </button>
          <span />
          <button
            title="加粗"
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <b>B</b>
          </button>
          <button
            title="斜体"
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <i>I</i>
          </button>
          <button
            title="下划线"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <u>U</u>
          </button>
          <button
            title="删除线"
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <s>S</s>
          </button>
          <span />
          <button
            title="标题"
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            H2
          </button>
          <button
            title="项目列表"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            • 列表
          </button>
          <button
            title="编号列表"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            1. 列表
          </button>
          <button title="链接" onClick={link}>
            🔗
          </button>
          <button
            title="插入表格"
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
          >
            ▦ 表格
          </button>
          <button title="插入图片" onClick={() => fileRef.current?.click()}>
            ▧ 图片
          </button>
          <input
            ref={fileRef}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file)
                void onUpload(file).then((id) => {
                  if (id)
                    editor
                      .chain()
                      .focus()
                      .insertContent({
                        type: "image",
                        attrs: {
                          image_id: id,
                          alt: file.name,
                          title: null,
                          caption: "",
                        },
                      })
                      .run();
                });
              event.target.value = "";
            }}
          />
          {editor.isActive("table") && (
            <>
              <span />
              <button
                onClick={() => editor.chain().focus().addRowAfter().run()}
              >
                ＋行
              </button>
              <button
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              >
                ＋列
              </button>
              <button
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                删除表格
              </button>
            </>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
