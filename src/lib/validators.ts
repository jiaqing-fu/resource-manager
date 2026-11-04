import { z } from "zod";
import type { Option } from "@/lib/enums";
import { isValidDateStr } from "@/lib/dates";

export function zEnum(options: Option[], label: string) {
  const values = options.map((o) => o.value) as [string, ...string[]];
  return z.enum(values, { message: `${label}取值不合法` });
}

/** 空字符串或 null 统一转为 null；未传保持 undefined。 */
export const optionalId = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : v),
  z.string().min(1).nullable().optional(),
);

/** 表单里清空下拉框会传 null，保持 null；空字符串也转 null。 */
export const nullableId = z.preprocess(
  (v) => (v === "" ? null : v),
  z.string().min(1).nullable().optional(),
);

export const requiredId = z.string().min(1, "请选择关联记录");

export const dateStr = z.string().refine(isValidDateStr, "日期格式应为 YYYY-MM-DD");

export const nullableDateStr = z.preprocess(
  (v) => (v === "" ? null : v),
  dateStr.nullable().optional(),
);

export const optionalText = (max = 500) =>
  z.preprocess((v) => (v === "" ? null : v), z.string().max(max).nullable().optional());

export const requiredText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label}不能为空`).max(max, `${label}不能超过 ${max} 个字符`);

export const optionalNumber = z.preprocess(
  (v) => (v === "" || v === null ? null : v),
  z.coerce.number().optional().nullable(),
);

export const optionalInt = z.preprocess(
  (v) => (v === "" || v === null ? null : v),
  z.coerce.number().int().nullable().optional(),
);

export const booleanField = z.preprocess(
  (v) => v === true || v === "true" || v === 1 || v === "1",
  z.boolean(),
);

export function parseIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}
