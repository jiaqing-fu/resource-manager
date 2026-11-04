"use client";

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Button, Divider, Tooltip } from "antd";
import {
  BoldOutlined,
  ItalicOutlined,
  OrderedListOutlined,
  RedoOutlined,
  StrikethroughOutlined,
  UnderlineOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";

type Props = {
  initialContent: JSONContent;
  editable: boolean;
  onUpdate: (json: JSONContent, text: string) => void;
};

export function RichTextEditor({ initialContent, editable, onUpdate }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable,
    content: initialContent,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        link: false,
        horizontalRule: false,
      }),
    ],
    editorProps: {
      attributes: {
        class: "rm-notification-prosemirror",
        "aria-label": "通知正文",
      },
    },
    onUpdate: ({ editor: current }) => {
      onUpdate(current.getJSON(), current.getText());
    },
  });

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      underline: current?.isActive("underline") ?? false,
      strike: current?.isActive("strike") ?? false,
      h1: current?.isActive("heading", { level: 1 }) ?? false,
      h2: current?.isActive("heading", { level: 2 }) ?? false,
      h3: current?.isActive("heading", { level: 3 }) ?? false,
      bulletList: current?.isActive("bulletList") ?? false,
      orderedList: current?.isActive("orderedList") ?? false,
      blockquote: current?.isActive("blockquote") ?? false,
      canUndo: current?.can().undo() ?? false,
      canRedo: current?.can().redo() ?? false,
    }),
  });

  if (!editor) {
    return <div className="rm-notification-editor-loading">正文编辑器加载中…</div>;
  }

  const run = (fn: () => void) => {
    fn();
  };

  return (
    <div className={`rm-notification-editor${editable ? "" : " is-readonly"}`}>
      {editable ? (
        <div className="rm-notification-toolbar">
          <Tooltip title="加粗">
            <Button
              size="small"
              type={state?.bold ? "primary" : "text"}
              aria-label="加粗"
              icon={<BoldOutlined />}
              onClick={() => run(() => editor.chain().focus().toggleBold().run())}
            />
          </Tooltip>
          <Tooltip title="斜体">
            <Button
              size="small"
              type={state?.italic ? "primary" : "text"}
              aria-label="斜体"
              icon={<ItalicOutlined />}
              onClick={() => run(() => editor.chain().focus().toggleItalic().run())}
            />
          </Tooltip>
          <Tooltip title="下划线">
            <Button
              size="small"
              type={state?.underline ? "primary" : "text"}
              aria-label="下划线"
              icon={<UnderlineOutlined />}
              onClick={() => run(() => editor.chain().focus().toggleUnderline().run())}
            />
          </Tooltip>
          <Tooltip title="删除线">
            <Button
              size="small"
              type={state?.strike ? "primary" : "text"}
              aria-label="删除线"
              icon={<StrikethroughOutlined />}
              onClick={() => run(() => editor.chain().focus().toggleStrike().run())}
            />
          </Tooltip>
          <Divider type="vertical" />
          <Tooltip title="一级标题">
            <Button
              size="small"
              type={state?.h1 ? "primary" : "text"}
              onClick={() => run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}
            >
              H1
            </Button>
          </Tooltip>
          <Tooltip title="二级标题">
            <Button
              size="small"
              type={state?.h2 ? "primary" : "text"}
              onClick={() => run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}
            >
              H2
            </Button>
          </Tooltip>
          <Tooltip title="三级标题">
            <Button
              size="small"
              type={state?.h3 ? "primary" : "text"}
              onClick={() => run(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}
            >
              H3
            </Button>
          </Tooltip>
          <Divider type="vertical" />
          <Tooltip title="项目列表">
            <Button
              size="small"
              type={state?.bulletList ? "primary" : "text"}
              aria-label="项目列表"
              icon={<UnorderedListOutlined />}
              onClick={() => run(() => editor.chain().focus().toggleBulletList().run())}
            />
          </Tooltip>
          <Tooltip title="编号列表">
            <Button
              size="small"
              type={state?.orderedList ? "primary" : "text"}
              aria-label="编号列表"
              icon={<OrderedListOutlined />}
              onClick={() => run(() => editor.chain().focus().toggleOrderedList().run())}
            />
          </Tooltip>
          <Tooltip title="引用">
            <Button
              size="small"
              type={state?.blockquote ? "primary" : "text"}
              onClick={() => run(() => editor.chain().focus().toggleBlockquote().run())}
            >
              引用
            </Button>
          </Tooltip>
          <Divider type="vertical" />
          <Tooltip title="撤销">
            <Button
              size="small"
              type="text"
              aria-label="撤销"
              disabled={!state?.canUndo}
              icon={<UndoOutlined />}
              onClick={() => run(() => editor.chain().focus().undo().run())}
            />
          </Tooltip>
          <Tooltip title="重做">
            <Button
              size="small"
              type="text"
              aria-label="重做"
              disabled={!state?.canRedo}
              icon={<RedoOutlined />}
              onClick={() => run(() => editor.chain().focus().redo().run())}
            />
          </Tooltip>
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
