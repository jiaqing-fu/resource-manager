import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE = "rm_session";
export const SESSION_MAX_AGE = 8 * 60 * 60; // 8 小时

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "USER";
};

type TokenPayload = {
  sub: string;
  username: string;
  role: string;
  tv: number;
};

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("AUTH_SECRET 未配置或长度不足（至少 32 个字符）");
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signSession(user: {
  id: string;
  username: string;
  role: string;
  tokenVersion: number;
}): Promise<string> {
  const payload: TokenPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    tv: user.tokenVersion,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

export async function getUserFromToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  let payload: TokenPayload;
  try {
    const verified = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    payload = verified.payload as unknown as TokenPayload;
  } catch {
    return null;
  }
  if (!payload.sub) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      active: true,
      tokenVersion: true,
    },
  });
  if (!user || !user.active || user.tokenVersion !== payload.tv) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role === "ADMIN" ? "ADMIN" : "USER",
  };
}

export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  return getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
}

/** 写操作 Origin 校验，防止跨站请求伪造。 */
export function assertSameOrigin(req: NextRequest): void {
  const method = req.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // 非浏览器客户端（curl 等）不强制
  try {
    const originHost = new URL(origin).host;
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!host || originHost !== host) {
      throw new Error("请求来源校验失败");
    }
  } catch {
    throw new Error("请求来源校验失败");
  }
}

// —— 登录失败限流（单进程内存实现） ——
type Attempt = { count: number; lockedUntil: number };
const loginAttempts = new Map<string, Attempt>();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

export function loginRateKey(req: NextRequest, username: string): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";
  return `${ip}|${username}`;
}

export function checkLoginAllowed(key: string): { allowed: boolean; retryAfterSec: number } {
  const a = loginAttempts.get(key);
  if (!a) return { allowed: true, retryAfterSec: 0 };
  if (a.lockedUntil > Date.now()) {
    return { allowed: false, retryAfterSec: Math.ceil((a.lockedUntil - Date.now()) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function recordLoginFailure(key: string): void {
  const a = loginAttempts.get(key) ?? { count: 0, lockedUntil: 0 };
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) {
    a.lockedUntil = Date.now() + LOCK_MS;
    a.count = 0;
  }
  loginAttempts.set(key, a);
}

export function clearLoginFailures(key: string): void {
  loginAttempts.delete(key);
}
