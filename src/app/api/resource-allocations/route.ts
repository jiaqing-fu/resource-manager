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
import { parseIp } from "@/lib/ip";
import {
  createAllocation,
  isAllocationResourceType,
  loadIpAllocationCounts,
  loadRackAllocationCounts,
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
      const or: Prisma.ResourceAllocationWhereInput[] = [
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
      // 输入 IP 时，同时匹配包含该地址的区间/集合分配明细（含已释放明细）。
      const ip = parseIp(kw);
      if (ip) {
        or.push({
          resourceType: "ipRange",
          items: { some: { address: ip.canonical } },
        });
      }
      where.OR = or;
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
          ipBlock: {
            select: {
              id: true,
              cidr: true,
              kind: true,
              rangeStart: true,
              rangeEnd: true,
            },
          },
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
    const [ipCounts, rackCounts] = await Promise.all([
      loadIpAllocationCounts(
        prisma,
        rows
          .filter((row) => row.resourceType === "ipRange")
          .map((row) => row.id),
      ),
      loadRackAllocationCounts(
        prisma,
        rows
          .filter((row) => row.resourceType === "rack")
          .map((row) => row.id),
      ),
    ]);
    const items = rows.map((row) => {
      const ipCount = ipCounts.get(row.id);
      const rackCount = rackCounts.get(row.id);
      return {
        ...row,
        ipItemCount: ipCount?.total ?? 0,
        ipActiveCount: ipCount?.active ?? 0,
        rackItemCount: rackCount?.total ?? 0,
        rackActiveCount: rackCount?.active ?? 0,
        currentResourceName: allocationDisplayName({
          ...row,
          ipItemCount: ipCount?.total ?? 0,
          ipActiveCount: ipCount?.active ?? 0,
          rackItemCount: rackCount?.total ?? 0,
          rackActiveCount: rackCount?.active ?? 0,
        }),
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
        uList: body.uList,
        ipRangeStart: body.ipRangeStart,
        ipRangeEnd: body.ipRangeEnd,
        ipList: body.ipList,
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
    }, { maxWait: 10_000, timeout: 30_000 });
    return jsonOk(result.allocation, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
