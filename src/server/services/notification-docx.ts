import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType,
} from "docx";
import type { ProseMirrorDoc, ProseMirrorNode } from "@/server/services/notification-content";

const BODY_FONT = "宋体";
const HEADING_FONT = "黑体";
const BODY_SIZE = 24; // 12pt，docx 使用半磅
const LINE_SPACING = 360; // 1.5 倍行距（240 = 单倍）
const LIST_INDENT = 360;

type RenderOptions = {
  indent?: number;
  quote?: boolean;
};

type RunStyle = {
  bold?: boolean;
  font?: string;
  size?: number;
};

function runProperties(node: ProseMirrorNode, style: RunStyle = {}) {
  const marks = new Set((node.marks ?? []).map((m) => m.type));
  return {
    bold: style.bold ?? marks.has("bold"),
    italics: marks.has("italic"),
    strike: marks.has("strike"),
    underline: marks.has("underline") ? { type: UnderlineType.SINGLE } : undefined,
    font: style.font ?? (marks.has("code") ? "Consolas" : BODY_FONT),
    size: style.size ?? (marks.has("code") ? 22 : BODY_SIZE),
  };
}

function inlineRuns(nodes: ProseMirrorNode[] | undefined, style: RunStyle = {}): TextRun[] {
  const runs: TextRun[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "hardBreak") {
      runs.push(new TextRun({ break: 1 }));
      continue;
    }
    if (node.type === "text") {
      runs.push(new TextRun({ text: node.text ?? "", ...runProperties(node, style) }));
      continue;
    }
    runs.push(...inlineRuns(node.content, style));
  }
  return runs;
}

function plainText(node: ProseMirrorNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(plainText).join("");
}

function borderForQuote(quote: boolean | undefined) {
  if (!quote) return undefined;
  return {
    left: {
      style: BorderStyle.SINGLE,
      size: 12,
      color: "D1D5DB",
      space: 8,
    },
  };
}

function renderBlock(node: ProseMirrorNode, options: RenderOptions): Paragraph[] {
  switch (node.type) {
    case "paragraph":
      return [
        new Paragraph({
          children: inlineRuns(node.content),
          indent: options.indent ? { left: options.indent } : undefined,
          border: borderForQuote(options.quote),
          spacing: { line: LINE_SPACING, after: 120 },
        }),
      ];
    case "heading": {
      const level = node.attrs?.level === 2 ? 2 : node.attrs?.level === 3 ? 3 : 1;
      const size = level === 1 ? 36 : level === 2 ? 32 : 28;
      return [
        new Paragraph({
          children: inlineRuns(node.content, {
            bold: true,
            font: HEADING_FONT,
            size,
          }),
          indent: options.indent ? { left: options.indent } : undefined,
          border: borderForQuote(options.quote),
          spacing: { line: LINE_SPACING, before: 240, after: 120 },
        }),
      ];
    }
    case "bulletList":
    case "orderedList":
      return renderList(node, 0, options);
    case "blockquote":
      return renderBlocks(node.content, {
        indent: (options.indent ?? 0) + 720,
        quote: true,
      });
    case "listItem":
      return renderBlocks(node.content, options);
    case "hardBreak":
      return [new Paragraph({ children: [new TextRun({ break: 1 })] })];
    case "text":
      return [new Paragraph({ children: inlineRuns([node]) })];
    default:
      return renderBlocks(node.content, options);
  }
}

function renderBlocks(
  nodes: ProseMirrorNode[] | undefined,
  options: RenderOptions = {},
): Paragraph[] {
  return (nodes ?? []).flatMap((node) => renderBlock(node, options));
}

function renderList(
  list: ProseMirrorNode,
  level: number,
  options: RenderOptions,
): Paragraph[] {
  const ordered = list.type === "orderedList";
  const start = typeof list.attrs?.start === "number" ? list.attrs.start : 1;
  const out: Paragraph[] = [];
  const baseIndent = (options.indent ?? 0) + (level + 1) * LIST_INDENT;

  (list.content ?? []).forEach((item, index) => {
    let first = true;
    for (const child of item.content ?? []) {
      if (child.type === "bulletList" || child.type === "orderedList") {
        out.push(
          ...renderList(child, level + 1, {
            indent: options.indent,
            quote: options.quote,
          }),
        );
        continue;
      }
      if (child.type === "paragraph" || child.type === "heading") {
        const prefix = first ? (ordered ? `${start + index}. ` : "• ") : "";
        const runs = inlineRuns(child.content);
        if (prefix) {
          runs.unshift(new TextRun({ text: prefix, font: BODY_FONT, size: BODY_SIZE }));
        }
        out.push(
          new Paragraph({
            children: runs,
            indent: { left: baseIndent, hanging: first ? 240 : 0 },
            border: borderForQuote(options.quote),
            spacing: { line: LINE_SPACING, after: 60 },
          }),
        );
        first = false;
        continue;
      }
      if (child.type === "blockquote") {
        out.push(...renderBlock(child, { indent: baseIndent, quote: true }));
        first = false;
        continue;
      }
      const text = plainText(child).trim();
      if (text) {
        out.push(
          new Paragraph({
            children: [
              ...(first
                ? [new TextRun({ text: ordered ? `${start + index}. ` : "• " })]
                : []),
              new TextRun({ text }),
            ],
            indent: { left: baseIndent, hanging: first ? 240 : 0 },
            spacing: { line: LINE_SPACING, after: 60 },
          }),
        );
        first = false;
      }
    }
  });
  return out;
}

/** 生成安全的 .docx 文件名。 */
export function buildDocxFilename(title: string): string {
  const safe = title
    .replace(/[/\\:*?"<>|\r\n]/g, " ")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80)
    .trim();
  return `${safe || "通知"}.docx`;
}

export async function buildNotificationDocx(input: {
  title: string;
  doc: ProseMirrorDoc;
  signature: string | null;
  documentDate: string;
}): Promise<{ buffer: Buffer; filename: string }> {
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [
        new TextRun({
          text: input.title || "未命名通知",
          bold: true,
          font: HEADING_FONT,
          size: 44,
        }),
      ],
    }),
    ...renderBlocks(input.doc.content),
  ];

  if (!input.doc.content || input.doc.content.length === 0) {
    children.push(new Paragraph({ children: [] }));
  }

  if (input.signature?.trim()) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 480, line: LINE_SPACING },
        children: [new TextRun({ text: input.signature.trim(), font: BODY_FONT, size: BODY_SIZE })],
      }),
    );
  }
  children.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: input.signature?.trim() ? 0 : 480, line: LINE_SPACING },
      children: [new TextRun({ text: input.documentDate, font: BODY_FONT, size: BODY_SIZE })],
    }),
  );

  const document = new Document({
    creator: "技术部资源管理系统",
    title: input.title || "未命名通知",
    description: "通知文档",
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: BODY_SIZE },
          paragraph: { spacing: { line: LINE_SPACING } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  return {
    buffer: await Packer.toBuffer(document),
    filename: buildDocxFilename(input.title),
  };
}
