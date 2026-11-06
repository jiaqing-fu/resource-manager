import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";
import {
  ipInBlock,
  ipv4LongToIp,
  ipv4ToLong,
  MAX_RANGE_ALLOCATION_ADDRESSES,
  parseIpv4ListInput,
  parseIpRange,
  parseStoredBlock,
  type ParsedIpv4List,
} from "@/lib/ip";
import {
  MAX_RACK_ALLOCATION_UNITS,
  parseRackUnitListInput,
  rackRangeText,
  type ParsedRackUnits,
} from "@/lib/rack";
import { rangesOverlap, subtractRanges } from "@/lib/ranges";
import {
  ensureAddressesForList,
  recomputeIpCustomersForAddresses,
} from "./ipam";

type Tx = Prisma.TransactionClient;

function chunkArray<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type IpAllocationCounts = { total: number; active: number };

/** 批量加载 IP 分配明细数量（总数/有效数），用于列表展示。 */
export async function loadIpAllocationCounts(
  tx: Tx,
  allocationIds: string[],
): Promise<Map<string, IpAllocationCounts>> {
  const result = new Map<string, IpAllocationCounts>();
  if (allocationIds.length === 0) return result;
  const [totals, actives] = await Promise.all([
    tx.resourceAllocationItem.groupBy({
      by: ["allocationId"],
      where: { allocationId: { in: allocationIds } },
      _count: { _all: true },
    }),
    tx.resourceAllocationItem.groupBy({
      by: ["allocationId"],
      where: { allocationId: { in: allocationIds }, releasedAt: null },
      _count: { _all: true },
    }),
  ]);
  for (const row of totals) {
    result.set(row.allocationId, { total: row._count._all, active: 0 });
  }
  for (const row of actives) {
    const current = result.get(row.allocationId);
    if (current) current.active = row._count._all;
  }
  return result;
}

export type RackAllocationCounts = { total: number; active: number };

/** 批量加载机柜分配明细数量（总数/有效数），用于列表展示。 */
export async function loadRackAllocationCounts(
  tx: Tx,
  allocationIds: string[],
): Promise<Map<string, RackAllocationCounts>> {
  const result = new Map<string, RackAllocationCounts>();
  if (allocationIds.length === 0) return result;
  const [totals, actives] = await Promise.all([
    tx.rackAllocationItem.groupBy({
      by: ["allocationId"],
      where: { allocationId: { in: allocationIds } },
      _count: { _all: true },
    }),
    tx.rackAllocationItem.groupBy({
      by: ["allocationId"],
      where: { allocationId: { in: allocationIds }, releasedAt: null },
      _count: { _all: true },
    }),
  ]);
  for (const row of totals) {
    result.set(row.allocationId, { total: row._count._all, active: 0 });
  }
  for (const row of actives) {
    const current = result.get(row.allocationId);
    if (current) current.active = row._count._all;
  }
  return result;
}

export const ALLOCATION_RESOURCE_TYPES = [
  "ipAddress",
  "ipBlock",
  "ipRange",
  "rack",
  "device",
  "vlan",
  "vxlan",
  "broadband",
  "line",
] as const;

export type AllocationResourceType = (typeof ALLOCATION_RESOURCE_TYPES)[number];

export type AllocationOccupiedRange = {
  allocationId: string;
  customerId: string;
  customerName: string;
  uStart: number;
  uEnd: number;
};

export type AllocationOccupiedIpRange = {
  allocationId: string;
  customerId: string;
  customerName: string;
  startIp: string;
  endIp: string;
};

export type AllocationResourceOption = {
  id: string;
  name: string;
  supplierId: string | null;
  supplierName: string | null;
  customerId: string | null;
  status: string | null;
  location?: string | null;
  uStart?: number;
  uEnd?: number;
  bandwidthMbps?: number | null;
  allocatedMbps?: number;
  reusePercent?: number | null;
  occupiedRanges?: AllocationOccupiedRange[];
  freeRanges?: Array<{ start: number; end: number }>;
  blockId?: string;
  blockName?: string;
  kind?: string;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  occupiedIpRanges?: AllocationOccupiedIpRange[];
  freeIpRanges?: Array<{ startIp: string; endIp: string }>;
};

type ResourceRecord = AllocationResourceOption & {
  customerName: string | null;
  code?: string;
};

const FIELD_BY_TYPE: Record<AllocationResourceType, string> = {
  rack: "rackId",
  ipBlock: "ipBlockId",
  ipRange: "ipBlockId",
  ipAddress: "ipAddressId",
  vlan: "vlanId",
  vxlan: "vxlanId",
  broadband: "broadbandId",
  line: "lineId",
  device: "deviceId",
};

export function allocationField(resourceType: AllocationResourceType): string {
  return FIELD_BY_TYPE[resourceType];
}

export function activeKeyOf(resourceType: string, resourceId: string): string {
  return `${resourceType}:${resourceId}`;
}

export function isAllocationResourceType(value: string): value is AllocationResourceType {
  return (ALLOCATION_RESOURCE_TYPES as readonly string[]).includes(value);
}

/** 读取资源用于分配的名称、供应商与当前客户。 */
export async function getResourceForAllocation(
  tx: Tx,
  resourceType: AllocationResourceType,
  resourceId: string,
): Promise<ResourceRecord> {
  switch (resourceType) {
    case "rack": {
      const row = await tx.rack.findUnique({
        where: { id: resourceId },
        select: {
          id: true,
          code: true,
          uStart: true,
          uEnd: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
          customer: { select: { name: true } },
        },
      });
      if (!row) break;
      return {
        id: row.id,
        code: row.code,
        name: `${row.code} ${rackRangeText(row.uStart, row.uEnd)}`,
        uStart: row.uStart,
        uEnd: row.uEnd,
        supplierId: row.supplierId,
        supplierName: row.supplier?.name ?? null,
        customerId: row.customerId,
        customerName: row.customer?.name ?? null,
        status: row.status,
      };
    }
    case "ipBlock": {
      const row = await tx.ipBlock.findUnique({
        where: { id: resourceId },
        select: {
          id: true,
          cidr: true,
          kind: true,
          rangeStart: true,
          rangeEnd: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
          customer: { select: { name: true } },
        },
      });
      if (!row) break;
      return {
        id: row.id,
        name: row.cidr,
        blockId: row.id,
        blockName: row.cidr,
        kind: row.kind,
        rangeStart: row.rangeStart,
        rangeEnd: row.rangeEnd,
        supplierId: row.supplierId,
        supplierName: row.supplier?.name ?? null,
        customerId: row.customerId,
        customerName: row.customer?.name ?? null,
        status: row.status,
      };
    }
    case "ipRange": {
      const row = await tx.ipBlock.findUnique({
        where: { id: resourceId },
        select: {
          id: true,
          cidr: true,
          kind: true,
          rangeStart: true,
          rangeEnd: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
          customer: { select: { name: true } },
        },
      });
      if (!row) break;
      return {
        id: row.id,
        name: row.cidr,
        blockId: row.id,
        blockName: row.cidr,
        kind: row.kind,
        rangeStart: row.rangeStart,
        rangeEnd: row.rangeEnd,
        supplierId: row.supplierId,
        supplierName: row.supplier?.name ?? null,
        customerId: row.customerId,
        customerName: row.customer?.name ?? null,
        status: row.status,
      };
    }
    case "ipAddress": {
      const row = await tx.ipAddress.findUnique({
        where: { id: resourceId },
        select: {
          id: true,
          address: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
          customer: { select: { name: true } },
        },
      });
      if (!row) break;
      return {
        id: row.id,
        name: row.address,
        supplierId: row.supplierId,
        supplierName: row.supplier?.name ?? null,
        customerId: row.customerId,
        customerName: row.customer?.name ?? null,
        status: row.status,
      };
    }
    case "vlan": {
      const row = await tx.vlan.findUnique({
        where: { id: resourceId },
        select: {
          id: true,
          vid: true,
          name: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
          customer: { select: { name: true } },
        },
      });
      if (!row) break;
      return {
        id: row.id,
        name: `VLAN ${row.vid} ${row.name}`,
        supplierId: row.supplierId,
        supplierName: row.supplier?.name ?? null,
        customerId: row.customerId,
        customerName: row.customer?.name ?? null,
        status: row.status,
      };
    }
    case "vxlan": {
      const row = await tx.vxlan.findUnique({
        where: { id: resourceId },
        select: {
          id: true,
          vni: true,
          name: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
          customer: { select: { name: true } },
        },
      });
      if (!row) break;
      return {
        id: row.id,
        name: `VXLAN ${row.vni}${row.name ? ` ${row.name}` : ""}`,
        supplierId: row.supplierId,
        supplierName: row.supplier?.name ?? null,
        customerId: row.customerId,
        customerName: row.customer?.name ?? null,
        status: row.status,
      };
    }
    case "broadband": {
      const row = await tx.broadband.findUnique({
        where: { id: resourceId },
        select: {
          id: true,
          name: true,
          bandwidthMbps: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
          customer: { select: { name: true } },
        },
      });
      if (!row) break;
      return {
        id: row.id,
        name: row.name,
        bandwidthMbps: row.bandwidthMbps,
        supplierId: row.supplierId,
        supplierName: row.supplier?.name ?? null,
        customerId: row.customerId,
        customerName: row.customer?.name ?? null,
        status: row.status,
      };
    }
    case "line": {
      const row = await tx.line.findUnique({
        where: { id: resourceId },
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
          customer: { select: { name: true } },
        },
      });
      if (!row) break;
      return {
        id: row.id,
        name: `${row.code} ${row.name}`,
        supplierId: row.supplierId,
        supplierName: row.supplier?.name ?? null,
        customerId: row.customerId,
        customerName: row.customer?.name ?? null,
        status: row.status,
      };
    }
    case "device": {
      const row = await tx.device.findUnique({
        where: { id: resourceId },
        select: {
          id: true,
          name: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
          customer: { select: { name: true } },
        },
      });
      if (!row) break;
      return {
        id: row.id,
        name: row.name,
        supplierId: row.supplierId,
        supplierName: row.supplier?.name ?? null,
        customerId: row.customerId,
        customerName: row.customer?.name ?? null,
        status: row.status,
      };
    }
  }
  throw new ApiError(422, "资源不存在或已被删除", "RESOURCE_NOT_FOUND");
}

