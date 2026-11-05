import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handleApiError, jsonOk, queryValue, requireUser } from "@/lib/api";
import {
  ALLOCATION_RESOURCE_TYPES,
  BROADBAND_STATUS,
  labelOf,
  LINE_STATUS,
  NOTIFICATION_STATUS,
  PARTY_LEVELS,
} from "@/lib/enums";
import { ipInBlock, parseIp, parseStoredBlock } from "@/lib/ip";

export const dynamic = "force-dynamic";

type Item = { id: string; title: string; subtitle: string; href: string };

type BlockRow = {
  id: string;
  cidr: string;
  status: string;
  kind: string;
  rangeStart: string | null;
  rangeEnd: string | null;
};

type AllocationRow = {
  id: string;
  resourceType: string;
  resourceName: string;
  releasedAt: Date | null;
  customer: { name: string };
};

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const q = (queryValue(req, "q") ?? "").trim();
    if (q.length < 1) {
      return jsonOk({ q, groups: [] });
    }
    const take = 8;
    const ip = parseIp(q);
    // IP 搜索额外按覆盖范围匹配：命中包含该地址的 IP 段/区间与区间分配。
    const containingBlocksPromise: Promise<BlockRow[]> = ip
      ? prisma.ipBlock.findMany({
          select: {
            id: true,
            cidr: true,
            status: true,
            kind: true,
            rangeStart: true,
            rangeEnd: true,
          },
        })
      : Promise.resolve([]);
    const containingAllocationsPromise: Promise<AllocationRow[]> = ip
      ? prisma.resourceAllocation.findMany({
          where: {
            resourceType: "ipRange",
            items: { some: { address: ip.canonical } },
          },
          orderBy: [{ allocatedAt: "desc" }],
          select: {
            id: true,
            resourceType: true,
            resourceName: true,
            releasedAt: true,
            customer: { select: { name: true } },
          },
        })
      : Promise.resolve([]);
    const [
      suppliers,
      customers,
      blocks,
      ips,
      vlans,
      vxlans,
      broadbands,
      devices,
      lines,
      systems,
      racks,
      allocations,
      notifications,
      containingBlocks,
      containingAllocations,
    ] = await Promise.all([
      prisma.supplier.findMany({
        where: { name: { contains: q } },
        take,
        select: { id: true, name: true, level: true },
      }),
      prisma.customer.findMany({
        where: { name: { contains: q } },
        take,
        select: { id: true, name: true, level: true },
      }),
      prisma.ipBlock.findMany({
        where: { OR: [{ cidr: { contains: q } }, { description: { contains: q } }] },
        take,
        select: { id: true, cidr: true, status: true },
      }),
      prisma.ipAddress.findMany({
        where: { OR: [{ address: { contains: q } }, { dnsName: { contains: q } }] },
        take,
        select: { id: true, address: true, dnsName: true, status: true },
      }),
      prisma.vlan.findMany({
        where: { OR: [{ name: { contains: q } }, { description: { contains: q } }] },
        take,
        select: { id: true, vid: true, name: true, status: true },
      }),
      prisma.vxlan.findMany({
        where: { OR: [{ name: { contains: q } }, { description: { contains: q } }] },
        take,
        select: { id: true, vni: true, name: true, status: true },
      }),
      prisma.broadband.findMany({
        where: {
          OR: [
            { name: { contains: q } },
            { account: { contains: q } },
            { installAddress: { contains: q } },
            { contractNo: { contains: q } },
          ],
        },
        take,
        select: { id: true, name: true, status: true, bandwidthMbps: true },
      }),
      prisma.device.findMany({
        where: {
          OR: [
            { name: { contains: q } },
            { serialNo: { contains: q } },
            { model: { contains: q } },
            { assetTag: { contains: q } },
          ],
        },
        take,
        select: { id: true, name: true, serialNo: true, model: true, manufacturer: true },
      }),
      prisma.line.findMany({
        where: {
          OR: [
            { code: { contains: q } },
            { name: { contains: q } },
            { circuitNo: { contains: q } },
          ],
        },
        take,
        select: { id: true, code: true, name: true, status: true },
      }),
      prisma.businessSystem.findMany({
        where: {
          OR: [
            { name: { contains: q } },
            { code: { contains: q } },
            { domain: { contains: q } },
          ],
        },
        take,
        select: { id: true, name: true, code: true, owner: true },
      }),
      prisma.rack.findMany({
        where: { OR: [{ code: { contains: q } }, { location: { contains: q } }] },
        take,
        select: { id: true, code: true, location: true, uStart: true, uEnd: true },
      }),
      prisma.resourceAllocation.findMany({
        where: {
          OR: [
            { resourceName: { contains: q } },
            { supplierName: { contains: q } },
            { customer: { is: { name: { contains: q } } } },
          ],
        },
        orderBy: [{ allocatedAt: "desc" }],
        take,
        select: {
          id: true,
          resourceType: true,
          resourceName: true,
          releasedAt: true,
          customer: { select: { name: true } },
        },
      }),
      prisma.notification.findMany({
        where: {
          OR: [
            { title: { contains: q } },
            { recipient: { contains: q } },
            { subject: { contains: q } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take,
        select: { id: true, title: true, recipient: true, subject: true, status: true },
      }),
      containingBlocksPromise,
      containingAllocationsPromise,
    ]);

    // 覆盖匹配结果优先展示；同一记录被文本匹配和覆盖匹配同时命中时只保留一条。
    const blockById = new Map<string, { id: string; cidr: string; status: string }>();
    if (ip) {
      containingBlocks
        .map((row) => ({ row, spec: parseStoredBlock(row) }))
        .filter(
          (entry) =>
            entry.spec !== null &&
            entry.spec.version === ip.version &&
            ipInBlock(ip.canonical, entry.spec),
        )
        .sort((a, b) => {
          const sa = a.spec!;
          const sb = b.spec!;
          if (sa.version === 4 && sb.version === 4) {
            return (sa.size ?? 0) - (sb.size ?? 0);
          }
          return (sb.prefix ?? 0) - (sa.prefix ?? 0);
        })
        .slice(0, take)
        .forEach(({ row }) => blockById.set(row.id, row));
    }
    for (const row of blocks) {
      if (!blockById.has(row.id)) blockById.set(row.id, row);
    }
    const mergedBlocks = Array.from(blockById.values()).slice(0, take);

    const allocationById = new Map<
      string,
      AllocationRow & { matchedIp?: boolean }
    >();
    if (ip) {
      for (const row of containingAllocations) {
        allocationById.set(row.id, { ...row, matchedIp: true });
      }
    }
    for (const row of allocations) {
      if (!allocationById.has(row.id)) allocationById.set(row.id, row);
    }
    const mergedAllocations = Array.from(allocationById.values())
      .sort((a, b) => Number(Boolean(a.releasedAt)) - Number(Boolean(b.releasedAt)))
      .slice(0, take);

    const groups: Array<{ key: string; label: string; items: Item[] }> = [
      {
        key: "customers",
        label: "客户",
        items: customers.map((c) => ({
          id: c.id,
          title: c.name,
          subtitle: labelOf(PARTY_LEVELS, c.level),
          href: `/customers?keyword=${encodeURIComponent(c.name)}`,
        })),
      },
      {
        key: "suppliers",
        label: "供应商",
        items: suppliers.map((s) => ({
          id: s.id,
          title: s.name,
          subtitle: labelOf(PARTY_LEVELS, s.level),
          href: `/suppliers?keyword=${encodeURIComponent(s.name)}`,
        })),
      },
      {
        key: "racks",
        label: "机柜",
        items: racks.map((r) => ({
          id: r.id,
          title: r.code,
          subtitle: [r.location, `[${r.uStart}-${r.uEnd}]U`].filter(Boolean).join(" / "),
          href: `/racks?keyword=${encodeURIComponent(r.code)}`,
        })),
      },
      {
        key: "ipBlocks",
        label: "IP 段",
        items: mergedBlocks.map((b) => ({
          id: b.id,
          title: b.cidr,
          subtitle: "IP 段",
          href: `/ip/blocks?keyword=${encodeURIComponent(b.cidr)}`,
        })),
      },
      {
        key: "ipAddresses",
        label: "IP 地址",
        items: ips.map((ip) => ({
          id: ip.id,
          title: ip.address,
          subtitle: ip.dnsName ?? "IP 地址",
          href: `/ip/addresses?keyword=${encodeURIComponent(ip.address)}`,
        })),
      },
      {
        key: "vlans",
        label: "VLAN",
        items: vlans.map((v) => ({
          id: v.id,
          title: `VLAN ${v.vid} ${v.name}`,
          subtitle: "VLAN",
          href: `/vlans?keyword=${encodeURIComponent(v.name)}`,
        })),
      },
      {
        key: "vxlans",
        label: "VXLAN",
        items: vxlans.map((v) => ({
          id: v.id,
          title: `VXLAN ${v.vni}${v.name ? ` ${v.name}` : ""}`,
          subtitle: "VXLAN",
          href: `/vxlans?keyword=${encodeURIComponent(v.name ?? String(v.vni))}`,
        })),
      },
      {
        key: "broadbands",
        label: "宽带",
        items: broadbands.map((b) => ({
          id: b.id,
          title: b.name,
          subtitle: [b.bandwidthMbps ? `${b.bandwidthMbps} Mbps` : null, labelOf(BROADBAND_STATUS, b.status)]
            .filter(Boolean)
            .join(" / "),
          href: `/broadbands?keyword=${encodeURIComponent(b.name)}`,
        })),
      },
      {
        key: "devices",
        label: "设备",
        items: devices.map((d) => ({
          id: d.id,
          title: d.name,
          subtitle: [d.manufacturer, d.model, d.serialNo].filter(Boolean).join(" / ") || "设备",
          href: `/devices?keyword=${encodeURIComponent(d.name)}`,
        })),
      },
      {
        key: "lines",
        label: "线路",
        items: lines.map((l) => ({
          id: l.id,
          title: `${l.code} ${l.name}`,
          subtitle: labelOf(LINE_STATUS, l.status),
          href: `/lines?keyword=${encodeURIComponent(l.code)}`,
        })),
      },
      {
        key: "allocations",
        label: "资源分配",
        items: mergedAllocations.map((a) => ({
          id: a.id,
          title: a.resourceName,
          subtitle: `${a.customer.name} / ${labelOf(ALLOCATION_RESOURCE_TYPES, a.resourceType)}${
            a.matchedIp && ip ? ` / 包含 ${ip.canonical}` : ""
          }${a.releasedAt ? "（已释放）" : ""}`,
          href: `/resource-allocations?keyword=${encodeURIComponent(q)}`,
        })),
      },
      {
        key: "systems",
        label: "业务系统",
        items: systems.map((s) => ({
          id: s.id,
          title: s.name,
          subtitle: [s.code, s.owner].filter(Boolean).join(" / "),
          href: `/business-systems?keyword=${encodeURIComponent(s.name)}`,
        })),
      },
      {
        key: "notifications",
        label: "通知",
        items: notifications.map((n) => ({
          id: n.id,
          title: n.title || "未命名通知",
          subtitle: [n.subject, n.recipient, labelOf(NOTIFICATION_STATUS, n.status)]
            .filter(Boolean)
            .join(" / "),
          href: `/notifications/${n.id}`,
        })),
      },
    ].filter((g) => g.items.length > 0);

    return jsonOk({ q, groups });
  } catch (error) {
    return handleApiError(error);
  }
}
