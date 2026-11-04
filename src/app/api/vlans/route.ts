import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ApiError,
  getPaging,
  handleApiError,
  jsonOk,
  listResult,
  queryValue,
  readJson,
  requireUser,
} from "@/lib/api";
import { VLAN_STATUS } from "@/lib/enums";
import { writeChangeLog } from "@/lib/changelog";
import { vlanSchema } from "@/lib/vlan-schema";
import { resolveSupplierForCreate } from "@/server/services/supplier-requirements";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const status = queryValue(req, "status");
    const supplierId = queryValue(req, "supplierId");
    const customerId = queryValue(req, "customerId");
    const where: Prisma.VlanWhereInput = {};
    if (paging.keyword) {
      const kw = paging.keyword;
      const or: Prisma.VlanWhereInput[] = [
        { name: { contains: kw } },
        { description: { contains: kw } },
        { supplier: { is: { name: { contains: kw } } } },
        { customer: { is: { name: { contains: kw } } } },
      ];
      if (/^\d+$/.test(kw)) or.push({ vid: Number(kw) });
      where.OR = or;
    }
    if (status && VLAN_STATUS.some((o) => o.value === status)) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (customerId) where.customerId = customerId;

    const [items, total] = await Promise.all([
      prisma.vlan.findMany({
        where,
        orderBy: { vid: "asc" },
        skip: paging.skip,
        take: paging.pageSize,
        include: {
          supplier: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          vxlan: { select: { id: true, vni: true, name: true, status: true } },
          _count: { select: { ipBlocks: true } },
        },
      }),
      prisma.vlan.count({ where }),
    ]);
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = vlanSchema.parse(await readJson(req));
    const created = await prisma.$transaction(async (tx) => {
      const supplierId = await resolveSupplierForCreate(tx, body.supplierId);
      const dup = await tx.vlan.findFirst({ where: { supplierId, vid: body.vid } });
      if (dup) {
        throw new ApiError(
          409,
          `该供应商下 VLAN ID ${body.vid} 已存在`,
          "DUPLICATE_VID",
        );
      }
      const vlan = await tx.vlan.create({
        data: {
          vid: body.vid,
          name: body.name,
          status: body.status,
          description: body.description ?? null,
          supplierId,
          customerId: null,
        },
        include: { supplier: { select: { id: true, name: true } } },
      });
      await writeChangeLog(tx, {
        user,
        resource: "vlan",
        recordId: vlan.id,
        action: "CREATE",
        summary: `创建 VLAN ${vlan.vid} ${vlan.name}`,
        after: vlan,
      });
      return vlan;
    });
    return jsonOk(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
