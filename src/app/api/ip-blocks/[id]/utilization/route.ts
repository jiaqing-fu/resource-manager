import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handleApiError, jsonOk, requireUser } from "@/lib/api";
import { getBlockUtilization } from "@/server/services/ipam";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const node = await getBlockUtilization(prisma, id);
    return jsonOk({
      id: node.id,
      cidr: node.cidr,
      status: node.status,
      used: node.used,
      directUsed: node.directUsed,
      total: node.total,
      percent: node.percent,
      children: node.children.map((c) => ({
        id: c.id,
        cidr: c.cidr,
        used: c.used,
        total: c.total,
        percent: c.percent,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
