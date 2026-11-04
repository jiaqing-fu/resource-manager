import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, readJson, requireUser } from "@/lib/api";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  hashPassword,
  signSession,
  verifyPassword,
} from "@/lib/auth";

const schema = z.object({
  oldPassword: z.string().min(1, "请输入原密码"),
  newPassword: z
    .string()
    .min(8, "新密码至少 8 个字符")
    .max(72, "新密码不能超过 72 个字符"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireUser(req);
    const body = schema.parse(await readJson(req));
    const user = await prisma.user.findUnique({ where: { id: session.id } });
    if (!user) throw new ApiError(401, "用户不存在", "UNAUTHORIZED");
    const ok = await verifyPassword(body.oldPassword, user.passwordHash);
    if (!ok) throw new ApiError(422, "原密码不正确", "BAD_OLD_PASSWORD");
    if (body.oldPassword === body.newPassword) {
      throw new ApiError(422, "新密码不能与原密码相同", "SAME_PASSWORD");
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(body.newPassword),
        tokenVersion: { increment: 1 },
      },
    });
    const token = await signSession(updated);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
      secure: process.env.COOKIE_SECURE === "1",
    });
    return res;
  } catch (error) {
    return handleApiError(error);
  }
}
