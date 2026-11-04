/** 宽带复用率：有效分配 MBPS 之和 ÷ 总带宽，保留 1 位小数，允许超过 100%。 */
export function computeReusePercent(
  bandwidthMbps: number | null | undefined,
  allocatedMbps: number,
): number | null {
  if (!bandwidthMbps || bandwidthMbps <= 0) return null;
  return Math.round((allocatedMbps / bandwidthMbps) * 1000) / 10;
}
