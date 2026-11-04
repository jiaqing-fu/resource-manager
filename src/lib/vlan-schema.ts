import { z } from "zod";
import { VLAN_STATUS } from "@/lib/enums";
import { nullableId, optionalText, requiredText, zEnum } from "@/lib/validators";

export const vlanSchema = z.object({
  vid: z.coerce.number().int().min(1, "VLAN ID 最小为 1").max(4094, "VLAN ID 最大为 4094"),
  name: requiredText("VLAN 名称", 100),
  status: zEnum(VLAN_STATUS, "VLAN 状态").default("active"),
  description: optionalText(500),
  supplierId: nullableId,
});

export const vlanUpdateSchema = z.object({
  vid: z.coerce.number().int().min(1).max(4094).optional(),
  name: requiredText("VLAN 名称", 100).optional(),
  status: zEnum(VLAN_STATUS, "VLAN 状态").optional(),
  description: optionalText(500),
  supplierId: nullableId,
});
