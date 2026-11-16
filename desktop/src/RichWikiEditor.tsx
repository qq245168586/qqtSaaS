import { useEffect, useState } from 'react';
import { Button, Input, Space, Upload, message } from 'antd';
import {
  BoldOutlined,
  CodeOutlined,
  ItalicOutlined,
  LinkOutlined,
  OrderedListOutlined,
  PictureOutlined,
  StrikethroughOutlined,
  TableOutlined,
  UnderlineOutlined,
  UnorderedListOutlined,
  UndoOutlined,
  RedoOutlined,
} from '@ant-design/icons';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import type { JSONContent } from '@tiptap/core';
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { z } from 'zod';
import { errorText, ipc } from './api';

export const emptyWikiDocument = (): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});

function CachedEditorImage({ id, alt }: { id: string; alt: string }) {
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);
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
      .catch(() => setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  if (failed) return <span className="wiki-rich-image-error">图片加载失败</span>;
  if (!source) return <span className="wiki-rich-image-loading">图片加载中…</span>;
  return <img src={source} alt={alt} />;
}

function WikiImageNode({ node, updateAttributes, editor }: NodeViewProps) {
  const imageId = String(node.attrs.image_id ?? '');
  const caption = String(node.attrs.caption ?? '');
  const alt = String(node.attrs.alt ?? caption ?? '页面图片');
  return (
    <NodeViewWrapper className="wiki-rich-image" data-drag-handle>
      <CachedEditorImage id={imageId} alt={alt} />
      {editor.isEditable ? (
        <Input
          value={caption}
          placeholder="图片说明（可选）"
          maxLength={500}
          onChange={(event) => updateAttributes({ caption: event.target.value })}
        />
      ) : (
        caption && <figcaption>{caption}</figcaption>
      )}
    </NodeViewWrapper>
  );
}

const WikiImage = Image.extend({
  addAttributes() {
    return {
      image_id: { default: null },
      alt: { default: '' },
      title: { default: null },
      caption: { default: '' },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(WikiImageNode);
  },
});

function extensions() {
  return [
    StarterKit.configure({
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        isAllowedUri: (url, context) => context.defaultValidate(url) && /^https?:\/\//iu.test(url),
      },
    }),
    TableKit.configure({ table: { resizable: true } }),
    WikiImage,
    Placeholder.configure({ placeholder: '直接输入正文…' }),
  ];
}

export function RichWikiEditor({
  content,
  editable,
  onChange,
  onUpload,
  openExternal,
}: {
  content: JSONContent;
  editable: boolean;
  onChange?: (content: JSONContent) => void;
  onUpload: (file: File) => Promise<string | null>;
  openExternal: (url: string) => void;
}) {
  const editor = useEditor({
    extensions: extensions(),
    content,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => onChange?.(current.getJSON()),
    editorProps: {
      attributes: { class: 'wiki-rich-content' },
      handleClick: (_view, _position, event) => {
        if (editable) return false;
        const target = event.target instanceof Element ? event.target.closest('a') : null;
        const href = target?.getAttribute('href');
        if (!href) return false;
        event.preventDefault();
        openExternal(href);
        return true;
      },
    },
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  if (!editor) return null;
  const link = () => {
    const previous = String(editor.getAttributes('link').href ?? '');
    const value = window.prompt('输入链接地址', previous || 'https://');
    if (value === null) return;
    if (!value.trim()) editor.chain().focus().unsetLink().run();
    else if (/^https?:\/\//iu.test(value.trim()))
      editor.chain().focus().extendMarkRange('link').setLink({ href: value.trim() }).run();
    else void message.error('链接必须以 http:// 或 https:// 开头');
  };
  return (
    <div className={`wiki-rich-editor ${editable ? 'is-editing' : 'is-reading'}`}>
      {editable && (
        <div className="wiki-rich-toolbar">
          <Space.Compact>
            <Button
              icon={<UndoOutlined />}
              title="撤销"
              onClick={() => editor.chain().focus().undo().run()}
            />
            <Button
              icon={<RedoOutlined />}
              title="重做"
              onClick={() => editor.chain().focus().redo().run()}
            />
          </Space.Compact>
          <Space.Compact>
            <Button
              type={editor.isActive('bold') ? 'primary' : 'default'}
              icon={<BoldOutlined />}
              title="加粗"
              onClick={() => editor.chain().focus().toggleBold().run()}
            />
            <Button
              type={editor.isActive('italic') ? 'primary' : 'default'}
              icon={<ItalicOutlined />}
              title="斜体"
              onClick={() => editor.chain().focus().toggleItalic().run()}
            />
            <Button
              type={editor.isActive('underline') ? 'primary' : 'default'}
              icon={<UnderlineOutlined />}
              title="下划线"
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            />
            <Button
              type={editor.isActive('strike') ? 'primary' : 'default'}
              icon={<StrikethroughOutlined />}
              title="删除线"
              onClick={() => editor.chain().focus().toggleStrike().run()}
            />
          </Space.Compact>
          <Space.Compact>
            <Button
              title="标题"
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              H2
            </Button>
            <Button
              icon={<UnorderedListOutlined />}
              title="项目列表"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            />
            <Button
              icon={<OrderedListOutlined />}
              title="编号列表"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            />
            <Button
              icon={<CodeOutlined />}
              title="代码块"
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            />
          </Space.Compact>
          <Space.Compact>
            <Button icon={<LinkOutlined />} title="链接" onClick={link} />
            <Button
              icon={<TableOutlined />}
              title="插入表格"
              onClick={() =>
                editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
              }
            />
            <Upload
              accept="image/png,image/jpeg,image/webp"
              showUploadList={false}
              beforeUpload={(file) => {
                void onUpload(file)
                  .then((id) => {
                    if (id)
                      editor
                        .chain()
                        .focus()
                        .insertContent({
                          type: 'image',
                          attrs: { image_id: id, alt: file.name, title: null, caption: '' },
                        })
                        .run();
                  })
                  .catch((error) => message.error(errorText(error)));
                return false;
              }}
            >
              <Button icon={<PictureOutlined />} title="插入图片" />
            </Upload>
          </Space.Compact>
          {editor.isActive('table') && (
            <Space.Compact>
              <Button onClick={() => editor.chain().focus().addRowAfter().run()}>＋行</Button>
              <Button onClick={() => editor.chain().focus().addColumnAfter().run()}>＋列</Button>
              <Button danger onClick={() => editor.chain().focus().deleteTable().run()}>
                删除表格
              </Button>
            </Space.Compact>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
