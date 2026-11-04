import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { getNotificationMailConfig } from "@/server/services/notification-config";

export function getNotificationStorageDir(): string {
  const configured = getNotificationMailConfig().storageDir;
  return isAbsolute(configured)
    ? configured
    : resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

/** 文件名只由通知 id 派生，不信任数据库里的路径字段。 */
export function docxFilenameForId(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("通知 ID 不合法，无法定位本地文档");
  }
  return `notification-${id}.docx`;
}

function docxPathForId(id: string): string {
  const dir = getNotificationStorageDir();
  const filename = docxFilenameForId(id);
  const full = resolve(dir, filename);
  if (basename(full) !== filename || !full.startsWith(`${dir}${sep}`)) {
    throw new Error("通知文档路径不合法");
  }
  return full;
}

async function ensureStorageDir(): Promise<string> {
  const dir = getNotificationStorageDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** 原子写入本地 Word 副本：先写临时文件，再 rename。 */
export async function writeNotificationDocx(id: string, buffer: Buffer): Promise<string> {
  await ensureStorageDir();
  const target = docxPathForId(id);
  const temp = join(
    getNotificationStorageDir(),
    `.${docxFilenameForId(id)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await writeFile(temp, buffer, { mode: 0o600 });
  await rename(temp, target);
  return docxFilenameForId(id);
}

export async function readNotificationDocx(id: string): Promise<Buffer | null> {
  try {
    return await readFile(docxPathForId(id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** 删除本地副本；失败不抛出，避免影响数据库清理。 */
export async function deleteNotificationDocx(id: string): Promise<void> {
  try {
    await unlink(docxPathForId(id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[notifications] failed to delete local docx", error);
    }
  }
}
