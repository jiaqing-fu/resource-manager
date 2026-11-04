import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, requireUser } from "@/lib/api";
import { buildDocxFilename, buildNotificationDocx } from "@/server/services/notification-docx";
import { readNotificationDocx, writeNotificationDocx } from "@/server/services/notification-files";
import {
  NotificationContentError,
  parseStoredNotificationContent,
} from "@/server/services/notification-content";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function contentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="notification.docx"; filename*=UTF-8''${encoded}`;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new ApiError(404, "通知不存在", "NOT_FOUND");

    // 已发送记录不可修改，本地副本即为发送版本；草稿/失败记录可能已编辑，
    // 必须按当前数据库内容重新生成，避免下载到旧版本的 Word。
    let buffer = notification.status === "sent" ? await readNotificationDocx(id) : null;
    if (!buffer) {
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
      const generated = await buildNotificationDocx({
        title: notification.title,
        doc: parsed.doc,
        signature: notification.signature,
        documentDate: notification.documentDate,
      });
      buffer = generated.buffer;
      await writeNotificationDocx(id, buffer);
    }

    const filename = buildDocxFilename(notification.title);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": DOCX_MIME,
        "Content-Length": String(buffer.length),
        "Content-Disposition": contentDisposition(filename),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
