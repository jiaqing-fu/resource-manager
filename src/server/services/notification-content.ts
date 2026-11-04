export type ProseMirrorMark = { type: string };

export type ProseMirrorNode = {
  type: string;
  text?: string;
  marks?: ProseMirrorMark[];
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
};

export type ProseMirrorDoc = ProseMirrorNode & { type: "doc" };

export class NotificationContentError extends Error {
  field = "contentJson";

  constructor(message: string) {
    super(message);
  }
}

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_NODES = 20_000;
const MAX_DEPTH = 20;
const MAX_LIST_DEPTH = 8;

const ALLOWED_NODES = new Set([
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "hardBreak",
  "text",
]);

const ALLOWED_MARKS = new Set(["bold", "italic", "underline", "strike", "code"]);

type Counter = { nodes: number };

function fail(message: string): never {
  throw new NotificationContentError(message);
}

function normalizeNode(
  input: unknown,
  depth: number,
  listDepth: number,
  counter: Counter,
): ProseMirrorNode {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("正文结构不正确");
  }
  const raw = input as Record<string, unknown>;
  const type = raw.type;
  if (typeof type !== "string" || !ALLOWED_NODES.has(type)) {
    fail(`正文包含不支持的节点：${typeof type === "string" ? type : "未知"}`);
  }
  if (depth > MAX_DEPTH) fail("正文嵌套层级过深");
  counter.nodes += 1;
  if (counter.nodes > MAX_NODES) fail("正文内容过多");

  const nextListDepth =
    type === "bulletList" || type === "orderedList" ? listDepth + 1 : listDepth;
  if (nextListDepth > MAX_LIST_DEPTH) fail("列表嵌套层级过深");

  if (type === "text") {
    if (typeof raw.text !== "string" || !raw.text) fail("正文文本节点格式不正确");
    if (raw.content !== undefined) fail("正文文本节点不能包含子节点");
    const marks = raw.marks === undefined ? undefined : normalizeMarks(raw.marks);
    return { type, text: raw.text, ...(marks ? { marks } : {}) };
  }

  if (raw.text !== undefined) fail("正文节点格式不正确");

  let content: ProseMirrorNode[] | undefined;
  if (raw.content !== undefined) {
    if (!Array.isArray(raw.content)) fail("正文子节点格式不正确");
    content = raw.content.map((child) => normalizeNode(child, depth + 1, nextListDepth, counter));
  }

  if (type === "doc") {
    return { type: "doc", content: content ?? [] };
  }
  if (type === "hardBreak") {
    if (content && content.length > 0) fail("换行节点不能包含子节点");
    return { type };
  }

  if (type === "heading") {
    const attrs = raw.attrs;
    const level =
      attrs && typeof attrs === "object" && !Array.isArray(attrs)
        ? (attrs as Record<string, unknown>).level
        : undefined;
    if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 3) {
      fail("标题级别仅支持 1-3");
    }
    return { type, attrs: { level }, content: content ?? [] };
  }

  if (type === "orderedList") {
    const attrs = raw.attrs;
    const start =
      attrs && typeof attrs === "object" && !Array.isArray(attrs)
        ? (attrs as Record<string, unknown>).start
        : undefined;
    const normalizedStart =
      typeof start === "number" && Number.isInteger(start) && start >= 1 && start <= 100000
        ? start
        : 1;
    return { type, attrs: { start: normalizedStart }, content: content ?? [] };
  }

  if (type === "bulletList" || type === "listItem" || type === "blockquote" || type === "paragraph") {
    return { type, content: content ?? [] };
  }

  fail(`正文包含不支持的节点：${type}`);
}

function normalizeMarks(input: unknown): ProseMirrorMark[] {
  if (!Array.isArray(input)) fail("正文标记格式不正确");
  const seen = new Set<string>();
  const marks: ProseMirrorMark[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail("正文标记格式不正确");
    const type = (item as Record<string, unknown>).type;
    if (typeof type !== "string" || !ALLOWED_MARKS.has(type)) {
      fail(`正文包含不支持的格式：${typeof type === "string" ? type : "未知"}`);
    }
    if (!seen.has(type)) {
      seen.add(type);
      marks.push({ type });
    }
  }
  return marks;
}

/** 校验请求体中的 ProseMirror JSON 对象，返回规范化文档与派生纯文本。 */
export function parseNotificationContent(value: unknown): {
  doc: ProseMirrorDoc;
  text: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("正文结构不正确");
  }
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > MAX_JSON_BYTES) fail("正文不能超过 1MB");
  const doc = normalizeNode(value, 0, 0, { nodes: 0 });
  if (doc.type !== "doc") fail("正文根节点必须是 doc");
  return { doc: doc as ProseMirrorDoc, text: deriveContentText(doc) };
}

