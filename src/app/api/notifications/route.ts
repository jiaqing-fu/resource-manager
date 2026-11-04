import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  getPaging,
  handleApiError,
  jsonOk,
  listResult,
  queryValue,
  readJson,
  requireUser,
} from "@/lib/api";
import { NOTIFICATION_STATUS } from "@/lib/enums";
import { writeChangeLog } from "@/lib/changelog";
import {
  notificationLogSnapshot,
  parseNotificationInput,
} from "@/server/services/notification-input";

export const dynamic = "force-dynamic";

const SUMMARY_SELECT = {
  id: true,
  title: true,
  recipient: true,
  cc: true,
  subject: true,
  status: true,
  fromAddress: true,
  sentAt: true,
  messageId: true,
  docxFilename: true,
  lastError: true,
  attemptCount: true,
  createdByName: true,
  sentByName: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NotificationSelect;

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const where: Prisma.NotificationWhereInput = {};
    if (paging.keyword) {
      const kw = paging.keyword;
      where.OR = [
        { title: { contains: kw } },
        { recipient: { contains: kw } },
        { cc: { contains: kw } },
        { subject: { contains: kw } },
        { contentText: { contains: kw } },
        { createdByName: { contains: kw } },
        { sentByName: { contains: kw } },
      ];
    }
    const status = queryValue(req, "status");
    if (status && NOTIFICATION_STATUS.some((o) => o.value === status)) {
      where.status = status;
    }

    const [items, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: paging.skip,
        take: paging.pageSize,
        select: SUMMARY_SELECT,
      }),
      prisma.notification.count({ where }),
    ]);
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const input = parseNotificationInput(await readJson(req));
    const created = await prisma.$transaction(async (tx) => {
      const notification = await tx.notification.create({
        data: {
          title: input.title,
          recipient: input.recipient,
          cc: input.cc,
          subject: input.subject,
          contentJson: input.contentJson,
          contentText: input.contentText,
          signature: input.signature,
          documentDate: input.documentDate,
          createdById: user.id,
          createdByName: user.displayName,
        },
      });
      await writeChangeLog(tx, {
        user,
        resource: "notification",
        recordId: notification.id,
        action: "CREATE",
        summary: `创建通知「${notification.title || "未命名通知"}」`,
        after: notificationLogSnapshot(notification),
      });
      return notification;
    });
    return jsonOk(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
