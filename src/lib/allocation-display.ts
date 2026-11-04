/** 资源分配列表/工作台中展示当前资源名，机柜带区间、宽带带 MBPS。 */
export type AllocationDisplayRow = {
  resourceType: string;
  resourceName: string;
  uStart: number | null;
  uEnd: number | null;
  ipRangeStart: string | null;
  ipRangeEnd: string | null;
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
    case "rack":
      return row.rack
        ? `${row.rack.code} [${row.uStart ?? "?"}-${row.uEnd ?? "?"}]U`
        : row.resourceName;
    case "ipBlock":
      return row.ipBlock?.cidr ?? row.resourceName;
    case "ipRange":
      return row.ipBlock
        ? `${row.ipBlock.cidr} [${row.ipRangeStart ?? "?"}-${row.ipRangeEnd ?? "?"}]`
        : row.resourceName;
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
