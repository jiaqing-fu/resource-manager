import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const allocation = await prisma.resourceAllocation.findUnique({
      where: { id },
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
    });
    if (!allocation) throw new ApiError(404, "分配记录不存在", "NOT_FOUND");
    return jsonOk(allocation);
  } catch (error) {
    return handleApiError(error);
  }
}
