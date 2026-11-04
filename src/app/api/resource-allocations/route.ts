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
import { resourceAllocationSchema } from "@/lib/resource-allocation-schema";
import { allocationDisplayName } from "@/lib/allocation-display";
import {
  createAllocation,
  isAllocationResourceType,
} from "@/server/services/allocations";
import { writeChangeLog } from "@/lib/changelog";
import { ApiError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const where: Prisma.ResourceAllocationWhereInput = {};
    const customerId = queryValue(req, "customerId");
    const resourceType = queryValue(req, "resourceType");
    const status = queryValue(req, "status");
    if (customerId) where.customerId = customerId;
    if (resourceType && isAllocationResourceType(resourceType)) {
      where.resourceType = resourceType;
    }
    if (status === "active") where.releasedAt = null;
    else if (status === "released") where.releasedAt = { not: null };

    if (paging.keyword) {
      const kw = paging.keyword;
      where.OR = [
        { resourceName: { contains: kw } },
        { supplierName: { contains: kw } },
        { notes: { contains: kw } },
        { customer: { is: { name: { contains: kw } } } },
        { rack: { is: { code: { contains: kw } } } },
        { ipBlock: { is: { cidr: { contains: kw } } } },
        { ipAddress: { is: { address: { contains: kw } } } },
        { vlan: { is: { name: { contains: kw } } } },
        { vxlan: { is: { name: { contains: kw } } } },
        { broadband: { is: { name: { contains: kw } } } },
        { line: { is: { code: { contains: kw } } } },
        { device: { is: { name: { contains: kw } } } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.resourceAllocation.findMany({
        where,
        orderBy: [{ allocatedAt: "desc" }, { createdAt: "desc" }],
        skip: paging.skip,
        take: paging.pageSize,
        include: {
          customer: { select: { id: true, name: true } },
          rack: { select: { id: true, code: true, location: true, uStart: true, uEnd: true } },
          ipBlock: { select: { id: true, cidr: true } },
          ipAddress: { select: { id: true, address: true } },
          vlan: { select: { id: true, vid: true, name: true } },
          vxlan: { select: { id: true, vni: true, name: true } },
          broadband: { select: { id: true, name: true } },
          line: { select: { id: true, code: true, name: true } },
          device: { select: { id: true, name: true } },
        },
      }),
      prisma.resourceAllocation.count({ where }),
    ]);
    const items = rows.map((row) => ({
      ...row,
      currentResourceName: allocationDisplayName(row),
    }));
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = resourceAllocationSchema.parse(await readJson(req));
    if (!isAllocationResourceType(body.resourceType)) {
      throw new ApiError(422, "资源类型不合法", "INVALID_RESOURCE_TYPE");
    }
    const resourceType = body.resourceType;
    const result = await prisma.$transaction(async (tx) => {
      const created = await createAllocation(tx, {
        customerId: body.customerId,
        resourceType,
        resourceId: body.resourceId,
        allocatedAt: body.allocatedAt,
        notes: body.notes,
        uStart: body.uStart,
        uEnd: body.uEnd,
        allocatedMbps: body.allocatedMbps,
      });
      await writeChangeLog(tx, {
        user,
        resource: "resourceAllocation",
        recordId: created.allocation.id,
        action: "CREATE",
        summary: `分配 ${created.resource.name} 给客户 ${created.customer.name}`,
        after: {
          id: created.allocation.id,
          customerId: created.customer.id,
          resourceType,
          resourceId: body.resourceId,
          allocatedAt: created.allocation.allocatedAt,
        },
      });
      return created;
    });
    return jsonOk(result.allocation, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
