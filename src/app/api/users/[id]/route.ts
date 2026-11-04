import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiError,
  handleApiError,
  jsonOk,
  readJson,
  requireAdmin,
} from "@/lib/api";
import { USER_ROLES } from "@/lib/enums";
import { hashPassword } from "@/lib/auth";
import { writeChangeLog } from "@/lib/changelog";
import { zEnum } from "@/lib/validators";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(50).optional(),
  role: zEnum(USER_ROLES, "角色").optional(),
  active: z.boolean().optional(),
  password: z.string().min(8, "密码至少 8 个字符").max(72).optional(),
});

type Params = { params: Promise<{ id: string }> };

async function countActiveAdmins(excludeId?: string) {
  return prisma.user.count({
    where: { role: "ADMIN", active: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    const body = patchSchema.parse(await readJson(req));
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new ApiError(404, "用户不存在", "NOT_FOUND");

    if (id === admin.id && body.active === false) {
      throw new ApiError(422, "不能停用自己的账号", "SELF_DISABLE");
    }
    if (id === admin.id && body.role === "USER") {
      throw new ApiError(422, "不能取消自己的管理员权限", "SELF_DEMOTE");
    }
    const losingAdmin =
      target.role === "ADMIN" &&
      target.active &&
      (body.role === "USER" || body.active === false);
    if (losingAdmin && (await countActiveAdmins(id)) === 0) {
      throw new ApiError(422, "系统至少需要保留一个启用的管理员", "LAST_ADMIN");
    }

    const data: Record<string, unknown> = {};
    if (body.displayName !== undefined) data.displayName = body.displayName;
    if (body.role !== undefined) data.role = body.role;
    if (body.active !== undefined) data.active = body.active;
    if (body.password !== undefined) data.passwordHash = await hashPassword(body.password);
    if (body.password !== undefined || body.active === false) {
      data.tokenVersion = { increment: 1 };
    }

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        active: true,
        updatedAt: true,
      },
    });
    await writeChangeLog(prisma, {
      user: admin,
      resource: "user",
      recordId: id,
      action: "UPDATE",
      summary: `修改用户 ${updated.username}${body.password ? "（重置密码）" : ""}`,
      after: updated,
    });
    return jsonOk(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    if (id === admin.id) {
      throw new ApiError(422, "不能删除自己的账号", "SELF_DELETE");
    }
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new ApiError(404, "用户不存在", "NOT_FOUND");
    if (target.role === "ADMIN" && target.active && (await countActiveAdmins(id)) === 0) {
      throw new ApiError(422, "系统至少需要保留一个启用的管理员", "LAST_ADMIN");
    }
    await prisma.user.delete({ where: { id } });
    await writeChangeLog(prisma, {
      user: admin,
      resource: "user",
      recordId: id,
      action: "DELETE",
      summary: `删除用户 ${target.username}`,
      before: {
        id: target.id,
        username: target.username,
        displayName: target.displayName,
        role: target.role,
      },
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