/** 列表/下拉：某类型下尚未分配的资源。 */
export async function listAvailableResources(
  tx: Tx,
  resourceType: AllocationResourceType,
  keyword = "",
): Promise<AllocationResourceOption[]> {
  const kw = keyword.trim();
  const free = {
    allocations: { none: { releasedAt: null } },
  } as const;
  const limit = 200;

  switch (resourceType) {
    case "rack": {
      const rows = await tx.rack.findMany({
        where: kw
          ? {
              OR: [
                { code: { contains: kw } },
                { location: { contains: kw } },
                { supplier: { is: { name: { contains: kw } } } },
              ],
            }
          : {},
        orderBy: [{ code: "asc" }, { uStart: "asc" }],
        take: limit,
        select: {
          id: true,
          code: true,
          location: true,
          status: true,
          uStart: true,
          uEnd: true,
          supplierId: true,
          supplier: { select: { name: true } },
        },
      });
      const rackIds = rows.map((row) => row.id);
      const items = await tx.rackAllocationItem.findMany({
        where: {
          releasedAt: null,
          rackId: { in: rackIds },
          allocation: { releasedAt: null },
        },
        select: {
          allocationId: true,
          rackId: true,
          uNumber: true,
          allocation: {
            select: {
              customerId: true,
              customer: { select: { name: true } },
            },
          },
        },
      });

      // 有效明细是占用权威来源：把同一分配下的连续 U 位合并为区间。
      const byAllocation = new Map<
        string,
        {
          allocationId: string;
          rackId: string;
          customerId: string;
          customerName: string;
          units: number[];
        }
      >();
      for (const item of items) {
        let group = byAllocation.get(item.allocationId);
        if (!group) {
          group = {
            allocationId: item.allocationId,
            rackId: item.rackId,
            customerId: item.allocation.customerId,
            customerName: item.allocation.customer?.name ?? "",
            units: [],
          };
          byAllocation.set(item.allocationId, group);
        }
        group.units.push(item.uNumber);
      }
      const occupiedByRack = new Map<string, AllocationOccupiedRange[]>();
      for (const group of byAllocation.values()) {
        group.units.sort((a, b) => a - b);
        const ranges: AllocationOccupiedRange[] = [];
        let start = group.units[0];
        let end = start;
        for (let i = 1; i < group.units.length; i += 1) {
          const u = group.units[i];
          if (u === end + 1) {
            end = u;
            continue;
          }
          ranges.push({
            allocationId: group.allocationId,
            customerId: group.customerId,
            customerName: group.customerName,
            uStart: start,
            uEnd: end,
          });
          start = u;
          end = u;
        }
        if (start !== undefined) {
          ranges.push({
            allocationId: group.allocationId,
            customerId: group.customerId,
            customerName: group.customerName,
            uStart: start,
            uEnd: end,
          });
        }
        const list = occupiedByRack.get(group.rackId) ?? [];
        list.push(...ranges);
        occupiedByRack.set(group.rackId, list);
      }

      return rows.map((r) => {
        const occupiedRanges = (occupiedByRack.get(r.id) ?? []).sort(
          (a, b) => a.uStart - b.uStart,
        );
        const customerIds = new Set(
          occupiedRanges.map((range) => range.customerId),
        );
        return {
          id: r.id,
          name: `${r.location ? `${r.location} / ` : ""}${r.code} ${rackRangeText(r.uStart, r.uEnd)}`,
          location: r.location,
          uStart: r.uStart,
          uEnd: r.uEnd,
          supplierId: r.supplierId,
          supplierName: r.supplier?.name ?? null,
          customerId: customerIds.size === 1 ? Array.from(customerIds)[0] : null,
          status: r.status,
          occupiedRanges,
          freeRanges: subtractRanges(
            { start: r.uStart, end: r.uEnd },
            occupiedRanges.map((range) => ({
              start: range.uStart,
              end: range.uEnd,
            })),
          ),
        };
      });
    }
    case "ipBlock": {
      const rows = await tx.ipBlock.findMany({
        where: {
          allocations: { none: { releasedAt: null, resourceType: "ipBlock" } },
          ...(kw
            ? {
                OR: [
                  { cidr: { contains: kw } },
                  { supplier: { is: { name: { contains: kw } } } },
                ],
              }
            : {}),
        },
        orderBy: { cidr: "asc" },
        take: limit,
        select: {
          id: true,
          cidr: true,
          kind: true,
          rangeStart: true,
          rangeEnd: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.cidr,
        blockId: r.id,
        blockName: r.cidr,
        kind: r.kind,
        rangeStart: r.rangeStart,
        rangeEnd: r.rangeEnd,
        supplierId: r.supplierId,
        supplierName: r.supplier?.name ?? null,
        customerId: r.customerId,
        status: r.status,
      }));
    }
    case "ipRange": {
      const rows = await tx.ipBlock.findMany({
        where: {
          status: { not: "container" },
          children: { none: {} },
          ...(kw
            ? {
                OR: [
                  { cidr: { contains: kw } },
                  { supplier: { is: { name: { contains: kw } } } },
                ],
              }
            : {}),
        },
        orderBy: { cidr: "asc" },
        take: limit,
        select: {
          id: true,
          cidr: true,
          kind: true,
          rangeStart: true,
          rangeEnd: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
        },
      });
      const blockIds = rows.map((row) => row.id);
      const [items, individualAllocations] = await Promise.all([
        tx.resourceAllocationItem.findMany({
          where: {
            releasedAt: null,
            allocation: {
              releasedAt: null,
              ipBlockId: { in: blockIds },
            },
          },
          select: {
            allocationId: true,
            address: true,
            allocation: {
              select: {
                customerId: true,
                customer: { select: { name: true } },
              },
            },
          },
        }),
        tx.resourceAllocation.findMany({
          where: {
            resourceType: "ipAddress",
            releasedAt: null,
            ipAddressId: { not: null },
            ipAddress: { blockId: { in: blockIds } },
          },
          select: {
            id: true,
            customerId: true,
            customer: { select: { name: true } },
            ipAddress: { select: { address: true } },
          },
        }),
      ]);

      // 有效明细是占用权威来源：把同一分配下的连续地址合并为区间。
      const byAllocation = new Map<
        string,
        {
          allocationId: string;
          customerId: string;
          customerName: string;
          longs: number[];
        }
      >();
      for (const item of items) {
        const n = ipv4ToLong(item.address);
        if (n === null) continue;
        let group = byAllocation.get(item.allocationId);
        if (!group) {
          group = {
            allocationId: item.allocationId,
            customerId: item.allocation.customerId,
            customerName: item.allocation.customer?.name ?? "",
            longs: [],
          };
          byAllocation.set(item.allocationId, group);
        }
        group.longs.push(n);
      }
      const occupiedRanges = Array.from(byAllocation.values()).flatMap(
        (group) => {
          group.longs.sort((a, b) => a - b);
          const out: Array<{
            allocationId: string;
            customerId: string;
            customerName: string;
            start: number;
            end: number;
          }> = [];
          let start = group.longs[0];
          let end = start;
          for (let i = 1; i < group.longs.length; i += 1) {
            const n = group.longs[i];
            if (n === end + 1) {
              end = n;
              continue;
            }
            out.push({
              allocationId: group.allocationId,
              customerId: group.customerId,
              customerName: group.customerName,
              start,
              end,
            });
            start = n;
            end = n;
          }
          if (start !== undefined) {
            out.push({
              allocationId: group.allocationId,
              customerId: group.customerId,
              customerName: group.customerName,
              start,
              end,
            });
          }
          return out;
        },
      );
      const individualRanges = individualAllocations.flatMap((row) => {
        if (!row.ipAddress?.address) return [];
        const n = ipv4ToLong(row.ipAddress.address);
        if (n === null) return [];
        return [
          {
            allocationId: row.id,
            customerId: row.customerId,
            customerName: row.customer?.name ?? "",
            start: n,
            end: n,
          },
        ];
      });

      return rows.flatMap((r) => {
        const spec = parseStoredBlock(r);
        if (
          !spec ||
          spec.version !== 4 ||
          spec.startLong === null ||
          spec.endLong === null
        ) {
          return [];
        }
        const occupied: AllocationOccupiedIpRange[] = [];
        for (const range of [...occupiedRanges, ...individualRanges]) {
          if (!rangesOverlap(range.start, range.end, spec.startLong, spec.endLong)) continue;
          const start = Math.max(range.start, spec.startLong);
          const end = Math.min(range.end, spec.endLong);
          occupied.push({
            allocationId: range.allocationId,
            customerId: range.customerId,
            customerName: range.customerName,
            startIp: ipv4LongToIp(start),
            endIp: ipv4LongToIp(end),
          });
        }
        occupied.sort(
          (a, b) => (ipv4ToLong(a.startIp) ?? 0) - (ipv4ToLong(b.startIp) ?? 0),
        );
        const free = subtractRanges(
          { start: spec.startLong, end: spec.endLong },
          occupied.map((range) => {
            const start = ipv4ToLong(range.startIp);
            const end = ipv4ToLong(range.endIp);
            return { start: start ?? 0, end: end ?? 0 };
          }),
        ).map((range) => ({
          startIp: ipv4LongToIp(range.start),
          endIp: ipv4LongToIp(range.end),
        }));
        return [
          {
            id: r.id,
            name: r.cidr,
            blockId: r.id,
            blockName: r.cidr,
            kind: r.kind,
            rangeStart: spec.startIp,
            rangeEnd: spec.endIp,
            supplierId: r.supplierId,
            supplierName: r.supplier?.name ?? null,
            customerId: r.customerId,
            status: r.status,
            occupiedIpRanges: occupied,
            freeIpRanges: free,
          },
        ];
      });
    }
    case "ipAddress": {
      const rows = await tx.ipAddress.findMany({
        where: {
          ...free,
          customerId: null,
          allocationItems: { none: { releasedAt: null } },
          ...(kw
            ? {
                OR: [
                  { address: { contains: kw } },
                  { block: { is: { cidr: { contains: kw } } } },
                  { supplier: { is: { name: { contains: kw } } } },
                ],
              }
            : {}),
        },
        orderBy: { address: "asc" },
        take: limit,
        select: {
          id: true,
          address: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.address,
        supplierId: r.supplierId,
        supplierName: r.supplier?.name ?? null,
        customerId: r.customerId,
        status: r.status,
      }));
    }
    case "vlan": {
      const rows = await tx.vlan.findMany({
        where: {
          ...free,
          ...(kw
            ? {
                OR: [
                  { name: { contains: kw } },
                  ...(/^\d+$/.test(kw) ? [{ vid: Number(kw) }] : []),
                  { supplier: { is: { name: { contains: kw } } } },
                ],
              }
            : {}),
        },
        orderBy: { vid: "asc" },
        take: limit,
        select: {
          id: true,
          vid: true,
          name: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        name: `VLAN ${r.vid} ${r.name}`,
        supplierId: r.supplierId,
        supplierName: r.supplier?.name ?? null,
        customerId: r.customerId,
        status: r.status,
      }));
    }
    case "vxlan": {
      const rows = await tx.vxlan.findMany({
        where: {
          ...free,
          ...(kw
            ? {
                OR: [
                  { name: { contains: kw } },
                  ...(/^\d+$/.test(kw) ? [{ vni: Number(kw) }] : []),
                  { supplier: { is: { name: { contains: kw } } } },
                ],
              }
            : {}),
        },
        orderBy: { vni: "asc" },
        take: limit,
        select: {
          id: true,
          vni: true,
          name: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        name: `VXLAN ${r.vni}${r.name ? ` ${r.name}` : ""}`,
        supplierId: r.supplierId,
        supplierName: r.supplier?.name ?? null,
        customerId: r.customerId,
        status: r.status,
      }));
    }
    case "broadband": {
      const rows = await tx.broadband.findMany({
        where: kw
          ? {
              OR: [
                { name: { contains: kw } },
                { account: { contains: kw } },
                { supplier: { is: { name: { contains: kw } } } },
              ],
            }
          : {},
        orderBy: { name: "asc" },
        take: limit,
        select: {
          id: true,
          name: true,
          status: true,
          bandwidthMbps: true,
          supplierId: true,
          supplier: { select: { name: true } },
          allocations: {
            where: { releasedAt: null },
            select: { customerId: true, allocatedMbps: true },
          },
        },
      });
      return rows.map((r) => {
        const allocatedMbps = r.allocations.reduce(
          (sum, allocation) => sum + (allocation.allocatedMbps ?? 0),
          0,
        );
        const customerIds = new Set(r.allocations.map((allocation) => allocation.customerId));
        return {
          id: r.id,
          name: r.name,
          bandwidthMbps: r.bandwidthMbps,
          allocatedMbps,
          reusePercent:
            r.bandwidthMbps && r.bandwidthMbps > 0
              ? Math.round((allocatedMbps / r.bandwidthMbps) * 1000) / 10
              : null,
          supplierId: r.supplierId,
          supplierName: r.supplier?.name ?? null,
          customerId: customerIds.size === 1 ? Array.from(customerIds)[0] : null,
          status: r.status,
        };
      });
    }
    case "line": {
      const rows = await tx.line.findMany({
        where: {
          ...free,
          ...(kw
            ? {
                OR: [
                  { code: { contains: kw } },
                  { name: { contains: kw } },
                  { supplier: { is: { name: { contains: kw } } } },
                ],
              }
            : {}),
        },
        orderBy: { code: "asc" },
        take: limit,
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        name: `${r.code} ${r.name}`,
        supplierId: r.supplierId,
        supplierName: r.supplier?.name ?? null,
        customerId: r.customerId,
        status: r.status,
      }));
    }
    case "device": {
      const rows = await tx.device.findMany({
        where: {
          ...free,
          ...(kw
            ? {
                OR: [
                  { name: { contains: kw } },
                  { serialNo: { contains: kw } },
                  { supplier: { is: { name: { contains: kw } } } },
                ],
              }
            : {}),
        },
        orderBy: { name: "asc" },
        take: limit,
        select: {
          id: true,
          name: true,
          status: true,
          supplierId: true,
          customerId: true,
          supplier: { select: { name: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        supplierId: r.supplierId,
        supplierName: r.supplier?.name ?? null,
        customerId: r.customerId,
        status: r.status,
      }));
    }
  }
}

/** 资源删除前检查是否存在未释放分配（机柜/宽带可能有多条）。 */
export async function assertResourceNotAllocated(
  tx: Tx,
  resourceType: AllocationResourceType,
  resourceId: string,
  label: string,
): Promise<void> {
  const field = FIELD_BY_TYPE[resourceType];
  const active = await tx.resourceAllocation.findFirst({
    where: {
      [field]: resourceId,
      releasedAt: null,
    } as Prisma.ResourceAllocationWhereInput,
    select: { id: true },
  });
  if (active) {
    throw new ApiError(
      409,
      `${label}仍存在未释放的资源分配，请先在「资源分配」中释放后再删除`,
      "RESOURCE_ALLOCATED",
    );
  }
}

/**
 * 重算资源上的客户缓存：
 * 有效分配恰好对应 1 个客户时写入，0 个或多个客户时清空。
 */
export async function syncResourceCustomer(
  tx: Tx,
  resourceType: AllocationResourceType,
  resourceId: string,
): Promise<void> {
  if (resourceType === "ipRange") return;
  const field = FIELD_BY_TYPE[resourceType];
  const rows = await tx.resourceAllocation.findMany({
    where: {
      [field]: resourceId,
      releasedAt: null,
      ...(resourceType === "ipBlock" ? { resourceType: "ipBlock" } : {}),
    } as Prisma.ResourceAllocationWhereInput,
    select: { customerId: true },
    distinct: ["customerId"],
  });
  const customerId = rows.length === 1 ? rows[0].customerId : null;
  switch (resourceType) {
    case "rack":
      await tx.rack.update({ where: { id: resourceId }, data: { customerId } });
      return;
    case "ipBlock":
      await tx.ipBlock.update({ where: { id: resourceId }, data: { customerId } });
      return;
    case "ipAddress":
      await tx.ipAddress.update({ where: { id: resourceId }, data: { customerId } });
      return;
    case "vlan":
      await tx.vlan.update({ where: { id: resourceId }, data: { customerId } });
      return;
    case "vxlan":
      await tx.vxlan.update({ where: { id: resourceId }, data: { customerId } });
      return;
    case "broadband":
      await tx.broadband.update({ where: { id: resourceId }, data: { customerId } });
      return;
    case "line":
      await tx.line.update({ where: { id: resourceId }, data: { customerId } });
      return;
    case "device":
      await tx.device.update({ where: { id: resourceId }, data: { customerId } });
      return;
  }
}

export type CreateAllocationInput = {
  customerId: string;
  resourceType: AllocationResourceType;
  resourceId: string;
  allocatedAt?: string | null;
  notes?: string | null;
  /** 机柜分配的子区间（闭区间）。 */
  uStart?: number | null;
  uEnd?: number | null;
  /** 任意 U 位集合：逗号/空白/换行分隔的 U 位或起止区间；优先于起止 U。 */
  uList?: string | null;
  /** IP 区间分配的子区间（闭区间，IPv4）。 */
  ipRangeStart?: string | null;
  ipRangeEnd?: string | null;
  /** 任意 IPv4 集合：逗号/空白/换行分隔的 IP 或起止区间；优先于起止 IP。 */
  ipList?: string | null;
  /** 宽带分配给客户的 MBPS，允许超过宽带总带宽。 */
  allocatedMbps?: number | null;
};

function parseAllocatedAt(value?: string | null): Date {
  const allocatedAt = value ? new Date(value) : new Date();
  if (Number.isNaN(allocatedAt.getTime())) {
    throw new ApiError(422, "分配日期格式不正确", "INVALID_ALLOCATED_AT");
  }
  return allocatedAt;
}

/** 按日期（而非时刻）比较，避免同一天释放被时间部分误判为更早。 */
function dateOnlyUtc(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/** 同一机柜记录下的有效 U 位必须两两互斥。 */
export async function assertRackAllocationsDisjoint(
  tx: Tx,
  rackId: string,
  excludeIds: string[] = [],
): Promise<void> {
  const items = await tx.rackAllocationItem.findMany({
    where: {
      rackId,
      releasedAt: null,
      ...(excludeIds.length > 0 ? { allocationId: { notIn: excludeIds } } : {}),
    },
    orderBy: { uNumber: "asc" },
    select: { uNumber: true },
  });
  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.uNumber)) {
      throw new ApiError(
        409,
        `机柜 U${item.uNumber} 存在重复有效分配，请刷新后重试`,
        "RACK_RANGE_OVERLAP",
      );
    }
    seen.add(item.uNumber);
  }

  // 兼容尚未回填明细的历史分配：其父区间仍视为占用。
  const legacy = await tx.resourceAllocation.findMany({
    where: {
      rackId,
      releasedAt: null,
      uStart: { not: null },
      uEnd: { not: null },
      rackItems: { none: {} },
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    },
    orderBy: [{ uStart: "asc" }, { uEnd: "asc" }],
    select: { uStart: true, uEnd: true },
  });
  for (const row of legacy) {
    for (let u = row.uStart!; u <= row.uEnd!; u += 1) {
      if (seen.has(u)) {
        throw new ApiError(
          409,
          `机柜 U${u} 存在重复有效分配，请刷新后重试`,
          "RACK_RANGE_OVERLAP",
        );
      }
      seen.add(u);
    }
  }
  for (let i = 1; i < legacy.length; i += 1) {
    const previous = legacy[i - 1];
    const current = legacy[i];
    if (
      rangesOverlap(
        previous.uStart!,
        previous.uEnd!,
        current.uStart!,
        current.uEnd!,
      )
    ) {
      throw new ApiError(
        409,
        "机柜分配区间发生重叠，请刷新后重试",
        "RACK_RANGE_OVERLAP",
      );
    }
  }
}

