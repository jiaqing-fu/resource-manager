import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handleApiError, jsonOk, readJson, requireUser } from "@/lib/api";
import { resourceAllocationReleaseSchema } from "@/lib/resource-allocation-schema";
import { releaseAllocation } from "@/server/services/allocations";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = resourceAllocationReleaseSchema.parse(await readJson(req));
    const result = await prisma.$transaction(async (tx) => {
      const released = await releaseAllocation(tx, id, {
        releasedAt: body.releasedAt,
        ipList: body.ipList,
        uList: body.uList,
        releaseNote: body.releaseNote,
        releasedByName: user.displayName,
      });
      const unit =
        released.before.resourceType === "ipRange"
          ? "个 IP"
          : released.before.resourceType === "rack"
            ? "个 U 位"
            : "项";
      const summary =
        released.releasedCount > 0
          ? `释放客户 ${released.customer.name} 的资源 ${released.before.resourceName} 中 ${released.releasedCount} ${unit}${
              released.parentReleased ? "" : `，剩余 ${released.remainingCount} 个`
            }`
          : `释放客户 ${released.customer.name} 的资源 ${released.before.resourceName}`;
      await writeChangeLog(tx, {
        user,
        resource: "resourceAllocation",
        recordId: id,
        action: "UPDATE",
        summary,
        before: {
          releasedAt: released.before.releasedAt,
          activeKey: released.before.activeKey,
        },
        after: {
          releasedAt: released.allocation.releasedAt,
          releasedCount: released.releasedCount,
          remainingCount: released.remainingCount,
          releaseBatchId: released.releaseBatchId,
        },
      });
      return released;
    });
    return jsonOk({
      allocation: result.allocation,
      releasedCount: result.releasedCount,
      remainingCount: result.remainingCount,
      releaseBatchId: result.releaseBatchId,
      parentReleased: result.parentReleased,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
