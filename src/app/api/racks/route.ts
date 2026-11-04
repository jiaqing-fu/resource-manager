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
import { RACK_STATUS } from "@/lib/enums";
import { computeRackUsage, validateRackSegment } from "@/server/services/inventory";
import { writeChangeLog } from "@/lib/changelog";
import { rackSchema } from "@/lib/rack-schema";
import { rackRangeText } from "@/lib/rack";
import { summarizeAllocationCustomers } from "@/lib/customer-summary";
import { resolveSupplierForCreate } from "@/server/services/supplier-requirements";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const status = queryValue(req, "status");
    const supplierId = queryValue(req, "supplierId");
    const customerId = queryValue(req, "customerId");
    const where: Prisma.RackWhereInput = {};
    if (paging.keyword) {
      const kw = paging.keyword;
      where.OR = [
        { code: { contains: kw } },
        { location: { contains: kw } },
        { power: { contains: kw } },
        { serial: { contains: kw } },
        { notes: { contains: kw } },
        { supplier: { is: { name: { contains: kw } } } },
        {
          allocations: {
            some: {
              releasedAt: null,
              customer: { is: { name: { contains: kw } } },
            },
          },
        },
      ];
    }
    if (status && RACK_STATUS.some((o) => o.value === status)) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (customerId) {
      where.allocations = { some: { releasedAt: null, customerId } };
    }

    const [rows, total] = await Promise.all([
      prisma.rack.findMany({
        where,
        orderBy: [{ code: "asc" }, { uStart: "asc" }],
        skip: paging.skip,
        take: paging.pageSize,
        include: {
          supplier: { select: { id: true, name: true } },
          allocations: {
            where: { releasedAt: null },
            select: {
              customerId: true,
              customer: { select: { id: true, name: true } },
            },
          },
          devices: { select: { uStart: true, uHeight: true, face: true } },
          _count: { select: { devices: true, ipAddresses: true } },
        },
      }),
      prisma.rack.count({ where }),
    ]);
    const items = rows.map((r) => {
      const usage = computeRackUsage(r.devices);
      const { devices: _devices, allocations, ...rest } = r;
      return {
        ...rest,
        ...usage,
        ...summarizeAllocationCustomers(allocations),
      };
    });
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = rackSchema.parse(await readJson(req));
    const created = await prisma.$transaction(async (tx) => {
      const supplierId = await resolveSupplierForCreate(tx, body.supplierId);
      await validateRackSegment(tx, {
        code: body.code,
        uStart: body.uStart,
        uEnd: body.uEnd,
      });
      const rack = await tx.rack.create({
        data: {
          code: body.code,
          location: body.location ?? null,
          status: body.status,
          width: body.width,
          uStart: body.uStart,
          uEnd: body.uEnd,
          power: body.power ?? null,
          serial: body.serial ?? null,
          notes: body.notes ?? null,
          supplierId,
          customerId: null,
        },
        include: { supplier: { select: { id: true, name: true } } },
      });
      await writeChangeLog(tx, {
        user,
        resource: "rack",
        recordId: rack.id,
        action: "CREATE",
        summary: `创建机柜 ${rack.code} ${rackRangeText(rack.uStart, rack.uEnd)}`,
        after: rack,
      });
      return rack;
    });
    return jsonOk(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
