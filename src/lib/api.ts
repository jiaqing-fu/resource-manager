import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { assertSameOrigin, getSessionUser, type SessionUser } from "@/lib/auth";
import { ensurePragmas } from "@/lib/db";

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;

  constructor(status: number, message: string, code = "ERROR", fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function jsonError(
  status: number,
  message: string,
  code = "ERROR",
  fields?: Record<string, string>,
): NextResponse {
  return NextResponse.json({ error: { code, message, fields } }, { status });
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return jsonError(error.status, error.message, error.code, error.fields);
  }
  if (error instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) {
      const key = issue.path.map(String).join(".") || "_";
      if (!fields[key]) fields[key] = issue.message;
    }
    const first = error.issues[0]?.message ?? "输入校验失败";
    return jsonError(422, first, "VALIDATION_ERROR", fields);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = Array.isArray(error.meta?.target)
        ? (error.meta?.target as string[]).join("、")
        : String(error.meta?.target ?? "唯一字段");
      if (target.includes("vni")) {
        return jsonError(409, "该 VXLAN VNI 已存在，请刷新后重试", "DUPLICATE_VXLAN_VNI");
      }
      if (target.includes("vid")) {
        return jsonError(
          409,
          "该供应商下 VLAN ID 已存在，请刷新后重试",
          "DUPLICATE_VID",
        );
      }
      if (target.includes("activeKey")) {
        return jsonError(
          409,
          "该资源已有未释放的分配记录，请刷新后重试",
          "RESOURCE_ALREADY_ALLOCATED",
        );
      }
      if (target.includes("name")) {
        return jsonError(409, "宽带名称/编号已存在", "DUPLICATE_BROADBAND_NAME");
      }
      if (target.includes("uStart") || target.includes("uEnd")) {
        return jsonError(409, "该机柜区间已存在，请刷新后重试", "DUPLICATE_RACK_RANGE");
      }
      if (target.includes("code")) {
        return jsonError(409, "编号已存在，请刷新后重试", "DUPLICATE_CODE");
      }
      return jsonError(409, `唯一性冲突：${target} 已存在`, "UNIQUE_CONFLICT");
    }
    if (error.code === "P2003" || error.code === "P2014") {
      return jsonError(409, "该记录仍被其他数据引用，无法删除或修改", "FOREIGN_KEY_CONFLICT");
    }
    if (error.code === "P2025") {
      return jsonError(404, "记录不存在或已被删除", "NOT_FOUND");
    }
  }
  if (error instanceof Error && error.message === "请求来源校验失败") {
    return jsonError(403, "请求来源校验失败", "ORIGIN_REJECTED");
  }
  console.error("[api] unhandled error", error);
  return jsonError(500, "服务器内部错误", "INTERNAL_ERROR");
}

/** 解析并校验 JSON 请求体。 */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "请求体不是合法的 JSON", "BAD_REQUEST");
  }
}

export async function requireUser(req: NextRequest): Promise<SessionUser> {
  await ensurePragmas();
  const user = await getSessionUser(req);
  if (!user) throw new ApiError(401, "请先登录", "UNAUTHORIZED");
  assertSameOrigin(req);
  return user;
}

export async function requireAdmin(req: NextRequest): Promise<SessionUser> {
  const user = await requireUser(req);
  if (user.role !== "ADMIN") {
    throw new ApiError(403, "该操作仅管理员可执行", "FORBIDDEN");
  }
  return user;
}

export type Paging = {
  page: number;
  pageSize: number;
  keyword: string;
  skip: number;
};

export function getPaging(req: NextRequest): Paging {
  const sp = req.nextUrl.searchParams;
  const pageRaw = Number.parseInt(sp.get("page") ?? "1", 10);
  const pageSizeRaw = Number.parseInt(sp.get("pageSize") ?? "20", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize = Number.isFinite(pageSizeRaw)
    ? Math.min(200, Math.max(1, pageSizeRaw))
    : 20;
  return {
    page,
    pageSize,
    keyword: (sp.get("keyword") ?? "").trim(),
    skip: (page - 1) * pageSize,
  };
}

export function listResult<T>(items: T[], total: number, paging: Paging) {
  return { items, total, page: paging.page, pageSize: paging.pageSize };
}

export function queryValue(req: NextRequest, key: string): string | undefined {
  const v = req.nextUrl.searchParams.get(key);
  return v === null || v === "" ? undefined : v;
}

export function sortParams(
  req: NextRequest,
  allowed: Record<string, string>,
  fallback: string,
): { orderBy: Record<string, "asc" | "desc"> } {
  const sortBy = req.nextUrl.searchParams.get("sortBy") ?? "";
  const sortOrder = req.nextUrl.searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
  const field = allowed[sortBy];
  return { orderBy: { [field ?? fallback]: sortOrder } };
}