/** 解析分配请求：优先使用 IP/区间列表，否则使用起止 IP。 */
function resolveIpAddressSet(input: {
  ipList?: string | null;
  ipRangeStart?: string | null;
  ipRangeEnd?: string | null;
}): ParsedIpv4List {
  const list = input.ipList?.trim();
  if (list) {
    const parsed = parseIpv4ListInput(list);
    if (!parsed.ok) {
      throw new ApiError(
        422,
        parsed.error,
        parsed.error.includes("最多") ? "IP_RANGE_TOO_LARGE" : "INVALID_IP_LIST",
      );
    }
    return parsed.value;
  }

  if (!input.ipRangeStart || !input.ipRangeEnd) {
    throw new ApiError(
      422,
      "IP 区间分配必须填写起始 IP 和结束 IP，或粘贴 IP/区间列表",
      "IP_RANGE_REQUIRED",
    );
  }
  const range = parseIpRange(`${input.ipRangeStart}-${input.ipRangeEnd}`);
  if (
    !range ||
    range.version !== 4 ||
    range.startLong === null ||
    range.endLong === null
  ) {
    throw new ApiError(
      422,
      "IP 区间格式不正确，起止地址必须为 IPv4 且起始不大于结束",
      "INVALID_IP_RANGE",
    );
  }
  if (range.size === null || range.size > MAX_RANGE_ALLOCATION_ADDRESSES) {
    throw new ApiError(
      422,
      `单次 IP 区间分配最多 ${MAX_RANGE_ALLOCATION_ADDRESSES} 个地址`,
      "IP_RANGE_TOO_LARGE",
    );
  }
  return {
    addresses: Array.from({ length: range.size }, (_, index) =>
      ipv4LongToIp(range.startLong! + index),
    ),
    startLong: range.startLong,
    endLong: range.endLong,
    contiguous: true,
  };
}

