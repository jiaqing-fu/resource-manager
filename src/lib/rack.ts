/** 机柜区间是闭区间 [uStart, uEnd]，一条记录只代表物理机柜的一段。 */
export type RackRange = { code: string; uStart: number; uEnd: number };

export function rackRangeLabel(rack: RackRange): string {
  return `${rack.code} [${rack.uStart}-${rack.uEnd}]U`;
}

export function rackRangeText(uStart: number, uEnd: number): string {
  return `[${uStart}-${uEnd}]U`;
}

/** 区间可放置的 U 位数。 */
export function rackCapacity(uStart: number, uEnd: number): number {
  return Math.max(0, uEnd - uStart + 1);
}

/** 单次机柜分配最多展开的 U 位数（机柜通常只有几十 U，留足余量）。 */
export const MAX_RACK_ALLOCATION_UNITS = 512;

export type ParsedRackUnits = {
  units: number[];
  start: number;
  end: number;
  contiguous: boolean;
};

/**
 * 解析任意 U 位集合：支持 `1,3,5-8` 形式，逗号/空白/分号/换行分隔。
 * 自动去重排序；返回闭区间最小/最大 U 位与是否连续。
 */
export function parseRackUnitListInput(
  input: string,
  max = MAX_RACK_ALLOCATION_UNITS,
): { ok: true; value: ParsedRackUnits } | { ok: false; error: string } {
  const text = input.trim();
  if (!text) return { ok: false, error: "请填写 U 位或 U 位区间列表" };
  const tokens = text.split(/[\s,，;；、]+/).filter(Boolean);
  const set = new Set<number>();
  for (const token of tokens) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) {
      return { ok: false, error: `无法识别的 U 位：${token}` };
    }
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < 1
    ) {
      return { ok: false, error: `U 位必须是大于 0 的整数：${token}` };
    }
    if (start > end) {
      return { ok: false, error: `U 位区间起始不能大于结束：${token}` };
    }
    if (end - start + 1 > max) {
      return { ok: false, error: `单次机柜分配最多 ${max} 个 U 位` };
    }
    for (let u = start; u <= end; u += 1) {
      set.add(u);
      if (set.size > max) {
        return { ok: false, error: `单次机柜分配最多 ${max} 个 U 位` };
      }
    }
  }
  if (set.size === 0) return { ok: false, error: "请填写 U 位或 U 位区间列表" };
  const units = Array.from(set).sort((a, b) => a - b);
  return {
    ok: true,
    value: {
      units,
      start: units[0],
      end: units[units.length - 1],
      contiguous: units[units.length - 1] - units[0] + 1 === units.length,
    },
  };
}
