/** 闭区间 [start, end] 工具，U 位和编号类区间共用。 */
export type Range = { start: number; end: number };

export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function rangeWithin(
  innerStart: number,
  innerEnd: number,
  outerStart: number,
  outerEnd: number,
): boolean {
  return innerStart >= outerStart && innerEnd <= outerEnd;
}

/** 合并重叠或相邻的闭区间。 */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges
    .filter(
      (r) =>
        Number.isInteger(r.start) &&
        Number.isInteger(r.end) &&
        r.start <= r.end,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** 从 base 中扣除 occupied，返回剩余闭区间。 */
export function subtractRanges(base: Range, occupied: Range[]): Range[] {
  if (base.start > base.end) return [];
  const merged = mergeRanges(occupied);
  const result: Range[] = [];
  let cursor = base.start;
  for (const range of merged) {
    if (range.end < cursor) continue;
    if (range.start > base.end) break;
    if (range.start > cursor) {
      result.push({ start: cursor, end: Math.min(range.start - 1, base.end) });
    }
    cursor = Math.max(cursor, range.end + 1);
    if (cursor > base.end) break;
  }
  if (cursor <= base.end) result.push({ start: cursor, end: base.end });
  return result;
}
