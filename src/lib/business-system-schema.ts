import { z } from "zod";
import { CRITICALITIES, ENVIRONMENTS, PROTOCOLS, SYSTEM_STATUS } from "@/lib/enums";
import {
  booleanField,
  nullableDateStr,
  nullableId,
  optionalText,
  requiredText,
  zEnum,
} from "@/lib/validators";

const portField = z.preprocess(
  (v) => (v === "" || v === null ? null : v),
  z.coerce
    .number()
    .int("端口必须是整数")
    .min(1, "端口范围为 1-65535")
    .max(65535, "端口范围为 1-65535")
    .nullable()
    .optional(),
);

export const endpointSchema = z.object({
  ipAddressId: nullableId,
  ipText: optionalText(100),
  protocol: zEnum(PROTOCOLS, "协议").default("tcp"),
  port: portField,
  isPrimary: booleanField.default(false),
  description: optionalText(500),
});

export const endpointUpdateSchema = z.object({
  ipAddressId: nullableId,
  ipText: optionalText(100),
  protocol: zEnum(PROTOCOLS, "协议").optional(),
  port: portField,
  isPrimary: booleanField.optional(),
  description: optionalText(500),
});

export const businessSystemSchema = z.object({
  name: requiredText("系统名称", 100),
  code: optionalText(50),
  owner: requiredText("负责人", 50),
  department: optionalText(100),
  environment: zEnum(ENVIRONMENTS, "环境").default("prod"),
  criticality: zEnum(CRITICALITIES, "重要性").default("normal"),
  status: zEnum(SYSTEM_STATUS, "状态").default("active"),
  url: optionalText(500),
  domain: optionalText(200),
  onlineDate: nullableDateStr,
  description: optionalText(1000),
  endpoints: z.array(endpointSchema).max(100, "端点数量不能超过 100 个").optional(),
});

export const businessSystemUpdateSchema = z.object({
  name: requiredText("系统名称", 100).optional(),
  code: optionalText(50),
  owner: requiredText("负责人", 50).optional(),
  department: optionalText(100),
  environment: zEnum(ENVIRONMENTS, "环境").optional(),
  criticality: zEnum(CRITICALITIES, "重要性").optional(),
  status: zEnum(SYSTEM_STATUS, "状态").optional(),
  url: optionalText(500),
  domain: optionalText(200),
  onlineDate: nullableDateStr,
  description: optionalText(1000),
  endpoints: z.array(endpointSchema).max(100).optional(),
});
