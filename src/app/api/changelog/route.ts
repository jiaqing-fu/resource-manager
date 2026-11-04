import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  getPaging,
  handleApiError,
  jsonOk,
  listResult,
  queryValue,
  requireAdmin,
} from "@/lib/api";
import { CHANGE_ACTIONS } from "@/lib/enums";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const paging = getPaging(req);
    const where: Record<string, unknown> = {};
    if (paging.keyword) {
      where.OR = [
        { summary: { contains: paging.keyword } },
        { username: { contains: paging.keyword } },
        { recordId: { contains: paging.keyword } },
      ];
    }
    const resource = queryValue(req, "resource");
    const action = queryValue(req, "action");
    const username = queryValue(req, "username");
    if (resource) where.resource = resource;
    if (action && CHANGE_ACTIONS.some((a) => a.value === action)) where.action = action;
    if (username) where.username = username;
    const from = queryValue(req, "from");
    const to = queryValue(req, "to");
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(`${from}T00:00:00+08:00`) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59+08:00`) } : {}),
      };
    }

    const [items, total] = await Promise.all([
      prisma.changeLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: paging.skip,
        take: paging.pageSize,
      }),
      prisma.changeLog.count({ where }),
    ]);
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}