/** 解析机柜分配请求：优先使用 U 位列表，否则使用起止 U。 */
function resolveRackUnitSet(input: {
  uList?: string | null;
  uStart?: number | null;
  uEnd?: number | null;
}): ParsedRackUnits {
  const list = input.uList?.trim();
  if (list) {
    const parsed = parseRackUnitListInput(list);
    if (!parsed.ok) {
      throw new ApiError(
        422,
        parsed.error,
        parsed.error.includes("最多") ? "RACK_UNITS_TOO_LARGE" : "INVALID_U_LIST",
      );
    }
    return parsed.value;
  }

  if (
    input.uStart === null ||
    input.uStart === undefined ||
    input.uEnd === null ||
    input.uEnd === undefined ||
    !Number.isInteger(input.uStart) ||
    !Number.isInteger(input.uEnd)
  ) {
    throw new ApiError(
      422,
      "机柜分配必须填写起始 U 位和结束 U 位，或粘贴 U 位列表",
      "RACK_RANGE_REQUIRED",
    );
  }
  if (input.uStart < 1 || input.uEnd < input.uStart) {
    throw new ApiError(
      422,
      "U 位区间不合法，起始必须大于 0 且不能大于结束",
      "INVALID_U_RANGE",
    );
  }
  if (input.uEnd - input.uStart + 1 > MAX_RACK_ALLOCATION_UNITS) {
    throw new ApiError(
      422,
      `单次机柜分配最多 ${MAX_RACK_ALLOCATION_UNITS} 个 U 位`,
      "RACK_UNITS_TOO_LARGE",
    );
  }
  return {
    units: Array.from(
      { length: input.uEnd - input.uStart + 1 },
      (_, index) => input.uStart! + index,
    ),
    start: input.uStart,
    end: input.uEnd,
    contiguous: true,
  };
}

/** 检查一组 U 位是否可被分配占用，冲突时给出明确错误。 */
async function assertRackUnitsAvailable(
  tx: Tx,
  rackId: string,
  units: number[],
): Promise<void> {
  for (const chunk of chunkArray(units)) {
    const item = await tx.rackAllocationItem.findFirst({
      where: { releasedAt: null, rackId, uNumber: { in: chunk } },
      select: {
        uNumber: true,
        allocation: { select: { customer: { select: { name: true } } } },
      },
    });
    if (item) {
      throw new ApiError(
        409,
        `机柜 U${item.uNumber} 已有有效分配（客户 ${item.allocation.customer.name}），请先释放`,
        "RACK_RANGE_OVERLAP",
      );
    }
  }
}

/** 检查一组 IP 是否可被区间/集合分配占用，冲突时给出明确错误。 */
async function assertIpAddressesAvailable(
  tx: Tx,
  addresses: string[],
): Promise<void> {
  for (const chunk of chunkArray(addresses)) {
    const item = await tx.resourceAllocationItem.findFirst({
      where: { releasedAt: null, address: { in: chunk } },
      select: {
        address: true,
        allocation: { select: { customer: { select: { name: true } } } },
      },
    });
    if (item) {
      throw new ApiError(
        409,
        `IP ${item.address} 已有有效 IP 分配（客户 ${item.allocation.customer.name}），请先释放`,
        "IP_RANGE_OVERLAP",
      );
    }
  }

  for (const chunk of chunkArray(addresses, 200)) {
    const rows = await tx.ipAddress.findMany({
      where: {
        address: { in: chunk },
        allocations: {
          some: { resourceType: "ipAddress", releasedAt: null },
        },
      },
      select: {
        address: true,
        allocations: {
          where: { resourceType: "ipAddress", releasedAt: null },
          select: { customer: { select: { name: true } } },
        },
      },
    });
    const row = rows[0];
    if (row) {
      throw new ApiError(
        409,
        `IP ${row.address} 已有有效单 IP 分配（客户 ${row.allocations[0]?.customer.name ?? "其他客户"}），请先释放`,
        "IP_RANGE_HAS_ALLOCATED_ADDRESS",
      );
    }
  }
}

