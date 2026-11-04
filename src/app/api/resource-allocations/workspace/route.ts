import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  ApiError,
  handleApiError,
  jsonOk,
  queryValue,
  requireUser,
} from "@/lib/api";
import { allocationDisplayName } from "@/lib/allocation-display";
import {
  ALLOCATION_RESOURCE_TYPES,
  listAvailableResources,
  type AllocationResourceType,
} from "@/server/services/allocations";

export const dynamic = "force-dynamic";

/** 单个客户的有效分配 + 9 类资源可选列表，供批量分配工作台使用。 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const customerId = queryValue(req, "customerId");
    if (!customerId) {
      throw new ApiError(422, "缺少客户参数", "CUSTOMER_REQUIRED");
    }

    const [allocations, resourceEntries] = await Promise.all([
      prisma.resourceAllocation.findMany({
        where: { customerId, releasedAt: null },
        orderBy: [{ resourceType: "asc" }, { allocatedAt: "desc" }],
        include: {
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
      Promise.all(
        ALLOCATION_RESOURCE_TYPES.map(async (resourceType) => [
          resourceType,
          await listAvailableResources(prisma, resourceType),
        ] as const),
      ),
    ]);

    const resources = Object.fromEntries(resourceEntries) as Record<
      AllocationResourceType,
      Awaited<ReturnType<typeof listAvailableResources>>
    >;

    return jsonOk({
      customerId,
      allocations: allocations.map((row) => ({
        ...row,
        currentResourceName: allocationDisplayName(row),
      })),
      resources,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
