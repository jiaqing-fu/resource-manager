import { z } from "zod";
import { IP_BLOCK_ROLES, IP_BLOCK_STATUS } from "@/lib/enums";
import { nullableDateStr, nullableId, optionalText, requiredText, zEnum } from "@/lib/validators";

export const ipBlockSchema = z.object({
  cidr: requiredText("CIDR / IP 区间", 100),
  parentId: nullableId,
  status: zEnum(IP_BLOCK_STATUS, "网段状态").default("active"),
  role: zEnum(IP_BLOCK_ROLES, "网段角色").default("other"),
  vlanId: nullableId,
  supplierId: nullableId,
  gateway: optionalText(100),
  description: optionalText(500),
  assignedAt: nullableDateStr,
});

export const ipBlockUpdateSchema = z.object({
  cidr: requiredText("CIDR / IP 区间", 100).optional(),
  parentId: nullableId,
  status: zEnum(IP_BLOCK_STATUS, "网段状态").optional(),
  role: zEnum(IP_BLOCK_ROLES, "网段角色").optional(),
  vlanId: nullableId,
  supplierId: nullableId,
  gateway: optionalText(100),
  description: optionalText(500),
  assignedAt: nullableDateStr,
});
