import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, ensurePragmas } from "@/lib/db";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  assertSameOrigin,
  checkLoginAllowed,
  clearLoginFailures,
  loginRateKey,
  recordLoginFailure,
  signSession,
  verifyPassword,
} from "@/lib/auth";
import { ApiError, handleApiError, readJson } from "@/lib/api";

const schema = z.object({
  username: z.string().trim().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await ensurePragmas();
    const body = schema.parse(await readJson(req));
    const key = loginRateKey(req, body.username);
    const limited = checkLoginAllowed(key);
    if (!limited.allowed) {
      throw new ApiError(
        429,
        `登录失败次数过多，请 ${limited.retryAfterSec} 秒后重试`,
        "RATE_LIMITED",
      );
    }

    const user = await prisma.user.findUnique({ where: { username: body.username } });
    const ok = user && user.active ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !ok) {
      recordLoginFailure(key);
      throw new ApiError(401, "用户名或密码错误", "BAD_CREDENTIALS");
    }
    clearLoginFailures(key);
    const token = await signSession(user);
    const res = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    });
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
