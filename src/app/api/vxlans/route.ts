import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  getPaging,
  handleApiError,
  jsonOk,
  listResult,
  queryValue,
  readJson,
  requireUser,
} from "@/lib/api";
import { VXLAN_STATUS } from "@/lib/enums";
import { writeChangeLog } from "@/lib/changelog";
import { vxlanSchema } from "@/lib/vxlan-schema";
import { assignResourceCustomer } from "@/server/services/allocations";
import {
  assertVniAvailable,
  resolveSupplierForVxlanCreate,
  resolveVxlanVlan,
} from "@/server/services/vxlan";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const status = queryValue(req, "status");
    const supplierId = queryValue(req, "supplierId");
    const customerId = queryValue(req, "customerId");
    const vlanId = queryValue(req, "vlanId");
    const where: Prisma.VxlanWhereInput = {};
    if (paging.keyword) {
      const kw = paging.keyword;
      const or: Prisma.VxlanWhereInput[] = [
        { name: { contains: kw } },
        { description: { contains: kw } },
        { vlan: { is: { name: { contains: kw } } } },
        { supplier: { is: { name: { contains: kw } } } },
        { customer: { is: { name: { contains: kw } } } },
      ];
      if (/^\d+$/.test(kw)) {
        or.push({ vni: Number(kw) });
        or.push({ vlan: { is: { vid: Number(kw) } } });
      }
      where.OR = or;
    }
    if (status && VXLAN_STATUS.some((o) => o.value === status)) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (customerId) where.customerId = customerId;
    if (vlanId) where.vlanId = vlanId;

    const [items, total] = await Promise.all([
      prisma.vxlan.findMany({
        where,
        orderBy: { vni: "asc" },
        skip: paging.skip,
        take: paging.pageSize,
        include: {
          vlan: { select: { id: true, vid: true, name: true } },
          supplier: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          _count: { select: { allocations: true } },
        },
      }),
      prisma.vxlan.count({ where }),
    ]);
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = vxlanSchema.parse(await readJson(req));
    const created = await prisma.$transaction(async (tx) => {
      const vlan = await resolveVxlanVlan(tx, body.vlanId);
      const supplierId = await resolveSupplierForVxlanCreate(tx, body.supplierId, vlan);
      await assertVniAvailable(tx, body.vni);
      let vxlan = await tx.vxlan.create({
        data: {
          vni: body.vni,
          name: body.name ?? null,
          status: body.status,
          description: body.description ?? null,
          vlanId: vlan?.id ?? null,
          supplierId,
          customerId: null,
        },
        include: {
          vlan: { select: { id: true, vid: true, name: true } },
          supplier: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
        },
      });
      if (body.customerId) {
        await assignResourceCustomer(tx, {
          resourceType: "vxlan",
          resourceId: vxlan.id,
          customerId: body.customerId,
          notes: "创建资源时绑定",
        });
        vxlan = await tx.vxlan.findUniqueOrThrow({
          where: { id: vxlan.id },
          include: {
            vlan: { select: { id: true, vid: true, name: true } },
            supplier: { select: { id: true, name: true } },
            customer: { select: { id: true, name: true } },
          },
        });
      }
      await writeChangeLog(tx, {
        user,
        resource: "vxlan",
        recordId: vxlan.id,
        action: "CREATE",
        summary: `创建 VXLAN ${vxlan.vni}${vxlan.name ? ` ${vxlan.name}` : ""}`,
        after: vxlan,
      });
      return vxlan;
    });
    return jsonOk(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
