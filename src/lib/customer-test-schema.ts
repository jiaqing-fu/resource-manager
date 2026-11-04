import { z } from "zod";
import { dateStr, booleanField, nullableId, optionalText, requiredText } from "@/lib/validators";

const manualStatus = z.preprocess(
  (v) => (v === "" ? null : v),
  z.enum(["passed", "failed"], { message: "测试结果只能是测试通过或测试未通过" }).nullable().optional(),
);

export const customerTestSchema = z.object({
  customerId: nullableId,
  companyName: requiredText("公司名称", 200),
  salesperson: optionalText(50),
  content: optionalText(2000),
  startAt: dateStr.optional(),
  endAt: dateStr.optional(),
  accepted: booleanField.default(false),
  converted: booleanField.default(false),
  status: manualStatus,
  notes: optionalText(2000),
});

export const customerTestUpdateSchema = z.object({
  customerId: nullableId,
  companyName: requiredText("公司名称", 200).optional(),
  salesperson: optionalText(50),
  content: optionalText(2000),
  startAt: dateStr.optional(),
  endAt: dateStr.optional(),
  accepted: booleanField.optional(),
  converted: booleanField.optional(),
  status: manualStatus,
  notes: optionalText(2000),
});