async function assertIpAddressAvailableForSingle(
  tx: Tx,
  address: string,
): Promise<void> {
  const item = await tx.resourceAllocationItem.findFirst({
    where: { releasedAt: null, address },
    select: {
      address: true,
      allocation: { select: { customer: { select: { name: true } } } },
    },
  });
  if (!item) return;
  throw new ApiError(
    409,
    `IP ${item.address} 已被 IP 分配（客户 ${item.allocation.customer.name}）占用，请先释放`,
    "IP_IN_ALLOCATED_RANGE",
  );
}

export async function createAllocation(tx: Tx, input: CreateAllocationInput) {
  const customer = await tx.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, name: true },
  });
  if (!customer) throw new ApiError(422, "所选客户不存在", "CUSTOMER_NOT_FOUND");

  const resource = await getResourceForAllocation(tx, input.resourceType, input.resourceId);
  const allocatedAt = parseAllocatedAt(input.allocatedAt);

  let activeKey: string | null = activeKeyOf(input.resourceType, input.resourceId);
  let uStart: number | null = null;
  let uEnd: number | null = null;
  let ipRangeStart: string | null = null;
  let ipRangeEnd: string | null = null;
  let allocatedMbps: number | null = null;
  let resourceName = resource.name;
  let ipSet: ParsedIpv4List | null = null;
  let rackSet: ParsedRackUnits | null = null;

  if (input.resourceType === "rack") {
    const set = resolveRackUnitSet(input);
    if (resource.uStart === undefined || resource.uEnd === undefined) {
      throw new ApiError(
        422,
        `机柜记录 ${resource.name} 缺少有效 U 位范围`,
        "RACK_RANGE_OUT_OF_BOUNDS",
      );
    }
    const outside = set.units.find(
      (u) => u < resource.uStart! || u > resource.uEnd!,
    );
    if (outside !== undefined) {
      throw new ApiError(
        422,
        `U${outside} 超出机柜记录 ${resource.name} 的范围 ${rackRangeText(resource.uStart, resource.uEnd)}`,
        "RACK_RANGE_OUT_OF_BOUNDS",
      );
    }
    await assertRackUnitsAvailable(tx, input.resourceId, set.units);
    activeKey = null;
    rackSet = set;
    uStart = set.start;
    uEnd = set.end;
    resourceName = `${resource.code ?? resource.name} ${rackRangeText(set.start, set.end)}${
      set.contiguous ? "" : `（${set.units.length} 个非连续 U）`
    }`;
  } else if (input.resourceType === "ipRange") {
    const set = resolveIpAddressSet(input);
    if (resource.status === "container") {
      throw new ApiError(
        422,
        "容器网段不能分配 IP，请选择具体子网段",
        "CONTAINER_BLOCK",
      );
    }
    const blockSpec = parseStoredBlock({
      cidr: resource.name,
      kind: resource.kind,
      rangeStart: resource.rangeStart,
      rangeEnd: resource.rangeEnd,
    });
    if (!blockSpec || blockSpec.version !== 4) {
      throw new ApiError(
        422,
        `IP 段 ${resource.name} 不支持 IPv4 分配`,
        "IP_RANGE_OUTSIDE_BLOCK",
      );
    }
    const outside = set.addresses.find((address) => !ipInBlock(address, blockSpec));
    if (outside) {
      throw new ApiError(
        422,
        `分配地址 ${outside} 必须位于 IP 段 ${resource.name} 内`,
        "IP_RANGE_OUTSIDE_BLOCK",
      );
    }
    const childCount = await tx.ipBlock.count({
      where: { parentId: input.resourceId },
    });
    if (childCount > 0) {
      throw new ApiError(
        422,
        `IP 段 ${resource.name} 下已有 ${childCount} 个子段，请从叶子段分配`,
        "BLOCK_HAS_CHILDREN",
      );
    }

    await assertIpAddressesAvailable(tx, set.addresses);

    activeKey = null;
    ipSet = set;
    ipRangeStart = ipv4LongToIp(set.startLong);
    ipRangeEnd = ipv4LongToIp(set.endLong);
    resourceName = `${resource.name} [${ipRangeStart}-${ipRangeEnd}]${
      set.contiguous ? "" : `（${set.addresses.length} 个非连续 IP）`
    }`;
  } else if (input.resourceType === "broadband") {
    if (
      input.allocatedMbps === null ||
      input.allocatedMbps === undefined ||
      !Number.isInteger(input.allocatedMbps) ||
      input.allocatedMbps <= 0
    ) {
      throw new ApiError(
        422,
        "宽带分配必须填写大于 0 的 MBPS",
        "ALLOCATED_MBPS_REQUIRED",
      );
    }
    activeKey = null;
    allocatedMbps = input.allocatedMbps;
  } else {
    if (input.resourceType === "ipAddress") {
      await assertIpAddressAvailableForSingle(tx, resource.name);
    }

    const field = FIELD_BY_TYPE[input.resourceType];
    const active = await tx.resourceAllocation.findFirst({
      where: {
        [field]: input.resourceId,
        releasedAt: null,
        ...(input.resourceType === "ipBlock" ? { resourceType: "ipBlock" } : {}),
      } as Prisma.ResourceAllocationWhereInput,
      select: { id: true },
    });
    if (active) {
      throw new ApiError(
        409,
        `${resource.name} 已有未释放的分配记录，请先释放`,
        "RESOURCE_ALREADY_ALLOCATED",
      );
    }
  }

  const field = FIELD_BY_TYPE[input.resourceType];
  const data = {
    customerId: input.customerId,
    resourceType: input.resourceType,
    resourceName,
    supplierName: resource.supplierName,
    activeKey,
    uStart,
    uEnd,
    ipRangeStart,
    ipRangeEnd,
    allocatedMbps,
    [field]: input.resourceId,
    allocatedAt,
    notes: input.notes ?? null,
  } as Prisma.ResourceAllocationUncheckedCreateInput;

  const allocation = await tx.resourceAllocation.create({ data });
  if (input.resourceType === "ipRange") {
    if (!ipSet) {
      throw new ApiError(422, "IP 分配集合解析失败", "INVALID_IP_RANGE");
    }
    const ipAddressIds = await ensureAddressesForList(
      tx,
      {
        id: input.resourceId,
        cidr: resource.name,
        kind: resource.kind ?? "cidr",
        rangeStart: resource.rangeStart ?? null,
        rangeEnd: resource.rangeEnd ?? null,
        ipVersion: 4,
        supplierId: resource.supplierId,
      },
      ipSet.addresses,
    );
    await tx.resourceAllocationItem.createMany({
      data: ipSet.addresses.map((address) => ({
        allocationId: allocation.id,
        ipAddressId: ipAddressIds.get(address) ?? null,
        address,
      })),
    });
    await recomputeIpCustomersForAddresses(tx, ipSet.addresses);
  } else if (input.resourceType === "rack") {
    if (!rackSet) {
      throw new ApiError(422, "机柜 U 位集合解析失败", "INVALID_U_LIST");
    }
    for (const chunk of chunkArray(rackSet.units)) {
      await tx.rackAllocationItem.createMany({
        data: chunk.map((uNumber) => ({
          allocationId: allocation.id,
          rackId: input.resourceId,
          uNumber,
        })),
      });
    }
    await syncResourceCustomer(tx, "rack", input.resourceId);
  } else {
    await syncResourceCustomer(tx, input.resourceType, input.resourceId);
  }
  if (input.resourceType === "rack") {
    await assertRackAllocationsDisjoint(tx, input.resourceId);
  }
  return {
    allocation,
    customer,
    resource: { ...resource, name: resourceName },
  };
}

export type IpAllocationOwner = {
  customerId: string;
  customerName: string;
  source: "individual" | "range";
};

/**
 * 查询一个 IP 当前的有效归属。单 IP 分配优先于 IP 区间/集合明细，
 * 与 recomputeIpCustomersForAddresses 的优先级保持一致。
 */
