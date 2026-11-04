import { ApiError } from "@/lib/api";
import { notificationSchema } from "@/lib/notification-schema";
import { checkEmailList, emailListError } from "@/lib/email";
import {
  NotificationContentError,
  parseNotificationContent,
  type ProseMirrorDoc,
} from "@/server/services/notification-content";

export type ParsedNotificationInput = {
  title: string;
  recipient: string;
  cc: string | null;
  subject: string | null;
  contentJson: string;
  contentText: string;
  signature: string | null;
  documentDate: string;
  doc: ProseMirrorDoc;
};

/** 校验请求体、规范化邮箱与正文；字段级错误交给 handleApiError。 */
export function parseNotificationInput(value: unknown): ParsedNotificationInput {
  const body = notificationSchema.parse(value);

  const to = checkEmailList(body.recipient);
  const toError = emailListError(to, "收件人");
  if (toError) throw new ApiError(422, toError, "VALIDATION_ERROR", { recipient: toError });

  const cc = checkEmailList(body.cc);
  const ccError = emailListError(cc, "抄送");
  if (ccError) throw new ApiError(422, ccError, "VALIDATION_ERROR", { cc: ccError });

  try {
    const { doc, text } = parseNotificationContent(body.contentJson);
    return {
      title: body.title.trim(),
      recipient: to.emails.join(", "),
      cc: cc.emails.length > 0 ? cc.emails.join(", ") : null,
      subject: body.subject ?? null,
      contentJson: JSON.stringify(doc),
      contentText: text,
      signature: body.signature ?? null,
      documentDate: body.documentDate,
      doc,
    };
  } catch (error) {
    if (error instanceof NotificationContentError) {
      throw new ApiError(422, error.message, "VALIDATION_ERROR", { contentJson: error.message });
    }
    throw error;
  }
}

/** 变更记录只保存摘要，不写入完整正文。 */
export function notificationLogSnapshot(notification: {
  title: string;
  recipient: string;
  cc: string | null;
  subject: string | null;
  status: string;
  documentDate: string;
  signature: string | null;
  fromAddress: string | null;
  sentAt: Date | null;
  sentByName: string | null;
  lastError: string | null;
}) {
  return {
    title: notification.title,
    recipient: notification.recipient,
    cc: notification.cc,
    subject: notification.subject,
    status: notification.status,
    documentDate: notification.documentDate,
    signature: notification.signature,
    fromAddress: notification.fromAddress,
    sentAt: notification.sentAt,
    sentByName: notification.sentByName,
    lastError: notification.lastError,
  };
}
