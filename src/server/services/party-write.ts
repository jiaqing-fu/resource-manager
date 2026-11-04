import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { PARTY_STATUS } from "@/lib/enums";
import {
  booleanField,
  nullableId,
  optionalText,
  requiredText,
  zEnum,
} from "@/lib/validators";
import type { PartyKind } from "@/server/services/party";

type Tx = Prisma.TransactionClient;

export const partyBaseSchema = z.object({
  name: requiredText("名称", 100),
  level: z.coerce.number().int().min(1, "层级只能是一级或二级").max(2, "层级只能是一级或二级"),
  parentId: nullableId,
  status: zEnum(PARTY_STATUS, "状态").default("active"),
  contactName: optionalText(50),
  phone: optionalText(50),
  email: optionalText(100),
  address: optionalText(200),
  notes: optionalText(1000),
});

export const contactSchema = z.object({
  name: requiredText("联系人姓名", 50),
  role: optionalText(50),
  phone: optionalText(50),
  email: optionalText(100),
  wechat: optionalText(50),
  isPrimary: booleanField.default(false),
  notes: optionalText(500),
});

export type ContactInput = z.infer<typeof contactSchema>;

interface PartyNameDelegate {
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

function delegate(tx: Tx, kind: PartyKind): PartyNameDelegate {
  return (kind === "supplier" ? tx.supplier : tx.customer) as unknown as PartyNameDelegate;
}

/** 同一层级、同一上级下名称不重复；一级供应商/客户全局不重名。 */
export async function assertNameUnique(
  tx: Tx,
  kind: PartyKind,
  name: string,
  level: number,
  parentId: string | null,
  excludeId?: string,
): Promise<void> {
  const count = await delegate(tx, kind).count({
    where: {
      name,
      level,
      parentId: level === 1 ? null : parentId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (count > 0) {
    const label = kind === "supplier" ? "供应商" : "客户";
    throw new ApiError(409, `${label}名称「${name}」已存在`, "DUPLICATE_NAME");
  }
}

/** 覆盖式保存联系人；调用方已确认最多一个主要联系人。 */
export async function replaceContacts(
  tx: Tx,
  supplierId: string,
  contacts: ContactInput[],
): Promise<void> {
  if (contacts.filter((c) => c.isPrimary).length > 1) {
    throw new ApiError(422, "只能设置一个主要联系人", "MULTIPLE_PRIMARY_CONTACTS");
  }
  await tx.supplierContact.deleteMany({ where: { supplierId } });
  if (contacts.length > 0) {
    await tx.supplierContact.createMany({
      data: contacts.map((c) => ({
        supplierId,
        name: c.name,
        role: c.role ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
        wechat: c.wechat ?? null,
        isPrimary: c.isPrimary,
        notes: c.notes ?? null,
      })),
    });
  }
}
