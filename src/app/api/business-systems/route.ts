import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  ApiError,
  getPaging,
  handleApiError,
  jsonOk,
  listResult,
  queryValue,
  readJson,
  requireUser,
} from "@/lib/api";
import { CRITICALITIES, ENVIRONMENTS, SYSTEM_STATUS } from "@/lib/enums";
import { businessSystemSchema } from "@/lib/business-system-schema";
import { validateEndpoints } from "@/server/services/service-endpoints";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const where: Record<string, unknown> = {};
    if (paging.keyword) {
      where.OR = [
        { name: { contains: paging.keyword } },
        { code: { contains: paging.keyword } },
        { owner: { contains: paging.keyword } },
        { domain: { contains: paging.keyword } },
      ];
    }
    const environment = queryValue(req, "environment");
    const criticality = queryValue(req, "criticality");
    const status = queryValue(req, "status");
    if (environment && ENVIRONMENTS.some((o) => o.value === environment)) where.environment = environment;
    if (criticality && CRITICALITIES.some((o) => o.value === criticality)) where.criticality = criticality;
    if (status && SYSTEM_STATUS.some((o) => o.value === status)) where.status = status;

    const [items, total] = await Promise.all([
      prisma.businessSystem.findMany({
        where,
        orderBy: { name: "asc" },
        skip: paging.skip,
        take: paging.pageSize,
        include: {
          endpoints: {
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            select: {
              id: true,
              ipText: true,
              protocol: true,
              port: true,
              isPrimary: true,
              ipAddress: { select: { id: true, address: true } },
            },
          },
          _count: { select: { endpoints: true } },
        },
      }),
      prisma.businessSystem.count({ where }),
    ]);
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = businessSystemSchema.parse(await readJson(req));
    const created = await prisma.$transaction(async (tx) => {
      if (body.code) {
        const dup = await tx.businessSystem.findUnique({ where: { code: body.code } });
        if (dup) throw new ApiError(409, `业务系统编号「${body.code}」已存在`, "DUPLICATE_CODE");
      }
      const endpoints = body.endpoints ? await validateEndpoints(tx, body.endpoints) : [];
      const { endpoints: _ignored, ...rest } = body;
      const system = await tx.businessSystem.create({
        data: {
          ...rest,
          endpoints: endpoints.length ? { create: endpoints } : undefined,
        },
        include: { endpoints: true },
      });
      await writeChangeLog(tx, {
        user,
        resource: "businessSystem",
        recordId: system.id,
        action: "CREATE",
        summary: `创建业务系统 ${system.name}`,
        after: system,
      });
      return system;
    });
    return jsonOk(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
