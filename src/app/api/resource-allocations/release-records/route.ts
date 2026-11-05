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

/** IP 释放记录：已释放的分配明细，按释放时间倒序。 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const customerId = queryValue(req, "customerId");
    const batchId = queryValue(req, "releaseBatchId");
    const where: Prisma.ResourceAllocationItemWhereInput = {
      releasedAt: { not: null },
    };
    if (customerId) where.allocation = { customerId };
    if (batchId) where.releaseBatchId = batchId;
    if (paging.keyword) {
      where.OR = [
        { address: { contains: paging.keyword } },
        { releaseNote: { contains: paging.keyword } },
        { releasedByName: { contains: paging.keyword } },
        { releaseBatchId: { contains: paging.keyword } },
        { allocation: { resourceName: { contains: paging.keyword } } },
        { allocation: { customer: { name: { contains: paging.keyword } } } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.resourceAllocationItem.findMany({
        where,
        orderBy: [{ releasedAt: "desc" }, { address: "asc" }],
        skip: paging.skip,
        take: paging.pageSize,
        select: {
          id: true,
          address: true,
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
      prisma.resourceAllocationItem.count({ where }),
    ]);
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}
