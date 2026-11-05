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

/** 机柜分配明细（每个 U 位一条），供列表展开/详情查看。 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const allocation = await prisma.resourceAllocation.findUnique({
      where: { id },
      select: { id: true, resourceType: true },
    });
    if (!allocation) throw new ApiError(404, "分配记录不存在", "NOT_FOUND");
    if (allocation.resourceType !== "rack") {
      throw new ApiError(422, "该分配不是机柜分配", "NOT_RACK_ALLOCATION");
    }

    const paging = getPaging(req);
    const status = queryValue(req, "status");
    const where: Prisma.RackAllocationItemWhereInput = { allocationId: id };
    if (status === "active") where.releasedAt = null;
    else if (status === "released") where.releasedAt = { not: null };
    if (paging.keyword) {
      const kw = paging.keyword;
      const or: Prisma.RackAllocationItemWhereInput[] = [
        { releaseNote: { contains: kw } },
        { releasedByName: { contains: kw } },
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
        orderBy: { uNumber: "asc" },
        skip: paging.skip,
        take: paging.pageSize,
      }),
      prisma.rackAllocationItem.count({ where }),
    ]);
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}
