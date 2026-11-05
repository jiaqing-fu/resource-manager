import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handleApiError, jsonOk, readJson, requireUser } from "@/lib/api";
import { resourceAllocationBatchReleaseSchema } from "@/lib/resource-allocation-schema";
import { releaseAllocations } from "@/server/services/allocations";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

/** 批量释放多条分配记录（整条释放），共用同一释放批次。 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = resourceAllocationBatchReleaseSchema.parse(await readJson(req));
    const result = await prisma.$transaction(
      async (tx) => {
        const released = await releaseAllocations(tx, {
          ids: body.ids,
          releasedAt: body.releasedAt,
          releaseNote: body.releaseNote,
          releasedByName: user.displayName,
        });
        for (const row of released.results) {
          const unit =
            row.resourceType === "ipRange"
              ? "个 IP"
              : row.resourceType === "rack"
                ? "个 U 位"
                : "项";
          await writeChangeLog(tx, {
            user,
            resource: "resourceAllocation",
            recordId: row.id,
            action: "UPDATE",
            summary:
              row.releasedCount > 0
                ? `批量释放客户 ${row.customerName} 的资源 ${row.resourceName} 中 ${row.releasedCount} ${unit}（批次 ${released.releaseBatchId.slice(0, 8)}）`
                : `批量释放客户 ${row.customerName} 的资源 ${row.resourceName}`,
            after: {
              releasedAt: body.releasedAt,
              releasedCount: row.releasedCount,
              remainingCount: row.remainingCount,
              releaseBatchId: released.releaseBatchId,
            },
          });
        }
        return released;
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
    return jsonOk(result);
  } catch (error) {
    return handleApiError(error);
  }
}
