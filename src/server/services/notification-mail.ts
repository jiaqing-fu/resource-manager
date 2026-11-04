import nodemailer from "nodemailer";
import { checkEmailList } from "@/lib/email";
import type { NotificationMailConfig } from "@/server/services/notification-config";
import {
  escapeHtml,
  proseMirrorToEmailHtml,
  type ProseMirrorDoc,
} from "@/server/services/notification-content";

export type SendNotificationResult = {
  messageId: string | null;
  accepted: string[];
  rejected: string[];
};

function addresses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && "address" in item) {
      return String((item as { address?: unknown }).address ?? "");
    }
    return String(item);
  });
}

export async function sendNotificationEmail(input: {
  notificationId: string;
  title: string;
  subject: string | null;
  recipient: string;
  cc: string | null;
  doc: ProseMirrorDoc;
  contentText: string;
  signature: string | null;
  documentDate: string;
  docx: Buffer;
  filename: string;
  config: NotificationMailConfig;
}): Promise<SendNotificationResult> {
  if (!input.config.configured) {
    throw new Error(input.config.issue ?? "SMTP 未配置");
  }

  const to = checkEmailList(input.recipient).emails;
  const cc = checkEmailList(input.cc).emails;
  if (to.length === 0) throw new Error("没有有效的收件人邮箱");

  const subject = (input.subject?.trim() || input.title.trim() || "通知").replace(/[\r\n]+/g, " ");
  const title = input.title.trim() || "通知";
  const bodyHtml = proseMirrorToEmailHtml(input.doc);
  const signatureHtml = input.signature?.trim()
    ? `<p style="margin:24px 0 0;text-align:right;">${escapeHtml(input.signature.trim())}</p>`
    : "";
  const html = `<div style="font-family:'Microsoft YaHei',Arial,sans-serif;font-size:14px;line-height:1.75;color:#1f2937;max-width:720px;">
<h1 style="font-size:22px;margin:0 0 20px;text-align:center;">${escapeHtml(title)}</h1>
${bodyHtml}
${signatureHtml}
<p style="margin:8px 0 0;text-align:right;color:#4b5563;">${escapeHtml(input.documentDate)}</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px;" />
<p style="margin:0;color:#6b7280;font-size:12px;">附件为本次通知的 Word 文档，请查收。</p>
</div>`;

  const textParts = [title, "", input.contentText];
  if (input.signature?.trim()) textParts.push("", input.signature.trim());
  textParts.push("", input.documentDate, "", "附件为本次通知的 Word 文档，请查收。");

  const transport = nodemailer.createTransport({
    host: input.config.host,
    port: input.config.port,
    secure: input.config.secure,
    auth: input.config.auth ?? undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });

  try {
    const info = await transport.sendMail({
      from: input.config.fromName
        ? { name: input.config.fromName, address: input.config.fromAddress }
        : input.config.fromAddress,
      to,
      cc: cc.length > 0 ? cc : undefined,
      subject,
      text: textParts.join("\n"),
      html,
      attachments: [
        {
          filename: input.filename,
          content: input.docx,
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ],
      headers: { "X-Notification-Id": input.notificationId },
    });

    const accepted = addresses(info.accepted).filter(Boolean);
    const rejected = addresses(info.rejected).filter(Boolean);
    if (accepted.length === 0) {
      throw new Error(
        `SMTP 未接受任何收件人${rejected.length > 0 ? `：${rejected.join("、")}` : ""}`,
      );
    }
    return {
      messageId: info.messageId ? String(info.messageId) : null,
      accepted,
      rejected,
    };
  } finally {
    transport.close();
  }
}