export async function findActiveIpAllocationOwners(
  tx: Tx,
  params: { address: string; ipAddressId?: string | null },
): Promise<IpAllocationOwner[]> {
  const owners = new Map<string, IpAllocationOwner>();

  if (params.ipAddressId) {
    const individual = await tx.resourceAllocation.findMany({
      where: {
        resourceType: "ipAddress",
        releasedAt: null,
        ipAddressId: params.ipAddressId,
      },
      select: {
        customerId: true,
        customer: { select: { name: true } },
      },
    });
    for (const row of individual) {
      owners.set(row.customerId, {
        customerId: row.customerId,
        customerName: row.customer.name,
        source: "individual",
      });
    }
  }

  const items = await tx.resourceAllocationItem.findMany({
    where: {
      releasedAt: null,
      address: params.address,
      allocation: { releasedAt: null },
    },
    select: {
      allocation: {
        select: {
          customerId: true,
          customer: { select: { name: true } },
        },
      },
    },
  });
  for (const item of items) {
    const customerId = item.allocation.customerId;
    if (!owners.has(customerId)) {
      owners.set(customerId, {
        customerId,
        customerName: item.allocation.customer.name,
        source: "range",
      });
    }
  }

  return Array.from(owners.values());
}

/**
 * 导入时把 IP 分配给客户：
 * - 已归属同一客户：幂等，不重复创建分配；
 * - 已归属其他客户：报错，由导入事务整批回滚；
 * - 未归属：复用 createAllocation 创建单 IP 分配。
 */
export async function assignIpAddressOnImport(
  tx: Tx,
  input: {
    ipAddressId: string;
    address: string;
    customerId: string;
    customerName: string;
    allocatedAt?: string | null;
    notes?: string | null;
  },
): Promise<{ created: boolean; allocationId: string | null }> {
  const owners = await findActiveIpAllocationOwners(tx, {
    address: input.address,
    ipAddressId: input.ipAddressId,
  });
  const otherCustomers = owners.filter((owner) => owner.customerId !== input.customerId);
  if (otherCustomers.length > 0) {
    const names = Array.from(new Set(otherCustomers.map((owner) => owner.customerName))).join("、");
    throw new ApiError(
      409,
      `IP ${input.address} 已分配给客户「${names}」，不能再分配给客户「${input.customerName}」；请先在「资源分配」中释放`,
      "IP_ALREADY_ALLOCATED_TO_OTHER_CUSTOMER",
    );
  }
  if (owners.length > 0) {
    return { created: false, allocationId: null };
  }

  const { allocation } = await createAllocation(tx, {
    customerId: input.customerId,
    resourceType: "ipAddress",
    resourceId: input.ipAddressId,
    allocatedAt: input.allocatedAt ?? undefined,
    notes: input.notes ?? "Excel 批量导入",
  });
  return { created: true, allocationId: allocation.id };
}

export type CreationBindableResourceType =
  | "ipAddress"
  | "vlan"
  | "vxlan"
  | "line"
  | "device";

/**
 * 创建资源或 Excel 导入时按客户绑定资源：
 * - 已归属同一客户：幂等，不重复创建分配；
 * - 已归属其他客户：报错，由调用方事务整体回滚；
 * - 未归属：复用 createAllocation 创建分配。
 *
 * IP 地址会额外检查被 IP 区间覆盖的情况，规则与导入保持一致。
 */
export async function assignResourceCustomer(
  tx: Tx,
  input: {
    resourceType: CreationBindableResourceType;
    resourceId: string;
    customerId: string;
    allocatedAt?: string | null;
    notes?: string | null;
  },
): Promise<{ created: boolean; allocationId: string | null }> {
  const customer = await tx.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, name: true },
  });
  if (!customer) throw new ApiError(422, "所选客户不存在", "CUSTOMER_NOT_FOUND");

  const resource = await getResourceForAllocation(tx, input.resourceType, input.resourceId);
  if (input.resourceType === "ipAddress") {
    const result = await assignIpAddressOnImport(tx, {
      ipAddressId: input.resourceId,
      address: resource.name,
      customerId: customer.id,
      customerName: customer.name,
      allocatedAt: input.allocatedAt,
      notes: input.notes ?? "创建资源时绑定",
    });
    // 单 IP 分配不存在但可能被 IP 区间覆盖；syncResourceCustomer 看不到区间明细。
    if (!result.created) {
      await recomputeIpCustomersForAddresses(tx, [resource.name]);
    }
    return result;
  }

  const field = FIELD_BY_TYPE[input.resourceType];
  const active = await tx.resourceAllocation.findFirst({
    where: {
      resourceType: input.resourceType,
      [field]: input.resourceId,
      releasedAt: null,
    } as Prisma.ResourceAllocationWhereInput,
    select: {
      customerId: true,
      customer: { select: { name: true } },
    },
  });
  if (active) {
    if (active.customerId !== customer.id) {
      throw new ApiError(
        409,
        `${resource.name} 已分配给客户「${active.customer.name}」，不能再分配给客户「${customer.name}」；请先在「资源分配」中释放`,
        "RESOURCE_ALREADY_ALLOCATED",
      );
    }
    await syncResourceCustomer(tx, input.resourceType, input.resourceId);
    return { created: false, allocationId: null };
  }

  const { allocation } = await createAllocation(tx, {
    customerId: customer.id,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    allocatedAt: input.allocatedAt ?? undefined,
    notes: input.notes ?? "创建资源时绑定",
  });
  return { created: true, allocationId: allocation.id };
}

export type ReleaseAllocationOptions = {
  releasedAt?: string | null;
  /** 仅释放指定 IP（IP/区间列表）；为空则释放该分配下全部有效 IP。 */
  ipList?: string | null;
  /** 仅释放指定 U 位（U 位列表）；为空则释放该分配下全部有效 U 位。 */
  uList?: string | null;
  releaseNote?: string | null;
  releasedByName?: string | null;
  /** 批量释放时共享的批次 ID；为空时自动生成。 */
  batchId?: string | null;
};

type AllocationWithCustomer = Prisma.ResourceAllocationGetPayload<{
  include: { customer: { select: { id: true; name: true } } };
}>;

async function releaseIpAllocation(
  tx: Tx,
  allocation: AllocationWithCustomer,
  releasedAt: Date,
  options: ReleaseAllocationOptions,
) {
  let items = await tx.resourceAllocationItem.findMany({
    where: { allocationId: allocation.id },
    select: { address: true, releasedAt: true },
    orderBy: { address: "asc" },
  });

  // 兼容尚未回填明细的历史区间分配：首次释放时补建明细。
  if (
    items.length === 0 &&
    allocation.ipRangeStart &&
    allocation.ipRangeEnd
  ) {
    const legacy = parseIpRange(
      `${allocation.ipRangeStart}-${allocation.ipRangeEnd}`,
    );
    if (
      legacy &&
      legacy.version === 4 &&
      legacy.startLong !== null &&
      legacy.endLong !== null &&
      legacy.size !== null &&
      legacy.size <= MAX_RANGE_ALLOCATION_ADDRESSES
    ) {
      const addresses = Array.from({ length: legacy.size }, (_, index) =>
        ipv4LongToIp(legacy.startLong! + index),
      );
      let ipAddressIds = new Map<string, string>();
      if (allocation.ipBlockId) {
        const block = await tx.ipBlock.findUnique({
          where: { id: allocation.ipBlockId },
          select: {
            id: true,
            cidr: true,
            kind: true,
            rangeStart: true,
            rangeEnd: true,
            ipVersion: true,
            supplierId: true,
          },
        });
        if (block) {
          ipAddressIds = await ensureAddressesForList(
            tx,
            {
              id: block.id,
              cidr: block.cidr,
              kind: block.kind,
              rangeStart: block.rangeStart,
              rangeEnd: block.rangeEnd,
              ipVersion: block.ipVersion,
              supplierId: block.supplierId,
            },
            addresses,
          );
        }
      }
      await tx.resourceAllocationItem.createMany({
        data: addresses.map((address) => ({
          allocationId: allocation.id,
          ipAddressId: ipAddressIds.get(address) ?? null,
          address,
        })),
      });
      items = addresses.map((address) => ({ address, releasedAt: null }));
    }
  }

  const releaseBatchId = options.batchId?.trim() || randomUUID();

  if (items.length === 0) {
    const updated = await tx.resourceAllocation.update({
      where: { id: allocation.id },
      data: {
        releasedAt,
        activeKey: null,
        releaseNote: options.releaseNote ?? null,
        releasedByName: options.releasedByName ?? null,
        releaseBatchId,
      },
    });
    return {
      allocation: updated,
      customer: allocation.customer,
      before: allocation,
      releasedCount: 0,
      remainingCount: 0,
      releaseBatchId,
      parentReleased: true,
    };
  }

  const itemAddresses = new Set(items.map((item) => item.address));
  const activeAddresses = new Set(
    items
      .filter((item) => item.releasedAt === null)
      .map((item) => item.address),
  );
  let targets: string[];

  if (options.ipList?.trim()) {
    const parsed = parseIpv4ListInput(options.ipList);
    if (!parsed.ok) {
      throw new ApiError(422, parsed.error, "INVALID_IP_LIST");
    }
    const notInAllocation = parsed.value.addresses.filter(
      (address) => !itemAddresses.has(address),
    );
    if (notInAllocation.length > 0) {
      throw new ApiError(
        422,
        `以下 IP 不属于该分配：${notInAllocation.slice(0, 10).join("、")}${
          notInAllocation.length > 10 ? ` 等 ${notInAllocation.length} 个` : ""
        }`,
        "IP_NOT_IN_ALLOCATION",
      );
    }
    const alreadyReleased = parsed.value.addresses.filter(
      (address) => !activeAddresses.has(address),
    );
    if (alreadyReleased.length > 0) {
      throw new ApiError(
        409,
        `以下 IP 已释放或不在有效状态：${alreadyReleased.slice(0, 10).join("、")}${
          alreadyReleased.length > 10 ? ` 等 ${alreadyReleased.length} 个` : ""
        }`,
        "IP_ALREADY_RELEASED",
      );
    }
    targets = parsed.value.addresses;
  } else {
    targets = Array.from(activeAddresses);
  }

  if (targets.length === 0) {
    const updated = await tx.resourceAllocation.update({
      where: { id: allocation.id },
      data: {
        releasedAt,
        activeKey: null,
        releaseNote: options.releaseNote ?? null,
        releasedByName: options.releasedByName ?? null,
        releaseBatchId,
      },
    });
    return {
      allocation: updated,
      customer: allocation.customer,
      before: allocation,
      releasedCount: 0,
      remainingCount: 0,
      releaseBatchId,
      parentReleased: true,
    };
  }

  const updatedItems = await tx.resourceAllocationItem.updateMany({
    where: {
      allocationId: allocation.id,
      releasedAt: null,
      address: { in: targets },
    },
    data: {
      releasedAt,
      releaseBatchId,
      releaseNote: options.releaseNote ?? null,
      releasedByName: options.releasedByName ?? null,
    },
  });
  if (updatedItems.count !== targets.length) {
    throw new ApiError(
      409,
      "IP 分配状态已变化，请刷新后重试",
      "IP_RELEASE_CONFLICT",
    );
  }

  const remainingCount = await tx.resourceAllocationItem.count({
    where: { allocationId: allocation.id, releasedAt: null },
  });
  const parentReleased = remainingCount === 0;
  const updatedAllocation = parentReleased
    ? await tx.resourceAllocation.update({
        where: { id: allocation.id },
        data: {
          releasedAt,
          activeKey: null,
          releaseNote: options.releaseNote ?? null,
          releasedByName: options.releasedByName ?? null,
          releaseBatchId,
        },
      })
    : await tx.resourceAllocation.findUniqueOrThrow({
        where: { id: allocation.id },
      });

  await recomputeIpCustomersForAddresses(tx, targets);

  return {
    allocation: updatedAllocation,
    customer: allocation.customer,
    before: allocation,
    releasedCount: targets.length,
    remainingCount,
    releaseBatchId,
    parentReleased,
  };
}

