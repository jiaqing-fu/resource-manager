import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/auth";

type ChangeClient = {
  changeLog: {
    create: (args: Prisma.ChangeLogCreateArgs) => Promise<unknown>;
  };
};

export type ChangeAction = "CREATE" | "UPDATE" | "DELETE" | "IMPORT" | "SEND";

function serialize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "bigint") return v.toString();
    return v;
  });
}

/** 去掉敏感字段后记录变更。 */
export async function writeChangeLog(
  client: ChangeClient,
  params: {
    user?: SessionUser | null;
    username?: string;
    resource: string;
    recordId: string;
    action: ChangeAction;
    summary: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  const clean = (v: unknown) => {
    if (!v || typeof v !== "object") return v;
    const obj = { ...(v as Record<string, unknown>) };
    delete obj.passwordHash;
    delete obj.tokenVersion;
    return obj;
  };
  await client.changeLog.create({
    data: {
      userId: params.user?.id ?? null,
      username: params.user?.username ?? params.username ?? "system",
      resource: params.resource,
      recordId: params.recordId,
      action: params.action,
      summary: params.summary,
      before: serialize(clean(params.before)),
      after: serialize(clean(params.after)),
    },
  });
}
