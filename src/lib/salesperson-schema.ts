import { z } from "zod";
import { PARTY_STATUS } from "@/lib/enums";
import { optionalText, requiredText, zEnum } from "@/lib/validators";

export const salespersonSchema = z.object({
  name: requiredText("业务员姓名", 100),
  phone: optionalText(50),
  status: zEnum(PARTY_STATUS, "状态").default("active"),
  notes: optionalText(1000),
});

export const salespersonUpdateSchema = z.object({
  name: requiredText("业务员姓名", 100).optional(),
  phone: optionalText(50),
  status: zEnum(PARTY_STATUS, "状态").optional(),
  notes: optionalText(1000),
});
