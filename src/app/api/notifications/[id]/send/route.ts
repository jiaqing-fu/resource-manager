import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  ApiError,
  handleApiError,
  jsonError,
  jsonOk,
  requireUser,
} from "@/lib/api";
import { writeChangeLog } from "@/lib/changelog";
import { notificationSendErrors } from "@/lib/notification-schema";
import { getNotificationMailConfig } from "@/server/services/notification-config";
import {
  NotificationContentError,
  parseStoredNotificationContent,
} from "@/server/services/notification-content";
import { buildNotificationDocx } from "@/server/services/notification-docx";
import { writeNotificationDocx } from "@/server/services/notification-files";
import { sendNotificationEmail } from "@/server/services/notification-mail";
import {
  releaseNotificationLock,
  tryAcquireNotificationLock,
} from "@/server/services/notification-lock";
import { notificationLogSnapshot } from "@/server/services/notification-input";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function truncateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/[\r\n]+/g, " ").trim().slice(0, 1000) || "发送失败";
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;

    const initial = await prisma.notification.findUnique({ where: { id } });
    if (!initial) throw new ApiError(404, "通知不存在", "NOT_FOUND");
    if (initial.status === "sent") {
      throw new ApiError(409, "该通知已发送，不能重复发送", "NOTIFICATION_SENT_IMMUTABLE");
    }
    if (!tryAcquireNotificationLock(id)) {
      throw new ApiError(409, "通知正在发送，请勿重复操作", "NOTIFICATION_SENDING");
    }

    try {
      const notification = await prisma.notification.findUnique({ where: { id } });
      if (!notification) throw new ApiError(404, "通知不存在", "NOT_FOUND");
      if (notification.status === "sent") {
        throw new ApiError(409, "该通知已发送，不能重复发送", "NOTIFICATION_SENT_IMMUTABLE");
      }

      const config = getNotificationMailConfig();
      if (!config.configured) {
        throw new ApiError(
          503,
          `SMTP 未配置：${config.issue ?? "请检查服务器 .env"}`,
          "SMTP_NOT_CONFIGURED",
        );
      }

      let parsed;
      try {
        parsed = parseStoredNotificationContent(notification.contentJson);
      } catch (error) {
        if (error instanceof NotificationContentError) {
          throw new ApiError(422, error.message, "VALIDATION_ERROR", {
            contentJson: error.message,
          });
        }
        throw error;
      }

      const errors = notificationSendErrors({
        title: notification.title,
        recipient: notification.recipient,
        cc: notification.cc,
        contentText: notification.contentText,
        documentDate: notification.documentDate,
      });
      if (Object.keys(errors).length > 0) {
        throw new ApiError(400, "通知内容不完整，无法发送", "VALIDATION_ERROR", errors);
      }

      const { buffer, filename } = await buildNotificationDocx({
        title: notification.title,
        doc: parsed.doc,
        signature: notification.signature,
        documentDate: notification.documentDate,
      });
      const storedFilename = await writeNotificationDocx(id, buffer);

      let mailResult;
      try {
        mailResult = await sendNotificationEmail({
          notificationId: id,
          title: notification.title,
          subject: notification.subject,
          recipient: notification.recipient,
          cc: notification.cc,
          doc: parsed.doc,
          contentText: notification.contentText,
          signature: notification.signature,
          documentDate: notification.documentDate,
          docx: buffer,
          filename,
          config,
        });
      } catch (error) {
        const message = truncateError(error);
        const failed = await prisma.$transaction(async (tx) => {
          const updated = await tx.notification.update({
            where: { id },
            data: {
              status: "failed",
              lastError: message,
              attemptCount: { increment: 1 },
              docxPath: storedFilename,
              docxFilename: filename,
            },
          });
          await writeChangeLog(tx, {
            user,
            resource: "notification",
            recordId: id,
            action: "UPDATE",
            summary: `通知「${notification.title || "未命名通知"}」发送失败`,
            before: notificationLogSnapshot(notification),
            after: notificationLogSnapshot(updated),
          });
          return updated;
        });
        return jsonError(502, `邮件发送失败：${failed.lastError}`, "MAIL_SEND_FAILED");
      }

      const warning =
        mailResult.rejected.length > 0
          ? `部分收件人未被接受：${mailResult.rejected.join("、")}`
          : null;

      const updated = await prisma.$transaction(async (tx) => {
        const record = await tx.notification.update({
          where: { id },
          data: {
            status: "sent",
            sentAt: new Date(),
            sentById: user.id,
            sentByName: user.displayName,
            fromAddress: config.fromAddress,
            messageId: mailResult.messageId,
            docxPath: storedFilename,
            docxFilename: filename,
            lastError: warning,
            attemptCount: { increment: 1 },
          },
        });
        await writeChangeLog(tx, {
          user,
          resource: "notification",
          recordId: id,
          action: "SEND",
          summary: `发送通知「${record.title || "未命名通知"}」至 ${record.recipient}`,
          before: notificationLogSnapshot(notification),
          after: notificationLogSnapshot(record),
        });
        return record;
      });

      return jsonOk(updated);
    } finally {
      releaseNotificationLock(id);
    }
  } catch (error) {
    return handleApiError(error);
  }
}
