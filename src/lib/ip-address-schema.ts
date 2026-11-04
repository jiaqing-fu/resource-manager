import { z } from "zod";
import { IP_ADDRESS_ROLES, IP_ADDRESS_STATUS } from "@/lib/enums";
import {
  booleanField,
  nullableDateStr,
  nullableId,
  optionalText,
  requiredText,
  zEnum,
} from "@/lib/validators";

export const ipAddressSchema = z.object({
  address: requiredText("IP 地址", 100),
  status: zEnum(IP_ADDRESS_STATUS, "IP 状态").default("active"),
  role: zEnum(IP_ADDRESS_ROLES, "IP 角色").default("other"),
  blockId: nullableId,
  supplierId: nullableId,
  rackId: nullableId,
  deviceId: nullableId,
  lineId: nullableId,
  isPrimary: booleanField.default(false),
  dnsName: optionalText(200),
  description: optionalText(500),
  assignedAt: nullableDateStr,
});

export const ipAddressUpdateSchema = z.object({
  address: requiredText("IP 地址", 100).optional(),
  status: zEnum(IP_ADDRESS_STATUS, "IP 状态").optional(),
  role: zEnum(IP_ADDRESS_ROLES, "IP 角色").optional(),
  blockId: nullableId,
  supplierId: nullableId,
  rackId: nullableId,
  deviceId: nullableId,
  lineId: nullableId,
  isPrimary: booleanField.optional(),
  dnsName: optionalText(200),
  description: optionalText(500),
  assignedAt: nullableDateStr,
});
