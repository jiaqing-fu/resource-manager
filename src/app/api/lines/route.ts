import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
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
import { LINE_STATUS, LINE_TYPES } from "@/lib/enums";
import { lineSchema } from "@/lib/line-schema";
import { assignResourceCustomer } from "@/server/services/allocations";
import { validateTerminations } from "@/server/services/inventory";
import { resolveSupplierForCreate } from "@/server/services/supplier-requirements";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const where: Prisma.LineWhereInput = {};
    if (paging.keyword) {
      const kw = paging.keyword;
      where.OR = [
        { code: { contains: kw } },
        { name: { contains: kw } },
        { circuitNo: { contains: kw } },
        { description: { contains: kw } },
        { supplier: { is: { name: { contains: kw } } } },
        { customer: { is: { name: { contains: kw } } } },
        { terminations: { some: { rack: { is: { code: { contains: kw } } } } } },
        { terminations: { some: { rack: { is: { location: { contains: kw } } } } } },
        { terminations: { some: { device: { is: { name: { contains: kw } } } } } },
      ];
    }
    const type = queryValue(req, "type");
    const status = queryValue(req, "status");
    if (type && LINE_TYPES.some((o) => o.value === type)) where.type = type;
    if (status && LINE_STATUS.some((o) => o.value === status)) where.status = status;
    for (const key of ["supplierId", "customerId"] as const) {
      const v = queryValue(req, key);
      if (v) where[key] = v;
    }
    const expireBefore = queryValue(req, "expireBefore");
    if (expireBefore) where.expireDate = { not: null, lte: expireBefore };

    const [items, total] = await Promise.all([
      prisma.line.findMany({
        where,
        orderBy: { code: "asc" },
        skip: paging.skip,
        take: paging.pageSize,
        include: {
          supplier: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          terminations: {
            orderBy: { side: "asc" },
            select: {
              id: true,
              side: true,
              port: true,
              rack: { select: { id: true, code: true, location: true, uStart: true, uEnd: true } },
              device: { select: { id: true, name: true } },
            },
          },
          _count: { select: { ipAddresses: true } },
        },
      }),
      prisma.line.count({ where }),
    ]);
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = lineSchema.parse(await readJson(req));
    const created = await prisma.$transaction(async (tx) => {
      const supplierId = await resolveSupplierForCreate(tx, body.supplierId);
      const dup = await tx.line.findUnique({ where: { code: body.code } });
      if (dup) throw new ApiError(409, `线路编号「${body.code}」已存在`, "DUPLICATE_CODE");
      const terms = body.terminations ? await validateTerminations(tx, body.terminations) : [];
      let line = await tx.line.create({
        data: {
          code: body.code,
          name: body.name,
          type: body.type,
          status: body.status,
          supplierId,
          customerId: null,
          bandwidthMbps: body.bandwidthMbps ?? null,
          monthlyFeeCents: body.monthlyFeeCents ?? null,
          circuitNo: body.circuitNo ?? null,
          installDate: body.installDate ?? null,
          expireDate: body.expireDate ?? null,
          description: body.description ?? null,
          terminations: terms.length ? { create: terms } : undefined,
        },
        include: {
          supplier: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          terminations: { orderBy: { side: "asc" } },
        },
      });
      if (body.customerId) {
        await assignResourceCustomer(tx, {
          resourceType: "line",
          resourceId: line.id,
          customerId: body.customerId,
          notes: "创建资源时绑定",
        });
        line = await tx.line.findUniqueOrThrow({
          where: { id: line.id },
          include: {
            supplier: { select: { id: true, name: true } },
            customer: { select: { id: true, name: true } },
            terminations: { orderBy: { side: "asc" } },
          },
        });
      }
      await writeChangeLog(tx, {
        user,
        resource: "line",
        recordId: line.id,
        action: "CREATE",
        summary: `创建线路 ${line.code} ${line.name}`,
        after: line,
      });
      return line;
    });
    return jsonOk(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
