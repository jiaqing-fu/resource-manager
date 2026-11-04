import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireUser } from "@/lib/api";
import { endpointSchema } from "@/lib/business-system-schema";
import { validateEndpoints } from "@/server/services/service-endpoints";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  items: z.array(endpointSchema).max(100, "端点数量不能超过 100 个"),
});

type Params = { params: Promise<{ id: string }> };

async function loadEndpoints(systemId: string) {
  return prisma.businessSystemEndpoint.findMany({
    where: { systemId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    include: { ipAddress: { select: { id: true, address: true } } },
  });
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const system = await prisma.businessSystem.findUnique({ where: { id }, select: { id: true } });
    if (!system) throw new ApiError(404, "业务系统不存在", "NOT_FOUND");
    return jsonOk({ items: await loadEndpoints(id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = putSchema.parse(await readJson(req));
    await prisma.$transaction(async (tx) => {
      const system = await tx.businessSystem.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!system) throw new ApiError(404, "业务系统不存在", "NOT_FOUND");
      const endpoints = await validateEndpoints(tx, body.items);
      await tx.businessSystemEndpoint.deleteMany({ where: { systemId: id } });
      if (endpoints.length > 0) {
        await tx.businessSystemEndpoint.createMany({
          data: endpoints.map((e) => ({ ...e, systemId: id })),
        });
      }
      await writeChangeLog(tx, {
        user,
        resource: "businessSystem",
        recordId: id,
        action: "UPDATE",
        summary: `更新业务系统 ${system.name} 的访问端点（${endpoints.length} 个）`,
        after: endpoints,
      });
    });
    return jsonOk({ items: await loadEndpoints(id) });
  } catch (error) {
    return handleApiError(error);
  }
}
