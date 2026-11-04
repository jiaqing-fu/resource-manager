import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";
import {
  blockContainsBlock,
  ipv4LongToIp,
  ipv4ToLong,
  MAX_RANGE_ALLOCATION_ADDRESSES,
  parseIpRange,
  parseStoredBlock,
  rangeToBlock,
} from "@/lib/ip";
import { rackRangeText } from "@/lib/rack";
import { rangeWithin, rangesOverlap, subtractRanges } from "@/lib/ranges";
import { ensureAddressesInSpan, recomputeIpCustomersForSpan } from "./ipam";

type Tx = Prisma.TransactionClient;

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
          allocations: {
            where: { releasedAt: null },
            select: {
              id: true,
              customerId: true,
              customer: { select: { name: true } },
              uStart: true,
              uEnd: true,
            },
          },
        },
      });
      return rows.map((r) => {
        const occupiedRanges = r.allocations
          .filter(
            (allocation) =>
              allocation.uStart !== null && allocation.uEnd !== null,
          )
          .map((allocation) => ({
            allocationId: allocation.id,
            customerId: allocation.customerId,
            customerName: allocation.customer?.name ?? "",
            uStart: allocation.uStart!,
            uEnd: allocation.uEnd!,
          }));
        const customerIds = new Set(r.allocations.map((allocation) => allocation.customerId));
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
      const [rangeAllocations, individualAllocations] = await Promise.all([
        tx.resourceAllocation.findMany({
          where: { resourceType: "ipRange", releasedAt: null },
          select: {
            id: true,
            customerId: true,
            customer: { select: { name: true } },
            ipRangeStart: true,
            ipRangeEnd: true,
          },
        }),
        tx.resourceAllocation.findMany({
          where: {
            resourceType: "ipAddress",
            releasedAt: null,
            ipAddressId: { not: null },
          },
          select: {
            id: true,
            customerId: true,
            customer: { select: { name: true } },
            ipAddress: { select: { address: true } },
          },
        }),
      ]);
      const occupiedRanges = rangeAllocations.flatMap((row) => {
        if (!row.ipRangeStart || !row.ipRangeEnd) return [];
        const range = parseIpRange(`${row.ipRangeStart}-${row.ipRangeEnd}`);
        if (
          !range ||
          range.version !== 4 ||
          range.startLong === null ||
          range.endLong === null
        ) {
          return [];
        }
        return [
          {
            allocationId: row.id,
            customerId: row.customerId,
            customerName: row.customer?.name ?? "",
            start: range.startLong,
            end: range.endLong,
          },
        ];
      });
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
  /** IP 区间分配的子区间（闭区间，IPv4）。 */
  ipRangeStart?: string | null;
  ipRangeEnd?: string | null;
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

/** 同一机柜记录下的有效分配区间必须两两互斥。 */
export async function assertRackAllocationsDisjoint(
  tx: Tx,
  rackId: string,
  excludeIds: string[] = [],
): Promise<void> {
  const rows = await tx.resourceAllocation.findMany({
    where: {
      rackId,
      releasedAt: null,
      uStart: { not: null },
      uEnd: { not: null },
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    },
    orderBy: [{ uStart: "asc" }, { uEnd: "asc" }],
    select: { uStart: true, uEnd: true },
  });
  for (let i = 1; i < rows.length; i += 1) {
    const previous = rows[i - 1];
    const current = rows[i];
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

/** 所有有效 IP 区间分配必须两两互斥（跨父子段同样检查）。 */
export async function assertIpRangeAllocationsDisjoint(
  tx: Tx,
  excludeIds: string[] = [],
): Promise<void> {
  const rows = await tx.resourceAllocation.findMany({
    where: {
      resourceType: "ipRange",
      releasedAt: null,
      ipRangeStart: { not: null },
      ipRangeEnd: { not: null },
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    },
    orderBy: [{ ipRangeStart: "asc" }, { ipRangeEnd: "asc" }],
    select: { ipRangeStart: true, ipRangeEnd: true },
  });
  const parsed = rows
    .map((row) => parseIpRange(`${row.ipRangeStart}-${row.ipRangeEnd}`))
    .filter(
      (range): range is NonNullable<typeof range> =>
        Boolean(range && range.startLong !== null && range.endLong !== null),
    )
    .sort((a, b) => a.startLong! - b.startLong! || a.endLong! - b.endLong!);
  for (let i = 1; i < parsed.length; i += 1) {
    const previous = parsed[i - 1];
    const current = parsed[i];
    if (rangesOverlap(previous.startLong!, previous.endLong!, current.startLong!, current.endLong!)) {
      throw new ApiError(
        409,
        `IP 区间分配发生重叠：${previous.canonical} 与 ${current.canonical}`,
        "IP_RANGE_OVERLAP",
      );
    }
  }
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

  if (input.resourceType === "rack") {
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
        "机柜分配必须填写起始 U 位和结束 U 位",
        "RACK_RANGE_REQUIRED",
      );
    }
    if (
      resource.uStart === undefined ||
      resource.uEnd === undefined ||
      !rangeWithin(input.uStart, input.uEnd, resource.uStart, resource.uEnd)
    ) {
      throw new ApiError(
        422,
        `分配区间 ${rackRangeText(input.uStart, input.uEnd)} 超出机柜记录 ${resource.name} 的范围`,
        "RACK_RANGE_OUT_OF_BOUNDS",
      );
    }
    const others = await tx.resourceAllocation.findMany({
      where: {
        rackId: input.resourceId,
        releasedAt: null,
        uStart: { not: null },
        uEnd: { not: null },
      },
      select: { uStart: true, uEnd: true },
    });
    const conflict = others.find((other) =>
      rangesOverlap(input.uStart!, input.uEnd!, other.uStart!, other.uEnd!),
    );
    if (conflict) {
      throw new ApiError(
        409,
        `分配区间 ${rackRangeText(input.uStart, input.uEnd)} 与机柜已有有效分配 ${rackRangeText(conflict.uStart!, conflict.uEnd!)} 重叠`,
        "RACK_RANGE_OVERLAP",
      );
    }
    activeKey = null;
    uStart = input.uStart;
    uEnd = input.uEnd;
    resourceName = `${resource.code ?? resource.name} ${rackRangeText(input.uStart, input.uEnd)}`;
  } else if (input.resourceType === "ipRange") {
    if (!input.ipRangeStart || !input.ipRangeEnd) {
      throw new ApiError(
        422,
        "IP 区间分配必须填写起始 IP 和结束 IP",
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
    if (resource.status === "container") {
      throw new ApiError(
        422,
        "容器网段不能分配 IP 区间，请选择具体子网段",
        "CONTAINER_BLOCK",
      );
    }
    const blockSpec = parseStoredBlock({
      cidr: resource.name,
      kind: resource.kind,
      rangeStart: resource.rangeStart,
      rangeEnd: resource.rangeEnd,
    });
    const rangeSpec = rangeToBlock(range);
    if (
      !blockSpec ||
      !rangeSpec ||
      !blockContainsBlock(blockSpec, rangeSpec)
    ) {
      throw new ApiError(
        422,
        `分配区间 ${range.canonical} 必须位于 IP 段 ${resource.name} 内`,
        "IP_RANGE_OUTSIDE_BLOCK",
      );
    }
    const childCount = await tx.ipBlock.count({
      where: { parentId: input.resourceId },
    });
    if (childCount > 0) {
      throw new ApiError(
        422,
        `IP 段 ${resource.name} 下已有 ${childCount} 个子段，请从叶子段分配区间`,
        "BLOCK_HAS_CHILDREN",
      );
    }

    const activeRanges = await tx.resourceAllocation.findMany({
      where: { resourceType: "ipRange", releasedAt: null },
      select: {
        ipRangeStart: true,
        ipRangeEnd: true,
        customer: { select: { name: true } },
      },
    });
    for (const other of activeRanges) {
      if (!other.ipRangeStart || !other.ipRangeEnd) continue;
      const otherRange = parseIpRange(`${other.ipRangeStart}-${other.ipRangeEnd}`);
      if (
        !otherRange ||
        otherRange.startLong === null ||
        otherRange.endLong === null
      ) {
        continue;
      }
      if (
        rangesOverlap(
          range.startLong,
          range.endLong,
          otherRange.startLong,
          otherRange.endLong,
        )
      ) {
        throw new ApiError(
          409,
          `分配区间 ${range.canonical} 与已有区间分配 ${otherRange.canonical}（客户 ${other.customer.name}）重叠`,
          "IP_RANGE_OVERLAP",
        );
      }
    }

    const activeIpAllocations = await tx.resourceAllocation.findMany({
      where: {
        resourceType: "ipAddress",
        releasedAt: null,
        ipAddressId: { not: null },
      },
      select: {
        customer: { select: { name: true } },
        ipAddress: { select: { address: true } },
      },
    });
    const allocatedIp = activeIpAllocations.find((other) => {
      if (!other.ipAddress?.address) return false;
      const n = ipv4ToLong(other.ipAddress.address);
      return n !== null && n >= range.startLong! && n <= range.endLong!;
    });
    if (allocatedIp?.ipAddress?.address) {
      throw new ApiError(
        409,
        `区间内 IP ${allocatedIp.ipAddress.address} 已有有效单 IP 分配（客户 ${allocatedIp.customer.name}），请先释放`,
        "IP_RANGE_HAS_ALLOCATED_ADDRESS",
      );
    }

    activeKey = null;
    ipRangeStart = range.start;
    ipRangeEnd = range.end;
    resourceName = `${resource.name} [${range.start}-${range.end}]`;
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
      const n = ipv4ToLong(resource.name);
      if (n !== null) {
        const activeRanges = await tx.resourceAllocation.findMany({
          where: { resourceType: "ipRange", releasedAt: null },
          select: {
            ipRangeStart: true,
            ipRangeEnd: true,
            customer: { select: { name: true } },
          },
        });
        for (const other of activeRanges) {
          if (!other.ipRangeStart || !other.ipRangeEnd) continue;
          const range = parseIpRange(`${other.ipRangeStart}-${other.ipRangeEnd}`);
          if (
            range &&
            range.startLong !== null &&
            range.endLong !== null &&
            n >= range.startLong &&
            n <= range.endLong
          ) {
            throw new ApiError(
              409,
              `IP ${resource.name} 已被区间分配 ${range.canonical}（客户 ${other.customer.name}）占用，请先释放`,
              "IP_IN_ALLOCATED_RANGE",
            );
          }
        }
      }
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
    const range = parseIpRange(`${ipRangeStart}-${ipRangeEnd}`);
    if (!range || range.version !== 4) {
      throw new ApiError(422, "IP 区间格式不正确", "INVALID_IP_RANGE");
    }
    await ensureAddressesInSpan(
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
      range.start,
      range.end,
    );
    await recomputeIpCustomersForSpan(tx, range.start, range.end);
    await assertIpRangeAllocationsDisjoint(tx);
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

export async function releaseAllocation(
  tx: Tx,
  id: string,
  releasedAtInput?: string | null,
) {
  const allocation = await tx.resourceAllocation.findUnique({
    where: { id },
    include: { customer: { select: { id: true, name: true } } },
  });
  if (!allocation) throw new ApiError(404, "分配记录不存在", "NOT_FOUND");
  if (allocation.releasedAt) {
    throw new ApiError(409, "该分配记录已释放", "ALREADY_RELEASED");
  }
  const releasedAt = releasedAtInput ? new Date(releasedAtInput) : new Date();
  if (Number.isNaN(releasedAt.getTime())) {
    throw new ApiError(422, "释放日期格式不正确", "INVALID_RELEASED_AT");
  }
  if (dateOnlyUtc(releasedAt) < dateOnlyUtc(allocation.allocatedAt)) {
    throw new ApiError(422, "释放日期不能早于分配日期", "RELEASE_BEFORE_ALLOCATED");
  }

  const updated = await tx.resourceAllocation.update({
    where: { id },
    data: { releasedAt, activeKey: null },
  });

  const resourceType = allocation.resourceType;
  if (isAllocationResourceType(resourceType)) {
    if (resourceType === "ipRange") {
      if (allocation.ipRangeStart && allocation.ipRangeEnd) {
        await recomputeIpCustomersForSpan(
          tx,
          allocation.ipRangeStart,
          allocation.ipRangeEnd,
        );
      }
    } else {
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
  }

  return { allocation: updated, customer: allocation.customer, before: allocation };
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
