import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pragmaReady?: Promise<void>;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

async function applyPragmas(client: PrismaClient) {
  try {
    // 这三个 PRAGMA 都会返回结果，Prisma 的 execute 不接受结果集，需用 query。
    await client.$queryRawUnsafe("PRAGMA journal_mode=WAL");
    await client.$queryRawUnsafe("PRAGMA busy_timeout=5000");
    await client.$queryRawUnsafe("PRAGMA foreign_keys=ON");
  } catch (e) {
    console.error("[db] failed to apply SQLite pragmas", e);
  }
}

/** 确保 WAL / busy_timeout / 外键约束已生效（单进程只执行一次）。 */
export function ensurePragmas(client: PrismaClient = prisma): Promise<void> {
  if (!globalForPrisma.pragmaReady) {
    globalForPrisma.pragmaReady = applyPragmas(client);
  }
  return globalForPrisma.pragmaReady;
}
