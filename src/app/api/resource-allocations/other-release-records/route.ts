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

/**
 * 其他资源的释放记录：非 IP 区间/机柜的分配按整条释放，
 * 释放备注、操作人与批次直接保存在分配记录上。
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const customerId = queryValue(req, "customerId");
    const batchId = queryValue(req, "releaseBatchId");
    const where: Prisma.ResourceAllocationWhereInput = {
      releasedAt: { not: null },
      resourceType: { notIn: ["ipRange", "rack"] },
    };
    if (customerId) where.customerId = customerId;
    if (batchId) where.releaseBatchId = batchId;
    if (paging.keyword) {
      const kw = paging.keyword;
      where.OR = [
        { resourceName: { contains: kw } },
        { supplierName: { contains: kw } },
        { notes: { contains: kw } },
        { releaseNote: { contains: kw } },
        { releasedByName: { contains: kw } },
        { releaseBatchId: { contains: kw } },
        { customer: { is: { name: { contains: kw } } } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.resourceAllocation.findMany({
        where,
        orderBy: [{ releasedAt: "desc" }, { createdAt: "desc" }],
        skip: paging.skip,
        take: paging.pageSize,
        select: {
          id: true,
          resourceType: true,
          resourceName: true,
          releasedAt: true,
          releaseBatchId: true,
          releaseNote: true,
          releasedByName: true,
          customer: { select: { id: true, name: true } },
        },
      }),
      prisma.resourceAllocation.count({ where }),
    ]);
    const items = rows.map((row) => ({
      id: row.id,
      resourceType: row.resourceType,
      releasedAt: row.releasedAt,
      releaseBatchId: row.releaseBatchId,
      releaseNote: row.releaseNote,
      releasedByName: row.releasedByName,
      allocation: {
        id: row.id,
        resourceName: row.resourceName,
        customer: row.customer,
      },
    }));
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}
