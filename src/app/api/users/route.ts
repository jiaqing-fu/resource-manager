import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiError,
  getPaging,
  handleApiError,
  jsonOk,
  listResult,
  readJson,
  requireAdmin,
  sortParams,
} from "@/lib/api";
import { USER_ROLES } from "@/lib/enums";
import { hashPassword } from "@/lib/auth";
import { writeChangeLog } from "@/lib/changelog";
import { zEnum } from "@/lib/validators";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "用户名至少 3 个字符")
    .max(50, "用户名不能超过 50 个字符")
    .regex(/^[a-zA-Z0-9_.-]+$/, "用户名只能包含字母、数字、下划线、点和短横线"),
  password: z.string().min(8, "密码至少 8 个字符").max(72),
  displayName: z.string().trim().min(1, "请输入姓名").max(50),
  role: zEnum(USER_ROLES, "角色").default("USER"),
});

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const paging = getPaging(req);
    const where = paging.keyword
      ? {
          OR: [
            { username: { contains: paging.keyword } },
            { displayName: { contains: paging.keyword } },
          ],
        }
      : {};
    const { orderBy } = sortParams(req, { username: "username", createdAt: "createdAt" }, "createdAt");
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy,
        skip: paging.skip,
        take: paging.pageSize,
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          active: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const body = createSchema.parse(await readJson(req));
    const exists = await prisma.user.findUnique({ where: { username: body.username } });
    if (exists) throw new ApiError(409, "用户名已存在", "UNIQUE_CONFLICT");
    const user = await prisma.user.create({
      data: {
        username: body.username,
        passwordHash: await hashPassword(body.password),
        displayName: body.displayName,
        role: body.role,
      },
      select: { id: true, username: true, displayName: true, role: true, active: true },
    });
    await writeChangeLog(prisma, {
      user: admin,
      resource: "user",
      recordId: user.id,
      action: "CREATE",
      summary: `创建用户 ${user.username}`,
      after: user,
    });
    return jsonOk(user, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
