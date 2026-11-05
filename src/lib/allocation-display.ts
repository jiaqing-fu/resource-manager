/** 资源分配列表/工作台中展示当前资源名，机柜带区间、宽带带 MBPS。 */
export type AllocationDisplayRow = {
  resourceType: string;
  resourceName: string;
  uStart: number | null;
  uEnd: number | null;
  ipRangeStart: string | null;
  ipRangeEnd: string | null;
  /** IP 区间/集合分配的明细数量；未加载时省略。 */
  ipItemCount?: number;
  ipActiveCount?: number;
  /** 机柜区间/集合分配的 U 位明细数量；未加载时省略。 */
  rackItemCount?: number;
  rackActiveCount?: number;
  allocatedMbps: number | null;
  rack: { code: string } | null;
  ipBlock: { cidr: string } | null;
  ipAddress: { address: string } | null;
  vlan: { vid: number; name: string } | null;
  vxlan: { vni: number; name: string | null } | null;
  broadband: { name: string } | null;
  line: { code: string; name: string } | null;
  device: { name: string } | null;
};

export function allocationDisplayName(row: AllocationDisplayRow): string {
  switch (row.resourceType) {
    case "rack": {
      const base = row.rack
        ? `${row.rack.code} [${row.uStart ?? "?"}-${row.uEnd ?? "?"}]U`
        : row.resourceName;
      const total = row.rackItemCount ?? 0;
      const active = row.rackActiveCount ?? total;
      if (total === 0) return base;
      if (active === total) return `${base}（${total} 个 U）`;
      return `${base}（剩余 ${active}/${total} 个 U）`;
    }
    case "ipBlock":
      return row.ipBlock?.cidr ?? row.resourceName;
    case "ipRange": {
      const base = row.ipBlock
        ? `${row.ipBlock.cidr} [${row.ipRangeStart ?? "?"}-${row.ipRangeEnd ?? "?"}]`
        : row.resourceName;
      const total = row.ipItemCount ?? 0;
      const active = row.ipActiveCount ?? total;
      if (total === 0) return base;
      if (active === total) return `${base}（${total} 个 IP）`;
      return `${base}（剩余 ${active}/${total} 个 IP）`;
    }
    case "ipAddress":
      return row.ipAddress?.address ?? row.resourceName;
    case "vlan":
      return row.vlan ? `VLAN ${row.vlan.vid} ${row.vlan.name}` : row.resourceName;
    case "vxlan":
      return row.vxlan
        ? `VXLAN ${row.vxlan.vni}${row.vxlan.name ? ` ${row.vxlan.name}` : ""}`
        : row.resourceName;
    case "broadband":
      return row.broadband
        ? `${row.broadband.name}${row.allocatedMbps !== null ? ` · ${row.allocatedMbps} Mbps` : ""}`
        : row.resourceName;
    case "line":
      return row.line ? `${row.line.code} ${row.line.name}` : row.resourceName;
    case "device":
      return row.device?.name ?? row.resourceName;
    default:
      return row.resourceName;
  }
}
