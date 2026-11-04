import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handleApiError, jsonOk, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

/** 表单下拉所需的全部引用数据，一次返回并由前端 SWR 缓存。 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const [
      suppliers,
      customers,
      salespeople,
      racks,
      vlans,
      vxlans,
      ipBlocks,
      ipAddresses,
      devices,
      lines,
      broadbands,
      systems,
    ] = await Promise.all([
      prisma.supplier.findMany({
        orderBy: [{ level: "asc" }, { name: "asc" }],
        select: { id: true, name: true, level: true, parentId: true, status: true },
      }),
      prisma.customer.findMany({
        orderBy: [{ level: "asc" }, { name: "asc" }],
        select: { id: true, name: true, level: true, parentId: true, status: true },
      }),
      prisma.salesperson.findMany({
        orderBy: [{ status: "asc" }, { name: "asc" }],
        select: { id: true, name: true, status: true },
      }),
      prisma.rack.findMany({
        orderBy: [{ code: "asc" }, { uStart: "asc" }],
        select: {
          id: true,
          code: true,
          location: true,
          supplierId: true,
          customerId: true,
          uStart: true,
          uEnd: true,
          status: true,
        },
      }),
      prisma.vlan.findMany({
        orderBy: { vid: "asc" },
        select: {
          id: true,
          vid: true,
          name: true,
          supplierId: true,
          customerId: true,
          status: true,
        },
      }),
      prisma.vxlan.findMany({
        orderBy: { vni: "asc" },
        select: {
          id: true,
          vni: true,
          name: true,
          status: true,
          vlanId: true,
          supplierId: true,
          customerId: true,
        },
      }),
      prisma.ipBlock.findMany({
        orderBy: { cidr: "asc" },
        select: {
          id: true,
          cidr: true,
          status: true,
          supplierId: true,
          customerId: true,
          vlanId: true,
        },
      }),
      prisma.ipAddress.findMany({
        orderBy: { address: "asc" },
        select: {
          id: true,
          address: true,
          status: true,
          blockId: true,
          deviceId: true,
          lineId: true,
          customerId: true,
        },
      }),
      prisma.device.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          serialNo: true,
          rackId: true,
          supplierId: true,
          customerId: true,
          status: true,
          osVersion: true,
        },
      }),
      prisma.line.findMany({
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, supplierId: true, customerId: true },
      }),
      prisma.broadband.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, supplierId: true, customerId: true, status: true },
      }),
      prisma.businessSystem.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, code: true },
      }),
    ]);
    return jsonOk({
      suppliers,
      customers,
      salespeople,
      racks,
      vlans,
      vxlans,
      ipBlocks,
      ipAddresses,
      devices,
      lines,
      broadbands,
      systems,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