async function releaseRackAllocation(
  tx: Tx,
  allocation: AllocationWithCustomer,
  releasedAt: Date,
  options: ReleaseAllocationOptions,
) {
  let items = await tx.rackAllocationItem.findMany({
    where: { allocationId: allocation.id },
    select: { uNumber: true, releasedAt: true },
    orderBy: { uNumber: "asc" },
  });

  // 兼容尚未回填明细的历史区间分配：首次释放时补建明细。
  if (
    items.length === 0 &&
    allocation.rackId &&
    allocation.uStart !== null &&
    allocation.uEnd !== null
  ) {
    const units = Array.from(
      { length: allocation.uEnd - allocation.uStart + 1 },
      (_, index) => allocation.uStart! + index,
    );
    for (const chunk of chunkArray(units)) {
      await tx.rackAllocationItem.createMany({
        data: chunk.map((uNumber) => ({
          allocationId: allocation.id,
          rackId: allocation.rackId!,
          uNumber,
        })),
      });
    }
    items = units.map((uNumber) => ({ uNumber, releasedAt: null }));
  }

  const releaseBatchId = options.batchId?.trim() || randomUUID();

  if (items.length === 0) {
    const updated = await tx.resourceAllocation.update({
      where: { id: allocation.id },
      data: {
        releasedAt,
        activeKey: null,
        releaseNote: options.releaseNote ?? null,
        releasedByName: options.releasedByName ?? null,
        releaseBatchId,
      },
    });
    return {
      allocation: updated,
      customer: allocation.customer,
      before: allocation,
      releasedCount: 0,
      remainingCount: 0,
      releaseBatchId,
      parentReleased: true,
    };
  }

  const itemUnits = new Set(items.map((item) => item.uNumber));
  const activeUnits = new Set(
    items.filter((item) => item.releasedAt === null).map((item) => item.uNumber),
  );
  let targets: number[];

  if (options.uList?.trim()) {
    const parsed = parseRackUnitListInput(options.uList);
    if (!parsed.ok) {
      throw new ApiError(422, parsed.error, "INVALID_U_LIST");
    }
    const notInAllocation = parsed.value.units.filter(
      (u) => !itemUnits.has(u),
    );
    if (notInAllocation.length > 0) {
      throw new ApiError(
        422,
        `以下 U 位不属于该分配：${notInAllocation
          .slice(0, 10)
          .map((u) => `U${u}`)
          .join("、")}${
          notInAllocation.length > 10 ? ` 等 ${notInAllocation.length} 个` : ""
        }`,
        "UNIT_NOT_IN_ALLOCATION",
      );
    }
    const alreadyReleased = parsed.value.units.filter(
      (u) => !activeUnits.has(u),
    );
    if (alreadyReleased.length > 0) {
      throw new ApiError(
        409,
        `以下 U 位已释放或不在有效状态：${alreadyReleased
          .slice(0, 10)
          .map((u) => `U${u}`)
          .join("、")}${
          alreadyReleased.length > 10 ? ` 等 ${alreadyReleased.length} 个` : ""
        }`,
        "UNIT_ALREADY_RELEASED",
      );
    }
    targets = parsed.value.units;
  } else {
    targets = Array.from(activeUnits);
  }

  if (targets.length === 0) {
    const updated = await tx.resourceAllocation.update({
      where: { id: allocation.id },
      data: {
        releasedAt,
        activeKey: null,
        releaseNote: options.releaseNote ?? null,
        releasedByName: options.releasedByName ?? null,
        releaseBatchId,
      },
    });
    return {
      allocation: updated,
      customer: allocation.customer,
      before: allocation,
      releasedCount: 0,
      remainingCount: 0,
      releaseBatchId,
      parentReleased: true,
    };
  }

  const updatedItems = await tx.rackAllocationItem.updateMany({
    where: {
      allocationId: allocation.id,
      releasedAt: null,
      uNumber: { in: targets },
    },
    data: {
      releasedAt,
      releaseBatchId,
      releaseNote: options.releaseNote ?? null,
      releasedByName: options.releasedByName ?? null,
    },
  });
  if (updatedItems.count !== targets.length) {
    throw new ApiError(
      409,
      "机柜 U 位分配状态已变化，请刷新后重试",
      "RACK_RELEASE_CONFLICT",
    );
  }

  const remainingCount = await tx.rackAllocationItem.count({
    where: { allocationId: allocation.id, releasedAt: null },
  });
  const parentReleased = remainingCount === 0;
  const updatedAllocation = parentReleased
    ? await tx.resourceAllocation.update({
        where: { id: allocation.id },
        data: {
          releasedAt,
          activeKey: null,
          releaseNote: options.releaseNote ?? null,
          releasedByName: options.releasedByName ?? null,
          releaseBatchId,
        },
      })
    : await tx.resourceAllocation.findUniqueOrThrow({
        where: { id: allocation.id },
      });

  if (allocation.rackId) {
    await syncResourceCustomer(tx, "rack", allocation.rackId);
  }

  return {
    allocation: updatedAllocation,
    customer: allocation.customer,
    before: allocation,
    releasedCount: targets.length,
    remainingCount,
    releaseBatchId,
    parentReleased,
  };
}

