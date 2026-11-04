import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handleApiError, jsonOk, requireUser } from "@/lib/api";
import { computeReusePercent } from "@/lib/broadband";

export const dynamic = "force-dynamic";

/** 全部宽带的复用率概览，不受列表分页与筛选影响。 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const items = await prisma.broadband.findMany({
      select: {
        id: true,
        name: true,
        bandwidthMbps: true,
        supplier: { select: { id: true, name: true } },
        allocations: {
          where: { releasedAt: null },
          select: { allocatedMbps: true },
        },
      },
    });
    const rows = items
      .map((item) => {
        const allocatedMbps = item.allocations.reduce(
          (sum, allocation) => sum + (allocation.allocatedMbps ?? 0),
          0,
        );
        return {
          id: item.id,
          name: item.name,
          supplierName: item.supplier?.name ?? null,
          bandwidthMbps: item.bandwidthMbps,
          allocatedMbps,
          reusePercent: computeReusePercent(item.bandwidthMbps, allocatedMbps),
        };
      })
      .sort((a, b) => {
        if (a.reusePercent === null && b.reusePercent === null) {
          return a.name.localeCompare(b.name, "zh-CN");
        }
        if (a.reusePercent === null) return 1;
        if (b.reusePercent === null) return -1;
        return b.reusePercent - a.reusePercent || a.name.localeCompare(b.name, "zh-CN");
      });
    return jsonOk(rows);
  } catch (error) {
    return handleApiError(error);
  }
}
