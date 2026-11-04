import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handleApiError, jsonOk, requireUser } from "@/lib/api";
import { buildBlockTree } from "@/server/services/ipam";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const tree = await buildBlockTree(prisma);
    return jsonOk({ items: tree });
  } catch (error) {
    return handleApiError(error);
  }
}