export async function releaseAllocation(
  tx: Tx,
  id: string,
  options?: string | null | ReleaseAllocationOptions,
) {
  const opts: ReleaseAllocationOptions =
    typeof options === "string" || options === null || options === undefined
      ? { releasedAt: options ?? null }
      : options;

  const allocation = await tx.resourceAllocation.findUnique({
    where: { id },
    include: { customer: { select: { id: true, name: true } } },
  });
  if (!allocation) throw new ApiError(404, "分配记录不存在", "NOT_FOUND");
  if (allocation.releasedAt) {
    throw new ApiError(409, "该分配记录已释放", "ALREADY_RELEASED");
  }

  const releasedAt = opts.releasedAt ? new Date(opts.releasedAt) : new Date();
  if (Number.isNaN(releasedAt.getTime())) {
    throw new ApiError(422, "释放日期格式不正确", "INVALID_RELEASED_AT");
  }
  if (dateOnlyUtc(releasedAt) < dateOnlyUtc(allocation.allocatedAt)) {
    throw new ApiError(422, "释放日期不能早于分配日期", "RELEASE_BEFORE_ALLOCATED");
  }

  if (allocation.resourceType === "ipRange") {
    if (opts.uList?.trim()) {
      throw new ApiError(
        422,
        "IP 区间/集合分配不支持按 U 位释放",
        "U_RELEASE_UNSUPPORTED",
      );
    }
    return releaseIpAllocation(tx, allocation, releasedAt, opts);
  }

  if (allocation.resourceType === "rack") {
    if (opts.ipList?.trim()) {
      throw new ApiError(
        422,
        "机柜分配不支持按 IP 释放",
        "IP_RELEASE_UNSUPPORTED",
      );
    }
    return releaseRackAllocation(tx, allocation, releasedAt, opts);
  }

  if (opts.ipList?.trim()) {
    throw new ApiError(
      422,
      "仅 IP 区间/集合分配支持按 IP 释放",
      "IP_RELEASE_UNSUPPORTED",
    );
  }
  if (opts.uList?.trim()) {
    throw new ApiError(
      422,
      "仅机柜分配支持按 U 位释放",
      "U_RELEASE_UNSUPPORTED",
    );
  }

  const releaseBatchId = opts.batchId?.trim() || randomUUID();
  const updated = await tx.resourceAllocation.update({
    where: { id },
    data: {
      releasedAt,
      activeKey: null,
      releaseNote: opts.releaseNote ?? null,
      releasedByName: opts.releasedByName ?? null,
      releaseBatchId,
    },
  });

  const resourceType = allocation.resourceType;
  if (isAllocationResourceType(resourceType)) {
    const resourceId =
      allocation.rackId ??
      allocation.ipBlockId ??
      allocation.ipAddressId ??
      allocation.vlanId ??
      allocation.vxlanId ??
      allocation.broadbandId ??
      allocation.lineId ??
      allocation.deviceId;
    if (resourceId) {
      await syncResourceCustomer(tx, resourceType, resourceId);
    }
  }

  return {
    allocation: updated,
    customer: allocation.customer,
    before: allocation,
    releasedCount: 0,
    remainingCount: 0,
    releaseBatchId,
    parentReleased: true,
  };
}

export type BatchReleaseInput = {
  ids: string[];
  releasedAt?: string | null;
  releaseNote?: string | null;
  releasedByName?: string | null;
};

/**
 * 批量释放多条分配记录（整条释放）。
 * 共用同一个 releaseBatchId，便于在释放记录中追溯同一次操作。
 */
export async function releaseAllocations(tx: Tx, input: BatchReleaseInput) {
  const ids = Array.from(new Set(input.ids));
  if (ids.length === 0) {
    throw new ApiError(422, "请选择要释放的分配记录", "NO_ALLOCATION_SELECTED");
  }
  if (ids.length > 200) {
    throw new ApiError(422, "单次最多释放 200 条分配记录", "TOO_MANY_ALLOCATIONS");
  }

  const rows = await tx.resourceAllocation.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      customerId: true,
      resourceType: true,
      resourceName: true,
      releasedAt: true,
    },
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = rowById.get(id);
    if (!row) {
      throw new ApiError(404, "待释放的分配记录不存在", "NOT_FOUND");
    }
    if (row.releasedAt) {
      throw new ApiError(
        409,
        `分配记录「${row.resourceName}」已释放`,
        "ALREADY_RELEASED",
      );
    }
  }

  const releaseBatchId = randomUUID();
  const results = [];
  for (const id of ids) {
    const released = await releaseAllocation(tx, id, {
      releasedAt: input.releasedAt,
      releaseNote: input.releaseNote,
      releasedByName: input.releasedByName,
      batchId: releaseBatchId,
    });
    results.push({
      id: released.allocation.id,
      customerId: released.customer.id,
      customerName: released.customer.name,
      resourceType: released.before.resourceType,
      resourceName: released.before.resourceName,
      releasedCount: released.releasedCount,
      remainingCount: released.remainingCount,
      parentReleased: released.parentReleased,
    });
  }

  return {
    releaseBatchId,
    released: results.length,
    totalUnits: results.reduce((sum, row) => sum + row.releasedCount, 0),
    results,
  };
}

export type BatchCreateInput = Omit<CreateAllocationInput, "customerId">;

export type BatchAllocationGroupInput = {
  customerId: string;
  releases: string[];
  creates: BatchCreateInput[];
};

export type SaveBatchAllocationsInput = {
  allocatedAt?: string | null;
  releasedAt?: string | null;
  notes?: string | null;
  groups: BatchAllocationGroupInput[];
};

/**
 * 多客户、多资源批量保存：一个事务内先释放全部、再新增全部。
 * 任一校验或写入失败则整批回滚。
 */
export async function saveBatchAllocations(tx: Tx, input: SaveBatchAllocationsInput) {
  if (input.groups.length === 0) {
    throw new ApiError(422, "请至少添加一个客户分组", "NO_CUSTOMER_GROUP");
  }
  const customerIds = input.groups.map((group) => group.customerId);
  if (new Set(customerIds).size !== customerIds.length) {
    throw new ApiError(422, "同一批保存中不能重复选择客户", "DUPLICATE_CUSTOMER");
  }
  const changeCount = input.groups.reduce(
    (sum, group) => sum + group.releases.length + group.creates.length,
    0,
  );
  if (changeCount === 0) {
    throw new ApiError(422, "请至少新增或释放一项资源", "NO_ALLOCATION_CHANGES");
  }

  const customers = await tx.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, name: true },
  });
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const missingCustomer = customerIds.find((id) => !customerById.has(id));
  if (missingCustomer) {
    throw new ApiError(422, "所选客户不存在", "CUSTOMER_NOT_FOUND");
  }

  const releaseIds = input.groups.flatMap((group) => group.releases);
  if (new Set(releaseIds).size !== releaseIds.length) {
    throw new ApiError(422, "同一分配记录不能重复释放", "DUPLICATE_RELEASE");
  }
  const releaseRows =
    releaseIds.length > 0
      ? await tx.resourceAllocation.findMany({
          where: { id: { in: releaseIds } },
          select: {
            id: true,
            customerId: true,
            resourceName: true,
            releasedAt: true,
            allocatedAt: true,
          },
        })
      : [];
  const releaseById = new Map(releaseRows.map((row) => [row.id, row]));
  for (const group of input.groups) {
    for (const id of group.releases) {
      const row = releaseById.get(id);
      if (!row) {
        throw new ApiError(404, "待释放的分配记录不存在", "NOT_FOUND");
      }
      if (row.customerId !== group.customerId) {
        throw new ApiError(
          422,
          `分配记录「${row.resourceName}」不属于所选客户`,
          "RELEASE_CUSTOMER_MISMATCH",
        );
      }
      if (row.releasedAt) {
        throw new ApiError(409, "待释放的分配记录已释放", "ALREADY_RELEASED");
      }
    }
  }

  const releasedResults: Array<{
    id: string;
    customerId: string;
    customerName: string;
    resourceName: string;
    allocatedAt: Date;
    releasedAt: Date;
  }> = [];
  for (const id of releaseIds) {
    const result = await releaseAllocation(tx, id, input.releasedAt);
    releasedResults.push({
      id: result.allocation.id,
      customerId: result.customer.id,
      customerName: result.customer.name,
      resourceName: result.before.resourceName,
      allocatedAt: result.before.allocatedAt,
      releasedAt: result.allocation.releasedAt!,
    });
  }

  const createdResults: Array<{
    id: string;
    customerId: string;
    customerName: string;
    resourceType: AllocationResourceType;
    resourceId: string;
    resourceName: string;
    allocatedAt: Date;
  }> = [];
  const touchedRacks = new Set<string>();
  for (const group of input.groups) {
    for (const create of group.creates) {
      if (!isAllocationResourceType(create.resourceType)) {
        throw new ApiError(422, "资源类型不合法", "INVALID_RESOURCE_TYPE");
      }
      const result = await createAllocation(tx, {
        ...create,
        customerId: group.customerId,
        allocatedAt: input.allocatedAt,
        notes: input.notes ?? create.notes ?? null,
      });
      createdResults.push({
        id: result.allocation.id,
        customerId: group.customerId,
        customerName: result.customer.name,
        resourceType: create.resourceType,
        resourceId: create.resourceId,
        resourceName: result.resource.name,
        allocatedAt: result.allocation.allocatedAt,
      });
      if (create.resourceType === "rack") touchedRacks.add(create.resourceId);
    }
  }

  for (const rackId of touchedRacks) {
    await assertRackAllocationsDisjoint(tx, rackId);
  }

  return {
    created: createdResults.length,
    released: releasedResults.length,
    creates: createdResults,
    releases: releasedResults,
  };
}
