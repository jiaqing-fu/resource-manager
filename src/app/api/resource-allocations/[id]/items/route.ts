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
  requireUser,
} from "@/lib/api";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** IP 分配明细（每个 IP 一条），供列表展开/详情查看。 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const allocation = await prisma.resourceAllocation.findUnique({
      where: { id },
      select: { id: true, resourceType: true },
    });
    if (!allocation) throw new ApiError(404, "分配记录不存在", "NOT_FOUND");
    if (allocation.resourceType !== "ipRange") {
      throw new ApiError(422, "该分配不是 IP 区间/集合分配", "NOT_IP_ALLOCATION");
    }

    const paging = getPaging(req);
    const status = queryValue(req, "status");
    const where: Prisma.ResourceAllocationItemWhereInput = { allocationId: id };
    if (status === "active") where.releasedAt = null;
    else if (status === "released") where.releasedAt = { not: null };
    if (paging.keyword) {
      where.OR = [
        { address: { contains: paging.keyword } },
        { releaseNote: { contains: paging.keyword } },
        { releasedByName: { contains: paging.keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.resourceAllocationItem.findMany({
        where,
        orderBy: { address: "asc" },
        skip: paging.skip,
        take: paging.pageSize,
        include: {
          ipAddress: {
            select: { id: true, address: true, dnsName: true, status: true },
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
