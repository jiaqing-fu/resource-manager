import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireUser } from "@/lib/api";
import { terminationSchema } from "@/lib/line-schema";
import { validateTerminations } from "@/server/services/inventory";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  items: z.array(terminationSchema).max(2, "每条线路最多 A/Z 两个端点"),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const line = await prisma.line.findUnique({ where: { id }, select: { id: true } });
    if (!line) throw new ApiError(404, "线路不存在", "NOT_FOUND");
    const items = await prisma.lineTermination.findMany({
      where: { lineId: id },
      orderBy: { side: "asc" },
      include: {
        rack: { select: { id: true, code: true, location: true, uStart: true, uEnd: true } },
        device: { select: { id: true, name: true } },
      },
    });
    return jsonOk({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = putSchema.parse(await readJson(req));
    const items = await prisma.$transaction(async (tx) => {
      const line = await tx.line.findUnique({ where: { id }, select: { id: true, code: true } });
      if (!line) throw new ApiError(404, "线路不存在", "NOT_FOUND");
      const terms = await validateTerminations(tx, body.items);
      await tx.lineTermination.deleteMany({ where: { lineId: id } });
      if (terms.length > 0) {
        await tx.lineTermination.createMany({
          data: terms.map((t) => ({ ...t, lineId: id })),
        });
      }
      await writeChangeLog(tx, {
        user,
        resource: "line",
        recordId: id,
        action: "UPDATE",
        summary: `更新线路 ${line.code} 的 A/Z 端点（${terms.length} 个）`,
        after: terms,
      });
      return tx.lineTermination.findMany({
        where: { lineId: id },
        orderBy: { side: "asc" },
        include: {
          rack: { select: { id: true, code: true, location: true, uStart: true, uEnd: true } },
          device: { select: { id: true, name: true } },
        },
      });
    });
    return jsonOk({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
