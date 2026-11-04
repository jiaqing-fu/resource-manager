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
