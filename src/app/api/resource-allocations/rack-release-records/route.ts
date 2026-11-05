import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  getPaging,
  handleApiError,
  jsonOk,
  listResult,
  queryValue,
  requireUser,
} from "@/lib/api";

export const dynamic = "force-dynamic";

/** 机柜 U 位释放记录：已释放的机柜分配明细，按释放时间倒序。 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const customerId = queryValue(req, "customerId");
    const batchId = queryValue(req, "releaseBatchId");
    const where: Prisma.RackAllocationItemWhereInput = {
      releasedAt: { not: null },
    };
    if (customerId) where.allocation = { customerId };
    if (batchId) where.releaseBatchId = batchId;
    if (paging.keyword) {
      const kw = paging.keyword;
      const or: Prisma.RackAllocationItemWhereInput[] = [
        { releaseNote: { contains: kw } },
        { releasedByName: { contains: kw } },
        { releaseBatchId: { contains: kw } },
        { allocation: { resourceName: { contains: kw } } },
        { allocation: { customer: { name: { contains: kw } } } },
      ];
      const unit = Number(kw.replace(/^u/i, ""));
      if (Number.isInteger(unit) && unit > 0) {
        or.push({ uNumber: unit });
      }
      where.OR = or;
    }

    const [items, total] = await Promise.all([
      prisma.rackAllocationItem.findMany({
        where,
        orderBy: [{ releasedAt: "desc" }, { uNumber: "asc" }],
        skip: paging.skip,
        take: paging.pageSize,
        select: {
          id: true,
          uNumber: true,
          releasedAt: true,
          releaseBatchId: true,
          releaseNote: true,
          releasedByName: true,
          allocation: {
            select: {
              id: true,
              resourceName: true,
              customer: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.rackAllocationItem.count({ where }),
    ]);
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}
