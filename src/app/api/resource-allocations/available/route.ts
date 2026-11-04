import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, requireUser } from "@/lib/api";
import {
  isAllocationResourceType,
  listAvailableResources,
} from "@/server/services/allocations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const resourceType = req.nextUrl.searchParams.get("resourceType") ?? "";
    if (!isAllocationResourceType(resourceType)) {
      throw new ApiError(422, "资源类型不合法", "INVALID_RESOURCE_TYPE");
    }
    const keyword = (req.nextUrl.searchParams.get("keyword") ?? "").trim();
    const items = await listAvailableResources(prisma, resourceType, keyword);
    return jsonOk({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
