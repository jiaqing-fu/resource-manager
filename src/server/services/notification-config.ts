import { isValidEmail } from "@/lib/email";
import type { PublicNotificationMailConfig } from "@/lib/types";

export type NotificationMailConfig = {
  configured: boolean;
  issue: string | null;
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string } | null;
  fromAddress: string;
  fromName: string | null;
  defaultTo: string;
  storageDir: string;
};

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function parseBool(value: string): boolean | null {
  const v = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return null;
}

function parseFrom(value: string): { address: string; name: string | null } {
  const match = /^(.*?)\s*<([^<>]+)>\s*$/.exec(value);
  if (match) {
    return { address: match[2].trim(), name: match[1].trim() || null };
  }
  return { address: value, name: null };
}

/** 读取 SMTP 配置；不导入 nodemailer，可被服务端页面安全使用。 */
export function getNotificationMailConfig(): NotificationMailConfig {
  const host = env("SMTP_HOST");
  const portRaw = env("SMTP_PORT");
  const port = portRaw ? Number.parseInt(portRaw, 10) : 465;
  const secureRaw = env("SMTP_SECURE");
  const secure = parseBool(secureRaw) ?? port === 465;
  const user = env("SMTP_USER");
  const pass = process.env.SMTP_PASS ?? "";
  const fromRaw = env("SMTP_FROM");
  const fromNameEnv = env("SMTP_FROM_NAME");
  const defaultTo = env("NOTIFICATION_DEFAULT_TO");
  const storageDir = env("NOTIFICATION_STORAGE_DIR") || "data/notifications";

  const issues: string[] = [];
  if (!host) issues.push("未配置 SMTP_HOST");
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    issues.push("SMTP_PORT 必须是 1-65535 的整数");
  }
  if (Boolean(user) !== Boolean(pass)) {
    issues.push("SMTP_USER 与 SMTP_PASS 必须同时配置或同时留空");
  }

  const parsedFrom = fromRaw ? parseFrom(fromRaw) : null;
  const fromAddress = parsedFrom?.address || user;
  const fromName = parsedFrom?.name || fromNameEnv || null;
  if (!fromAddress) {
    issues.push("未配置发件地址（SMTP_FROM 或 SMTP_USER）");
  } else if (!isValidEmail(fromAddress)) {
    issues.push("SMTP_FROM 中的发件地址不是合法邮箱");
  }
  if (fromAddress && user && !isValidEmail(user)) {
    issues.push("SMTP_USER 不是合法邮箱地址");
  }

  return {
    configured: issues.length === 0,
    issue: issues.length > 0 ? issues.join("；") : null,
    host,
    port: Number.isFinite(port) && port >= 1 && port <= 65535 ? port : 465,
    secure,
    auth: user && pass ? { user, pass } : null,
    fromAddress,
    fromName,
    defaultTo,
    storageDir,
  };
}

/** 可安全返回给前端的配置，不包含密码、端口、主机与认证信息。 */
export function getPublicNotificationMailConfig(): PublicNotificationMailConfig {
  const config = getNotificationMailConfig();
  return {
    configured: config.configured,
    from: config.fromAddress || null,
    fromName: config.fromName,
    defaultTo: config.defaultTo,
    storageDir: config.storageDir,
    issue: config.issue,
  };
}
