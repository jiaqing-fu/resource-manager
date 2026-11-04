import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, requireUser } from "@/lib/api";
import { buildBlockTree, findTreeNode } from "@/server/services/ipam";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const tree = await buildBlockTree(prisma);
    const node = findTreeNode(tree, id);
    if (!node) throw new ApiError(404, "IP 段不存在", "NOT_FOUND");
    return jsonOk({ items: node.children, parent: { id: node.id, cidr: node.cidr } });
  } catch (error) {
    return handleApiError(error);
  }
}
