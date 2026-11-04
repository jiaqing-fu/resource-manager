import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileStamp } from "../src/lib/dates";

const PROJECT_ROOT = resolve(__dirname, "..");

/** 按 Prisma 规则解析 SQLite 文件路径（相对路径以 prisma/ 为基准）。 */
function resolveDbPath(): string {
  let url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("未设置 DATABASE_URL，无法定位数据库文件。");
  if (!url.startsWith("file:")) throw new Error("DATABASE_URL 不是 SQLite file: 连接串。");
  url = url.slice("file:".length).split("?")[0];
  if (!url) throw new Error("DATABASE_URL 中缺少数据库文件路径。");
  return isAbsolute(url) ? url : resolve(PROJECT_ROOT, "prisma", url);
}

async function main() {
  try {
    loadEnvFile();
  } catch {
    // 没有 .env 时使用当前环境变量
  }

  const dbPath = resolveDbPath();
  if (!existsSync(dbPath)) {
    throw new Error(`数据库文件不存在：${dbPath}\n请先执行迁移：npm run db:deploy`);
  }

  const backupDir = resolve(PROJECT_ROOT, process.env.BACKUP_DIR?.trim() || "data/backups");
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  const stamp = fileStamp();
  let target = join(backupDir, `app-${stamp}.db`);
  for (let i = 1; existsSync(target); i += 1) {
    target = join(backupDir, `app-${stamp}-${i}.db`);
  }

  const { prisma } = await import("../src/lib/db");
  try {
    // VACUUM INTO 生成一致性快照，不需要停机。
    const escaped = target.replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${escaped}'`);
  } finally {
    await prisma.$disconnect();
  }

  const size = statSync(target).size;
  if (size === 0) throw new Error(`备份文件为空：${target}`);
  console.log(`备份完成：${target}（${(size / 1024 / 1024).toFixed(2)} MB）`);

  // 通知 Word 副本与数据库分开存储，必须一起备份。
  const storageSetting = process.env.NOTIFICATION_STORAGE_DIR?.trim() || "data/notifications";
  const notificationsDir = isAbsolute(storageSetting)
    ? storageSetting
    : resolve(PROJECT_ROOT, storageSetting);
  if (existsSync(notificationsDir)) {
    let docsTarget = join(backupDir, `notifications-${stamp}`);
    for (let i = 1; existsSync(docsTarget); i += 1) {
      docsTarget = join(backupDir, `notifications-${stamp}-${i}`);
    }
    cpSync(notificationsDir, docsTarget, { recursive: true });
    chmodSync(docsTarget, 0o700);
    console.log(`通知文档备份完成：${docsTarget}`);
  } else {
    console.log(`未发现通知文档目录，跳过：${notificationsDir}`);
  }

  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
  const keepDays = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 30;
  const cutoff = Date.now() - keepDays * 86_400_000;
  let removed = 0;
  for (const name of readdirSync(backupDir)) {
    const isDb = /^app-.*\.db$/.test(name);
    const isDocs = /^notifications-.*/.test(name);
    if (!isDb && !isDocs) continue;
    const full = join(backupDir, name);
    if (full === target) continue;
    const info = statSync(full);
    if (info.mtimeMs >= cutoff) continue;
    if (isDb && info.isFile()) {
      unlinkSync(full);
      removed += 1;
    } else if (isDocs && info.isDirectory()) {
      rmSync(full, { recursive: true, force: true });
      removed += 1;
    }
  }
  if (removed > 0) console.log(`已清理 ${removed} 个超过 ${keepDays} 天的旧备份。`);
  console.log(`备份目录：${backupDir}（保留最近 ${keepDays} 天）`);
}

main().catch((error) => {
  console.error("备份失败：", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
