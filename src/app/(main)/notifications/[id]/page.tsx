import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { NotificationEditor } from "@/components/notifications/NotificationEditor";
import { getPublicNotificationMailConfig } from "@/server/services/notification-config";
import type { NotificationDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NotificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification) notFound();

  const detail: NotificationDetail = {
    id: notification.id,
    title: notification.title,
    recipient: notification.recipient,
    cc: notification.cc,
    subject: notification.subject,
    status: notification.status,
    fromAddress: notification.fromAddress,
    sentAt: notification.sentAt?.toISOString() ?? null,
    messageId: notification.messageId,
    docxFilename: notification.docxFilename,
    lastError: notification.lastError,
    attemptCount: notification.attemptCount,
    createdByName: notification.createdByName,
    sentByName: notification.sentByName,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
    contentJson: notification.contentJson,
    contentText: notification.contentText,
    signature: notification.signature,
    documentDate: notification.documentDate,
    sentById: notification.sentById,
    createdById: notification.createdById,
    docxPath: notification.docxPath,
  };

  return (
    <NotificationEditor
      notification={detail}
      config={getPublicNotificationMailConfig()}
    />
  );
}
