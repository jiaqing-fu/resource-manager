import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handleApiError, jsonOk, requireUser } from "@/lib/api";
import {
  IP_ADDRESS_ROLES,
  IP_ADDRESS_STATUS,
  DEVICE_STATUS,
  DEVICE_TYPES,
  LINE_STATUS,
  labelOf,
} from "@/lib/enums";
import { addDays, todayStr } from "@/lib/dates";
import { rackCapacity } from "@/lib/rack";
import { buildBlockTree } from "@/server/services/ipam";
import { computeRackUsage } from "@/server/services/inventory";

export const dynamic = "force-dynamic";

function withLabels(
  rows: Array<{ value: string | null; count: number }>,
  options: { value: string; label: string }[],
) {
  return rows.map((r) => ({
    value: r.value ?? "unknown",
    label: r.value ? labelOf(options, r.value) : "未设置",
    count: r.count,
  }));
}

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const today = todayStr();
    const in30 = addDays(today, 30);

    const [
      supplierL1,
      supplierL2,
      customerL1,
      customerL2,
      rackCount,
      ipBlockCount,
      ipAddressCount,
      vlanCount,
      vxlanCount,
      broadbandCount,
      deviceCount,
      lineCount,
      systemCount,
      testCount,
      activeAllocationCount,
      ipStatusRaw,
      ipRoleRaw,
      deviceStatusRaw,
      deviceTypeRaw,
      lineStatusRaw,
      testExpired,
      lineExpiring,
      broadbandExpiring,
      warrantyExpiring,
      racks,
      blockTree,
    ] = await Promise.all([
      prisma.supplier.count({ where: { level: 1 } }),
      prisma.supplier.count({ where: { level: 2 } }),
      prisma.customer.count({ where: { level: 1 } }),
      prisma.customer.count({ where: { level: 2 } }),
      prisma.rack.groupBy({ by: ["code"] }),
      prisma.ipBlock.count(),
      prisma.ipAddress.count(),
      prisma.vlan.count(),
      prisma.vxlan.count(),
      prisma.broadband.count(),
      prisma.device.count(),
      prisma.line.count(),
      prisma.businessSystem.count(),
      prisma.customerTest.count(),
      prisma.resourceAllocation.count({ where: { releasedAt: null } }),
      prisma.ipAddress.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.ipAddress.groupBy({ by: ["role"], _count: { _all: true } }),
      prisma.device.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.device.groupBy({ by: ["type"], _count: { _all: true } }),
      prisma.line.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.customerTest.count({
        where: { status: null, converted: false, endAt: { lt: today } },
      }),
      prisma.line.count({
        where: {
          expireDate: { not: null, gte: today, lte: in30 },
          status: { not: "deprovisioned" },
        },
      }),
      prisma.broadband.count({
        where: {
          expireDate: { not: null, gte: today, lte: in30 },
          status: { not: "terminated" },
        },
      }),
      prisma.device.count({
        where: { warrantyEnd: { not: null, gte: today, lte: in30 } },
      }),
      prisma.rack.findMany({
        select: {
          id: true,
          code: true,
          location: true,
          uStart: true,
          uEnd: true,
          devices: { select: { uStart: true, uHeight: true, face: true } },
        },
      }),
      buildBlockTree(prisma),
    ]);

    const rackUsage = racks
      .map((r) => {
        const usage = computeRackUsage(r.devices);
        const capacity = rackCapacity(r.uStart, r.uEnd);
        return {
          id: r.id,
          code: r.code,
          location: r.location,
          uStart: r.uStart,
          uEnd: r.uEnd,
          usedU: usage.occupiedU,
          capacity,
          percent: capacity > 0 ? Math.round((usage.occupiedU / capacity) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 5);

    const flatBlocks: Array<{
      id: string;
      cidr: string;
      kind: string;
      percent: number | null;
      used: number;
      entered: number;
      allocated: number;
      total: number | null;
    }> = [];
    const walk = (nodes: typeof blockTree) => {
      for (const n of nodes) {
        flatBlocks.push({
          id: n.id,
          cidr: n.cidr,
          kind: n.kind,
          percent: n.percent,
          used: n.used,
          entered: n.entered,
          allocated: n.allocated,
          total: n.total,
        });
        walk(n.children);
      }
    };
    walk(blockTree);
    const blockUsage = flatBlocks
      .filter((b) => b.percent !== null && b.percent > 0)
      .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))
      .slice(0, 5);

    return jsonOk({
      counts: {
        suppliers: supplierL1 + supplierL2,
        suppliersL1: supplierL1,
        suppliersL2: supplierL2,
        customers: customerL1 + customerL2,
        customersL1: customerL1,
        customersL2: customerL2,
        racks: rackCount.length,
        ipBlocks: ipBlockCount,
        ipAddresses: ipAddressCount,
        vlans: vlanCount,
        vxlans: vxlanCount,
        broadbands: broadbandCount,
        devices: deviceCount,
        lines: lineCount,
        businessSystems: systemCount,
        customerTests: testCount,
        activeAllocations: activeAllocationCount,
      },
      ipStatus: withLabels(
        ipStatusRaw.map((r) => ({ value: r.status, count: r._count._all })),
        IP_ADDRESS_STATUS,
      ),
      ipRole: withLabels(
        ipRoleRaw.map((r) => ({ value: r.role, count: r._count._all })),
        IP_ADDRESS_ROLES,
      ),
      deviceStatus: withLabels(
        deviceStatusRaw.map((r) => ({ value: r.status, count: r._count._all })),
        DEVICE_STATUS,
      ),
      deviceType: withLabels(
        deviceTypeRaw.map((r) => ({ value: r.type, count: r._count._all })),
        DEVICE_TYPES,
      ),
      lineStatus: withLabels(
        lineStatusRaw.map((r) => ({ value: r.status, count: r._count._all })),
        LINE_STATUS,
      ),
      blockUsage,
      rackUsage,
      reminders: {
        linesExpiring: lineExpiring,
        warrantiesExpiring: warrantyExpiring,
        testsExpired: testExpired,
        broadbandsExpiring: broadbandExpiring,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
