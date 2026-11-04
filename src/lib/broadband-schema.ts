import { z } from "zod";
import { BROADBAND_STATUS } from "@/lib/enums";
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

export const broadbandSchema = z.object({
  name: requiredText("宽带名称/编号", 100),
  supplierId: nullableId,
  bandwidthMbps: nonNegativeInt,
  status: zEnum(BROADBAND_STATUS, "宽带状态").default("active"),
  expireDate: nullableDateStr,
  account: optionalText(200),
  password: optionalText(200),
  installAddress: optionalText(500),
  rackId: nullableId,
  deviceId: nullableId,
  lineId: nullableId,
  ipAddressId: nullableId,
  monthlyFeeCents: nonNegativeInt,
  contractNo: optionalText(100),
  description: optionalText(1000),
  notes: optionalText(2000),
});

export const broadbandUpdateSchema = z.object({
  name: requiredText("宽带名称/编号", 100).optional(),
  supplierId: nullableId,
  bandwidthMbps: nonNegativeInt,
  status: zEnum(BROADBAND_STATUS, "宽带状态").optional(),
  expireDate: nullableDateStr,
  account: optionalText(200),
  password: optionalText(200),
  installAddress: optionalText(500),
  rackId: nullableId,
  deviceId: nullableId,
  lineId: nullableId,
  ipAddressId: nullableId,
  monthlyFeeCents: nonNegativeInt,
  contractNo: optionalText(100),
  description: optionalText(1000),
  notes: optionalText(2000),
});
