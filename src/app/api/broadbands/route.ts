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
import { BROADBAND_STATUS } from "@/lib/enums";
import { broadbandSchema } from "@/lib/broadband-schema";
import { computeReusePercent } from "@/lib/broadband";
import { summarizeAllocationCustomers } from "@/lib/customer-summary";
import { resolveSupplierForCreate } from "@/server/services/supplier-requirements";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const where: Prisma.BroadbandWhereInput = {};
    if (paging.keyword) {
      const kw = paging.keyword;
      where.OR = [
        { name: { contains: kw } },
        { account: { contains: kw } },
        { installAddress: { contains: kw } },
        { contractNo: { contains: kw } },
        { description: { contains: kw } },
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
        { rack: { is: { code: { contains: kw } } } },
        { device: { is: { name: { contains: kw } } } },
        { line: { is: { code: { contains: kw } } } },
        { ipAddress: { is: { address: { contains: kw } } } },
      ];
    }
    const status = queryValue(req, "status");
    if (status && BROADBAND_STATUS.some((o) => o.value === status)) where.status = status;
    for (const key of ["supplierId", "rackId", "deviceId", "lineId"] as const) {
      const v = queryValue(req, key);
      if (v) where[key] = v;
    }
    const customerId = queryValue(req, "customerId");
    if (customerId) {
      where.allocations = {
        some: { releasedAt: null, customerId },
      };
    }
    const expireBefore = queryValue(req, "expireBefore");
    const expireAfter = queryValue(req, "expireAfter");
    if (expireBefore || expireAfter) {
      where.expireDate = {
        not: null,
        ...(expireBefore ? { lte: expireBefore } : {}),
        ...(expireAfter ? { gte: expireAfter } : {}),
      };
    }

    const [items, total] = await Promise.all([
      prisma.broadband.findMany({
        where,
        orderBy: [{ status: "asc" }, { name: "asc" }],
        skip: paging.skip,
        take: paging.pageSize,
        include: {
          supplier: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          rack: { select: { id: true, code: true, location: true, uStart: true, uEnd: true } },
          device: { select: { id: true, name: true } },
          line: { select: { id: true, code: true, name: true } },
          ipAddress: { select: { id: true, address: true } },
          allocations: {
            where: { releasedAt: null },
            select: {
              id: true,
              customerId: true,
              customer: { select: { id: true, name: true } },
              allocatedMbps: true,
              allocatedAt: true,
              uStart: true,
              uEnd: true,
            },
          },
          _count: { select: { allocations: true } },
        },
      }),
      prisma.broadband.count({ where }),
    ]);
    const rows = items.map((item) => {
      const allocatedMbps = item.allocations.reduce(
        (sum, allocation) => sum + (allocation.allocatedMbps ?? 0),
        0,
      );
      const summary = summarizeAllocationCustomers(item.allocations);
      return {
        ...item,
        allocatedMbps,
        reusePercent: computeReusePercent(item.bandwidthMbps, allocatedMbps),
        customerSummary: summary.customerSummary,
        customerNames: summary.customerNames,
      };
    });
    return jsonOk(listResult(rows, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = broadbandSchema.parse(await readJson(req));
    const created = await prisma.$transaction(async (tx) => {
      const supplierId = await resolveSupplierForCreate(tx, body.supplierId);
      const dup = await tx.broadband.findUnique({ where: { name: body.name } });
      if (dup) {
        throw new ApiError(
          409,
          `宽带名称/编号「${body.name}」已存在`,
          "DUPLICATE_BROADBAND_NAME",
        );
      }
      const broadband = await tx.broadband.create({
        data: {
          name: body.name,
          supplierId,
          customerId: null,
          bandwidthMbps: body.bandwidthMbps ?? null,
          status: body.status,
          expireDate: body.expireDate ?? null,
          account: body.account ?? null,
          password: body.password ?? null,
          installAddress: body.installAddress ?? null,
          rackId: body.rackId ?? null,
          deviceId: body.deviceId ?? null,
          lineId: body.lineId ?? null,
          ipAddressId: body.ipAddressId ?? null,
          monthlyFeeCents: body.monthlyFeeCents ?? null,
          contractNo: body.contractNo ?? null,
          description: body.description ?? null,
          notes: body.notes ?? null,
        },
        include: { supplier: { select: { id: true, name: true } } },
      });
      await writeChangeLog(tx, {
        user,
        resource: "broadband",
        recordId: broadband.id,
        action: "CREATE",
        summary: `创建宽带 ${broadband.name}`,
        after: broadband,
      });
      return broadband;
    });
    return jsonOk(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
