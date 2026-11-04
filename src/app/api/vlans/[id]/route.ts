import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireAdmin, requireUser } from "@/lib/api";
import { writeChangeLog } from "@/lib/changelog";
import { vlanUpdateSchema } from "@/lib/vlan-schema";
import { resolveSupplierForUpdate } from "@/server/services/supplier-requirements";
import { assertResourceNotAllocated } from "@/server/services/allocations";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const vlan = await prisma.vlan.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        vxlan: { select: { id: true, vni: true, name: true, status: true } },
        ipBlocks: { select: { id: true, cidr: true, status: true } },
      },
    });
    if (!vlan) throw new ApiError(404, "VLAN 不存在", "NOT_FOUND");
    return jsonOk(vlan);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = vlanUpdateSchema.parse(await readJson(req));
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.vlan.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "VLAN 不存在", "NOT_FOUND");
      const supplierId = await resolveSupplierForUpdate(
        tx,
        existing.supplierId,
        body.supplierId,
      );
      const vid = body.vid ?? existing.vid;
      if (vid !== existing.vid || supplierId !== existing.supplierId) {
        if (!supplierId) {
          throw new ApiError(422, "请先为 VLAN 补全供应商", "SUPPLIER_REQUIRED");
        }
        const dup = await tx.vlan.findFirst({
          where: { vid, supplierId, id: { not: id } },
        });
        if (dup) {
          throw new ApiError(409, `该供应商下 VLAN ID ${vid} 已存在`, "DUPLICATE_VID");
        }
      }
      const data: Record<string, unknown> = { vid, supplierId };
      for (const key of ["name", "status", "description"] as const) {
        if (body[key] !== undefined) data[key] = body[key];
      }
      const vlan = await tx.vlan.update({
        where: { id },
        data,
        include: { supplier: { select: { id: true, name: true } } },
      });
      await writeChangeLog(tx, {
        user,
        resource: "vlan",
        recordId: id,
        action: "UPDATE",
        summary: `修改 VLAN ${vlan.vid} ${vlan.name}`,
        before: existing,
        after: vlan,
      });
      return vlan;
    });
    return jsonOk(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAdmin(req);
    const { id } = await params;
    await prisma.$transaction(async (tx) => {
      const existing = await tx.vlan.findUnique({
        where: { id },
        select: { id: true, vid: true, name: true, _count: { select: { ipBlocks: true } } },
      });
      if (!existing) throw new ApiError(404, "VLAN 不存在", "NOT_FOUND");
      if (existing._count.ipBlocks > 0) {
        throw new ApiError(
          409,
          `VLAN ${existing.vid} 仍关联 ${existing._count.ipBlocks} 个 IP 段，请先解除关联`,
          "IN_USE",
        );
      }
      await assertResourceNotAllocated(tx, "vlan", id, `VLAN ${existing.vid}`);
      await tx.vlan.delete({ where: { id } });
      await writeChangeLog(tx, {
        user,
        resource: "vlan",
        recordId: id,
        action: "DELETE",
        summary: `删除 VLAN ${existing.vid} ${existing.name}`,
        before: existing,
      });
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
