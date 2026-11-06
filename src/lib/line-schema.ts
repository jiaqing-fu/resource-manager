import { z } from "zod";
import { LINE_SIDES, LINE_STATUS, LINE_TYPES } from "@/lib/enums";
import {
  nullableDateStr,
  nullableId,
  optionalText,
  requiredText,
  zEnum,
} from "@/lib/validators";

const nonNegativeInt = z.preprocess(
  (v) => (v === "" || v === null ? null : v),
  z.coerce.number().int("请输入整数").min(0, "不能为负数").nullable().optional(),
);

export const terminationSchema = z.object({
  side: zEnum(LINE_SIDES, "端点侧"),
  rackId: nullableId,
  deviceId: nullableId,
  port: optionalText(100),
  description: optionalText(200),
});

export const lineSchema = z.object({
  code: requiredText("线路编号", 100),
  name: requiredText("线路名称", 100),
  type: zEnum(LINE_TYPES, "线路类型").default("internet"),
  status: zEnum(LINE_STATUS, "线路状态").default("active"),
  supplierId: nullableId,
  customerId: nullableId,
  bandwidthMbps: nonNegativeInt,
  monthlyFeeCents: nonNegativeInt,
  circuitNo: optionalText(100),
  installDate: nullableDateStr,
  expireDate: nullableDateStr,
  description: optionalText(1000),
  terminations: z.array(terminationSchema).max(2, "每条线路最多 A/Z 两个端点").optional(),
});

export const lineUpdateSchema = z.object({
  code: requiredText("线路编号", 100).optional(),
  name: requiredText("线路名称", 100).optional(),
  type: zEnum(LINE_TYPES, "线路类型").optional(),
  status: zEnum(LINE_STATUS, "线路状态").optional(),
  supplierId: nullableId,
  bandwidthMbps: nonNegativeInt,
  monthlyFeeCents: nonNegativeInt,
  circuitNo: optionalText(100),
  installDate: nullableDateStr,
  expireDate: nullableDateStr,
  description: optionalText(1000),
  terminations: z.array(terminationSchema).max(2).optional(),
});
