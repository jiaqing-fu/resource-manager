import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireAdmin, requireUser } from "@/lib/api";
import { businessSystemUpdateSchema } from "@/lib/business-system-schema";
import { validateEndpoints } from "@/server/services/service-endpoints";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const endpointInclude = {
  orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }],
  include: { ipAddress: { select: { id: true, address: true } } },
};

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const system = await prisma.businessSystem.findUnique({
      where: { id },
      include: { endpoints: endpointInclude },
    });
    if (!system) throw new ApiError(404, "业务系统不存在", "NOT_FOUND");
    return jsonOk(system);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = businessSystemUpdateSchema.parse(await readJson(req));
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.businessSystem.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "业务系统不存在", "NOT_FOUND");
      if (body.code && body.code !== existing.code) {
        const dup = await tx.businessSystem.findUnique({ where: { code: body.code } });
        if (dup) throw new ApiError(409, `业务系统编号「${body.code}」已存在`, "DUPLICATE_CODE");
      }
      if (body.endpoints !== undefined) {
        const endpoints = await validateEndpoints(tx, body.endpoints);
        await tx.businessSystemEndpoint.deleteMany({ where: { systemId: id } });
        if (endpoints.length > 0) {
          await tx.businessSystemEndpoint.createMany({
            data: endpoints.map((e) => ({ ...e, systemId: id })),
          });
        }
      }

      const data: Record<string, unknown> = {};
      for (const key of [
        "name",
        "code",
        "owner",
        "department",
        "environment",
        "criticality",
        "status",
        "url",
        "domain",
        "onlineDate",
        "description",
      ] as const) {
        if (body[key] !== undefined) data[key] = body[key];
      }
      const system = await tx.businessSystem.update({
        where: { id },
        data,
        include: { endpoints: endpointInclude },
      });
      await writeChangeLog(tx, {
        user,
        resource: "businessSystem",
        recordId: id,
        action: "UPDATE",
        summary: `修改业务系统 ${system.name}`,
        before: existing,
        after: system,
      });
      return system;
    });
    return jsonOk(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAdmin(req);
    const { id } = await params;
    await prisma.$transaction(async (tx) => {
      const existing = await tx.businessSystem.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "业务系统不存在", "NOT_FOUND");
      await tx.businessSystem.delete({ where: { id } });
      await writeChangeLog(tx, {
        user,
        resource: "businessSystem",
        recordId: id,
        action: "DELETE",
        summary: `删除业务系统 ${existing.name}`,
        before: existing,
      });
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
