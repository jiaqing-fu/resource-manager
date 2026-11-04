import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  handleApiError,
  jsonOk,
  readJson,
  requireUser,
} from "@/lib/api";
import { resourceAllocationBulkSchema } from "@/lib/resource-allocation-schema";
import {
  saveBatchAllocations,
  type AllocationResourceType,
} from "@/server/services/allocations";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

/** 多客户、多资源批量保存：一个事务内先释放全部、再新增全部。 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = resourceAllocationBulkSchema.parse(await readJson(req));
    const result = await prisma.$transaction(async (tx) => {
      const saved = await saveBatchAllocations(tx, {
        allocatedAt: body.allocatedAt,
        releasedAt: body.releasedAt,
        notes: body.notes,
        groups: body.groups.map((group) => ({
          ...group,
          creates: group.creates.map((create) => ({
            ...create,
            resourceType: create.resourceType as AllocationResourceType,
          })),
        })),
      });
      for (const create of saved.creates) {
        await writeChangeLog(tx, {
          user,
          resource: "resourceAllocation",
          recordId: create.id,
          action: "CREATE",
          summary: `分配 ${create.resourceName} 给客户 ${create.customerName}`,
          after: {
            id: create.id,
            customerId: create.customerId,
            resourceType: create.resourceType,
            resourceId: create.resourceId,
            resourceName: create.resourceName,
            allocatedAt: create.allocatedAt,
          },
        });
      }
      for (const release of saved.releases) {
        await writeChangeLog(tx, {
          user,
          resource: "resourceAllocation",
          recordId: release.id,
          action: "UPDATE",
          summary: `释放客户 ${release.customerName} 的资源 ${release.resourceName}`,
          before: { releasedAt: null },
          after: { releasedAt: release.releasedAt },
        });
      }
      return saved;
    });
    return jsonOk({
      created: result.created,
      released: result.released,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
