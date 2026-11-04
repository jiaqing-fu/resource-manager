import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  ApiError,
  handleApiError,
  jsonOk,
  readJson,
  requireAdmin,
  requireUser,
} from "@/lib/api";
import { writeChangeLog } from "@/lib/changelog";
import {
  notificationLogSnapshot,
  parseNotificationInput,
} from "@/server/services/notification-input";
import {
  tryAcquireNotificationLock,
  releaseNotificationLock,
} from "@/server/services/notification-lock";
import { deleteNotificationDocx } from "@/server/services/notification-files";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new ApiError(404, "通知不存在", "NOT_FOUND");
    return jsonOk(notification);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    if (!tryAcquireNotificationLock(id)) {
      throw new ApiError(409, "通知正在发送，暂不能修改", "NOTIFICATION_SENDING");
    }
    try {
      const input = parseNotificationInput(await readJson(req));
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.notification.findUnique({ where: { id } });
        if (!existing) throw new ApiError(404, "通知不存在", "NOT_FOUND");
        if (existing.status === "sent") {
          throw new ApiError(409, "已发送的通知不可修改", "NOTIFICATION_SENT_IMMUTABLE");
        }
        const notification = await tx.notification.update({
          where: { id },
          data: {
            title: input.title,
            recipient: input.recipient,
            cc: input.cc,
            subject: input.subject,
            contentJson: input.contentJson,
            contentText: input.contentText,
            signature: input.signature,
            documentDate: input.documentDate,
          },
        });
        await writeChangeLog(tx, {
          user,
          resource: "notification",
          recordId: id,
          action: "UPDATE",
          summary: `修改通知「${notification.title || "未命名通知"}」`,
          before: notificationLogSnapshot(existing),
          after: notificationLogSnapshot(notification),
        });
        return notification;
      });
      return jsonOk(updated);
    } finally {
      releaseNotificationLock(id);
    }
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAdmin(req);
    const { id } = await params;
    if (!tryAcquireNotificationLock(id)) {
      throw new ApiError(409, "通知正在发送，暂不能删除", "NOTIFICATION_SENDING");
    }
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.notification.findUnique({ where: { id } });
        if (!existing) throw new ApiError(404, "通知不存在", "NOT_FOUND");
        if (existing.status === "sent") {
          throw new ApiError(409, "已发送的通知不可删除", "NOTIFICATION_SENT_IMMUTABLE");
        }
        await tx.notification.delete({ where: { id } });
        await writeChangeLog(tx, {
          user,
          resource: "notification",
          recordId: id,
          action: "DELETE",
          summary: `删除通知「${existing.title || "未命名通知"}」`,
          before: notificationLogSnapshot(existing),
        });
      });
      await deleteNotificationDocx(id);
      return jsonOk({ ok: true });
    } finally {
      releaseNotificationLock(id);
    }
  } catch (error) {
    return handleApiError(error);
  }
}