/** 解析数据库中已保存的正文字符串。 */
export function parseStoredNotificationContent(contentJson: string): {
  doc: ProseMirrorDoc;
  text: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contentJson);
  } catch {
    fail("已保存的正文格式损坏");
  }
  return parseNotificationContent(parsed);
}

function inlineText(node: ProseMirrorNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(inlineText).join("");
}

/** 从正文派生纯文本，用于检索与纯文本邮件。 */
export function deriveContentText(doc: ProseMirrorNode): string {
  const walk = (node: ProseMirrorNode, listLevel: number): string => {
    switch (node.type) {
      case "text":
        return node.text ?? "";
      case "hardBreak":
        return "\n";
      case "paragraph":
      case "heading":
        return `${inlineText(node)}\n\n`;
      case "blockquote":
        return `${(node.content ?? []).map((child) => walk(child, listLevel)).join("")}\n\n`;
      case "bulletList":
      case "orderedList": {
        const start =
          node.type === "orderedList" && typeof node.attrs?.start === "number"
            ? node.attrs.start
            : 1;
        const lines = (node.content ?? []).map((item, index) => {
          const body = (item.content ?? [])
            .map((child) => walk(child, listLevel + 1))
            .join("")
            .trim();
          const prefix = node.type === "orderedList" ? `${start + index}. ` : "- ";
          const indent = "  ".repeat(listLevel);
          return `${indent}${prefix}${body.replace(/\n/g, `\n${indent}  `)}`;
        });
        return `${lines.join("\n")}\n\n`;
      }
      case "listItem":
        return (node.content ?? []).map((child) => walk(child, listLevel)).join("");
      default:
        return (node.content ?? []).map((child) => walk(child, listLevel)).join("");
    }
  };
  const text = walk(doc, 0);
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(node: ProseMirrorNode): string {
  if (node.type === "hardBreak") return "<br />";
  if (node.type !== "text") {
    return (node.content ?? []).map(renderInline).join("");
  }
  let html = escapeHtml(node.text ?? "");
  const marks = new Set((node.marks ?? []).map((m) => m.type));
  if (marks.has("code")) html = `<code style="background:#f3f4f6;padding:1px 4px;border-radius:3px;">${html}</code>`;
  if (marks.has("bold")) html = `<strong>${html}</strong>`;
  if (marks.has("italic")) html = `<em>${html}</em>`;
  if (marks.has("underline")) html = `<u>${html}</u>`;
  if (marks.has("strike")) html = `<s>${html}</s>`;
  return html;
}

function renderBlocks(nodes: ProseMirrorNode[] | undefined): string {
  return (nodes ?? []).map(renderBlock).join("");
}

function renderBlock(node: ProseMirrorNode): string {
  switch (node.type) {
    case "paragraph": {
      const inline = (node.content ?? []).map(renderInline).join("");
      return `<p style="margin:0 0 10px;line-height:1.75;">${inline || "&nbsp;"}</p>`;
    }
    case "heading": {
      const level = node.attrs?.level === 2 ? 2 : node.attrs?.level === 3 ? 3 : 1;
      const sizes = { 1: "20px", 2: "17px", 3: "15px" } as const;
      const inline = (node.content ?? []).map(renderInline).join("");
      return `<h${level} style="margin:18px 0 10px;font-size:${sizes[level]};line-height:1.4;">${inline}</h${level}>`;
    }
    case "bulletList":
      return `<ul style="margin:0 0 10px;padding-left:24px;line-height:1.75;">${renderBlocks(node.content)}</ul>`;
    case "orderedList": {
      const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
      return `<ol start="${start}" style="margin:0 0 10px;padding-left:24px;line-height:1.75;">${renderBlocks(node.content)}</ol>`;
    }
    case "listItem":
      return `<li>${renderBlocks(node.content)}</li>`;
    case "blockquote":
      return `<blockquote style="margin:0 0 10px;padding:4px 0 4px 12px;border-left:3px solid #d1d5db;color:#4b5563;">${renderBlocks(node.content)}</blockquote>`;
    case "hardBreak":
      return "<br />";
    case "text":
      return renderInline(node);
    default:
      return renderBlocks(node.content);
  }
}

/** 将已校验的正文渲染为邮件 HTML（所有文本已转义）。 */
export function proseMirrorToEmailHtml(doc: ProseMirrorNode): string {
  return renderBlocks(doc.content);
}
