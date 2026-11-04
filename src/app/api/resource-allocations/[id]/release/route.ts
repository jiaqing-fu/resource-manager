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
      const released = await releaseAllocation(tx, id, body.releasedAt);
      await writeChangeLog(tx, {
        user,
        resource: "resourceAllocation",
        recordId: id,
        action: "UPDATE",
        summary: `释放客户 ${released.customer.name} 的资源 ${released.before.resourceName}`,
        before: {
          releasedAt: released.before.releasedAt,
          activeKey: released.before.activeKey,
        },
        after: { releasedAt: released.allocation.releasedAt },
      });
      return released;
    });
    return jsonOk(result.allocation);
  } catch (error) {
    return handleApiError(error);
  }
}
