import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { rackRangeText } from "@/lib/rack";
import { rangesOverlap } from "@/lib/ranges";

type Tx = Prisma.TransactionClient;

export type RackSegmentInput = {
  code: string;
  uStart: number;
  uEnd: number;
  excludeId?: string;
};

/** 校验机柜区间：1-100、起止有序，且同一编号的记录之间不能重叠。 */
export async function validateRackSegment(
  tx: Tx,
  input: RackSegmentInput,
): Promise<void> {
  const { code, uStart, uEnd, excludeId } = input;
  if (!Number.isInteger(uStart) || !Number.isInteger(uEnd) || uStart < 1 || uEnd > 100) {
    throw new ApiError(422, "机柜 U 位必须是 1-100 之间的整数", "INVALID_RACK_RANGE");
  }
  if (uStart > uEnd) {
    throw new ApiError(422, "机柜起始 U 位不能大于结束 U 位", "INVALID_RACK_RANGE");
  }

  const siblings = await tx.rack.findMany({
    where: {
      code,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, code: true, uStart: true, uEnd: true },
  });
  const conflict = siblings.find((rack) =>
    rangesOverlap(uStart, uEnd, rack.uStart, rack.uEnd),
  );
  if (conflict) {
    throw new ApiError(
      409,
      `机柜编号「${code}」的区间 ${rackRangeText(uStart, uEnd)} 与已有记录 ${rackRangeText(conflict.uStart, conflict.uEnd)} 重叠`,
      "RACK_RANGE_OVERLAP",
    );
  }
}

export type PlacementInput = {
  rackId?: string | null;
  uStart?: number | null;
  uHeight: number;
  face: string;
};

/** 校验设备机柜 U 位：同机柜同面不可重叠，前后两面可同 U。 */
export async function validateDevicePlacement(
  tx: Tx,
  input: PlacementInput,
  deviceId?: string,
): Promise<{ rackId: string | null; uStart: number | null; uHeight: number; face: string }> {
  const face = input.face === "rear" ? "rear" : "front";
  const uHeight = input.uHeight ?? 1;
  if (!Number.isInteger(uHeight) || uHeight < 1 || uHeight > 100) {
    throw new ApiError(422, "设备高度必须是 1-100 之间的整数", "INVALID_U_HEIGHT");
  }

  const rackId = input.rackId ?? null;

  if (!rackId) {
    if (input.uStart !== null && input.uStart !== undefined) {
      throw new ApiError(422, "未选择机柜时不能填写 U 位", "U_WITHOUT_RACK");
    }
    return { rackId: null, uStart: null, uHeight, face };
  }

  const rack = await tx.rack.findUnique({
    where: { id: rackId },
    select: { id: true, code: true, uStart: true, uEnd: true },
  });
  if (!rack) throw new ApiError(422, "所选机柜不存在", "RACK_NOT_FOUND");

  const uStart = input.uStart;
  if (uStart === null || uStart === undefined || !Number.isInteger(uStart) || uStart < 1) {
    throw new ApiError(422, "放入机柜的设备必须填写起始 U 位（从 1 开始）", "U_REQUIRED");
  }
  const deviceEnd = uStart + uHeight - 1;
  if (uStart < rack.uStart || deviceEnd > rack.uEnd) {
    throw new ApiError(
      422,
      `U 位超出机柜区间：${rack.code} ${rackRangeText(rack.uStart, rack.uEnd)}，设备占用 ${uStart}-${deviceEnd}U`,
      "U_OUT_OF_RANGE",
    );
  }

  const others = await tx.device.findMany({
    where: {
      rackId: rack.id,
      face,
      uStart: { not: null },
      ...(deviceId ? { id: { not: deviceId } } : {}),
    },
    select: { id: true, name: true, uStart: true, uHeight: true },
  });
  const uEnd = uStart + uHeight - 1;
  const conflict = others.find((o) => {
    const oStart = o.uStart!;
    const oEnd = oStart + o.uHeight - 1;
    return uStart <= oEnd && oStart <= uEnd;
  });
  if (conflict) {
    throw new ApiError(
      409,
      `U 位冲突：${conflict.name} 已占用 ${conflict.uStart}-${conflict.uStart! + conflict.uHeight - 1}U（${face === "front" ? "前面板" : "后面板"}）`,
      "U_CONFLICT",
    );
  }

  return { rackId: rack.id, uStart, uHeight, face };
}

export function computeRackUsage(
  devices: Array<{ uStart: number | null; uHeight: number; face: string }>,
): {
  usedUFront: number;
  usedURear: number;
  usedU: number;
  occupiedU: number;
  maxU: number;
} {
  let usedUFront = 0;
  let usedURear = 0;
  let maxU = 0;
  const positions = new Set<number>();
  for (const d of devices) {
    if (d.uStart === null) continue;
    if (d.face === "rear") usedURear += d.uHeight;
    else usedUFront += d.uHeight;
    for (let u = d.uStart; u < d.uStart + d.uHeight; u++) positions.add(u);
    maxU = Math.max(maxU, d.uStart + d.uHeight - 1);
  }
  return {
    usedUFront,
    usedURear,
    usedU: usedUFront + usedURear,
    occupiedU: positions.size,
    maxU,
  };
}

export type TerminationInput = {
  side: string;
  rackId?: string | null;
  deviceId?: string | null;
  port?: string | null;
  description?: string | null;
};

/** 校验线路两端：每侧唯一，机柜/设备归属一致。 */
export async function validateTerminations(
  tx: Tx,
  terms: TerminationInput[],
): Promise<Array<Required<Pick<TerminationInput, "side">> & {
  rackId: string | null;
  deviceId: string | null;
  port: string | null;
  description: string | null;
}>> {
  const sides = new Set<string>();
  const out = [];
  for (const t of terms) {
    if (t.side !== "A" && t.side !== "Z") {
      throw new ApiError(422, "线路端点只能为 A 端或 Z 端", "INVALID_SIDE");
    }
    if (sides.has(t.side)) {
      throw new ApiError(422, `${t.side} 端已存在，每条线路每侧只能有一个端点`, "DUPLICATE_SIDE");
    }
    sides.add(t.side);

    let rackId = t.rackId ?? null;
    const deviceId = t.deviceId ?? null;

    const device = deviceId
      ? await tx.device.findUnique({
          where: { id: deviceId },
          select: { id: true, name: true, rackId: true },
        })
      : null;
    if (deviceId && !device) throw new ApiError(422, "端点设备不存在", "DEVICE_NOT_FOUND");
    const rack = rackId
      ? await tx.rack.findUnique({ where: { id: rackId }, select: { id: true } })
      : null;
    if (rackId && !rack) throw new ApiError(422, "端点机柜不存在", "RACK_NOT_FOUND");

    if (device) {
      if (!rackId && device.rackId) rackId = device.rackId;
      if (rackId && device.rackId && rackId !== device.rackId) {
        throw new ApiError(422, "端点机柜与设备所在机柜不一致", "RACK_MISMATCH");
      }
    }

    out.push({
      side: t.side,
      rackId: rackId || null,
      deviceId: deviceId || null,
      port: t.port ?? null,
      description: t.description ?? null,
    });
  }
  return out;
}
