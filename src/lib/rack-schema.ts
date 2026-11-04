import { z } from "zod";
import { RACK_STATUS } from "@/lib/enums";
import { nullableId, optionalText, requiredText, zEnum } from "@/lib/validators";

const uStart = z.coerce
  .number()
  .int("起始 U 位必须是整数")
  .min(1, "起始 U 位至少为 1")
  .max(100, "起始 U 位不能超过 100");
const uEnd = z.coerce
  .number()
  .int("结束 U 位必须是整数")
  .min(1, "结束 U 位至少为 1")
  .max(100, "结束 U 位不能超过 100");

function checkRange(value: { uStart?: number; uEnd?: number }, ctx: z.RefinementCtx) {
  if (value.uStart !== undefined && value.uEnd !== undefined && value.uEnd < value.uStart) {
    ctx.addIssue({
      code: "custom",
      path: ["uEnd"],
      message: "结束 U 位不能小于起始 U 位",
    });
  }
}

export const rackSchema = z
  .object({
    code: requiredText("机柜编号", 50),
    location: optionalText(100),
    status: zEnum(RACK_STATUS, "机柜状态").default("active"),
    width: z.coerce
      .number()
      .int()
      .refine((v) => v === 19 || v === 23, "机柜宽度只能是 19 或 23 英寸")
      .default(19),
    uStart: uStart.default(1),
    uEnd: uEnd.default(42),
    power: optionalText(50),
    serial: optionalText(100),
    supplierId: nullableId,
    notes: optionalText(1000),
  })
  .superRefine(checkRange);

export const rackUpdateSchema = z
  .object({
    code: requiredText("机柜编号", 50).optional(),
    location: optionalText(100),
    status: zEnum(RACK_STATUS, "机柜状态").optional(),
    width: z.coerce
      .number()
      .int()
      .refine((v) => v === 19 || v === 23, "机柜宽度只能是 19 或 23 英寸")
      .optional(),
    uStart: uStart.optional(),
    uEnd: uEnd.optional(),
    power: optionalText(50),
    serial: optionalText(100),
    supplierId: nullableId,
    notes: optionalText(1000),
  })
  .superRefine(checkRange);
