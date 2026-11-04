import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { loadEnvFile } from "node:process";

/**
 * 初始化管理员账号。
 * 密码优先取 SEED_ADMIN_PASSWORD；未设置时随机生成并只打印一次。
 * 已有启用管理员时幂等退出。
 */
async function main() {
  try {
    loadEnvFile();
  } catch {
    // 没有 .env 时使用当前环境变量
  }
  mkdirSync("data", { recursive: true });

  const { prisma } = await import("../src/lib/db");
  const { hashPassword } = await import("../src/lib/auth");

  try {
    const activeAdmin = await prisma.user.findFirst({
      where: { role: "ADMIN", active: true },
      select: { username: true },
    });
    if (activeAdmin) {
      console.log(`已存在启用的管理员「${activeAdmin.username}」，跳过初始化。`);
      return;
    }

    const username = "admin";
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      console.error(
        "用户 admin 已存在但不是启用的管理员。请先人工检查数据库，或将现有账号提升为管理员。",
      );
      process.exitCode = 1;
      return;
    }

    const envPassword = process.env.SEED_ADMIN_PASSWORD?.trim();
    const password = envPassword || randomBytes(12).toString("base64url");
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: await hashPassword(password),
        displayName: "管理员",
        role: "ADMIN",
        active: true,
      },
      select: { username: true, displayName: true },
    });

    console.log("管理员已创建：");
    console.log(`  用户名：${user.username}`);
    if (envPassword) {
      console.log("  密码：使用 SEED_ADMIN_PASSWORD 环境变量中的值");
    } else {
      console.log(`  密码：${password}`);
      console.log("  ⚠ 该密码只显示这一次，请立即保存到密码管理器并登录后修改。");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("初始化失败：", error);
  process.exitCode = 1;
});
