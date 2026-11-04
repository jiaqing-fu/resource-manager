import { z } from "zod";
import { VXLAN_STATUS } from "@/lib/enums";
import { nullableId, optionalText, zEnum } from "@/lib/validators";

export const VXLAN_VNI_MIN = 1;
export const VXLAN_VNI_MAX = 16_777_215;

const vni = z.coerce
  .number()
  .int()
  .min(VXLAN_VNI_MIN, `VXLAN VNI 最小为 ${VXLAN_VNI_MIN}`)
  .max(VXLAN_VNI_MAX, `VXLAN VNI 最大为 ${VXLAN_VNI_MAX}`);

export const vxlanSchema = z.object({
  vni,
  name: optionalText(100),
  status: zEnum(VXLAN_STATUS, "VXLAN 状态").default("active"),
  description: optionalText(500),
  vlanId: nullableId,
  supplierId: nullableId,
});

export const vxlanUpdateSchema = z.object({
  vni: vni.optional(),
  name: optionalText(100),
  status: zEnum(VXLAN_STATUS, "VXLAN 状态").optional(),
  description: optionalText(500),
  vlanId: nullableId,
  supplierId: nullableId,
});
