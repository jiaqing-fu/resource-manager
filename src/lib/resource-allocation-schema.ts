import { z } from "zod";
import { ALLOCATION_RESOURCE_TYPES, ALLOCATION_STATUS } from "@/lib/enums";
import { parseIpRange } from "@/lib/ip";
import { nullableDateStr, optionalText, requiredText, zEnum } from "@/lib/validators";

const optionalU = z.coerce.number().int().min(1, "U 位至少为 1").max(100, "U 位不能超过 100");
const optionalIp = optionalText(64);

function refineIpRange(
  value: {
    resourceType: string;
    ipRangeStart?: string | null;
    ipRangeEnd?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (value.resourceType !== "ipRange") return;
  if (!value.ipRangeStart || !value.ipRangeEnd) {
    ctx.addIssue({
      code: "custom",
      path: ["ipRangeStart"],
      message: "IP 区间分配必须填写起始 IP 和结束 IP",
    });
    return;
  }
  const range = parseIpRange(`${value.ipRangeStart}-${value.ipRangeEnd}`);
  if (!range || range.version !== 4) {
    ctx.addIssue({
      code: "custom",
      path: ["ipRangeStart"],
      message: "IP 区间格式不正确，起止地址必须为 IPv4",
    });
  }
}

export const resourceAllocationSchema = z
  .object({
    customerId: requiredText("客户", 100),
    resourceType: zEnum(ALLOCATION_RESOURCE_TYPES, "资源类型"),
    resourceId: requiredText("资源", 100),
    uStart: optionalU.optional(),
    uEnd: optionalU.optional(),
    ipRangeStart: optionalIp,
    ipRangeEnd: optionalIp,
    allocatedMbps: z.coerce.number().int().positive("MBPS 必须大于 0").optional(),
    allocatedAt: nullableDateStr,
    notes: optionalText(2000),
  })
  .superRefine(refineIpRange);

export const resourceAllocationReleaseSchema = z.object({
  releasedAt: nullableDateStr,
});

export const allocationStatusFilter = zEnum(ALLOCATION_STATUS, "分配状态");

const batchCreateSchema = z
  .object({
    resourceType: zEnum(ALLOCATION_RESOURCE_TYPES, "资源类型"),
    resourceId: requiredText("资源", 100),
    uStart: optionalU.optional(),
    uEnd: optionalU.optional(),
    ipRangeStart: optionalIp,
    ipRangeEnd: optionalIp,
    allocatedMbps: z.coerce.number().int().positive("MBPS 必须大于 0").optional(),
  })
  .superRefine((value, ctx) => {
    refineIpRange(value, ctx);
    if (value.resourceType === "rack") {
      if (value.uStart === undefined || value.uEnd === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["uStart"],
          message: "机柜分配必须填写起始 U 位和结束 U 位",
        });
      } else if (value.uEnd < value.uStart) {
        ctx.addIssue({
          code: "custom",
          path: ["uEnd"],
          message: "结束 U 位不能小于起始 U 位",
        });
      }
    }
    if (value.resourceType === "broadband" && value.allocatedMbps === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["allocatedMbps"],
        message: "宽带分配必须填写 MBPS",
      });
    }
  });

const batchGroupSchema = z.object({
  customerId: requiredText("客户", 100),
  releases: z.array(requiredText("分配记录", 100)).max(200, "单个客户一次最多释放 200 条").default([]),
  creates: z.array(batchCreateSchema).max(200, "单个客户一次最多新增 200 条").default([]),
});

export const resourceAllocationBulkSchema = z.object({
  allocatedAt: nullableDateStr,
  releasedAt: nullableDateStr,
  notes: optionalText(2000),
  groups: z
    .array(batchGroupSchema)
    .min(1, "请至少添加一个客户分组")
    .max(20, "一次最多保存 20 个客户分组"),
});
