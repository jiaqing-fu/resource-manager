import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireAdmin, requireUser } from "@/lib/api";
import { writeChangeLog } from "@/lib/changelog";
import { vxlanUpdateSchema } from "@/lib/vxlan-schema";
import {
  assertVniAvailable,
  resolveSupplierForVxlanUpdate,
  resolveVxlanVlan,
} from "@/server/services/vxlan";
import { assertResourceNotAllocated } from "@/server/services/allocations";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const vxlan = await prisma.vxlan.findUnique({
      where: { id },
      include: {
        vlan: { select: { id: true, vid: true, name: true } },
        supplier: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
      },
    });
    if (!vxlan) throw new ApiError(404, "VXLAN 不存在", "NOT_FOUND");
    return jsonOk(vxlan);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = vxlanUpdateSchema.parse(await readJson(req));
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.vxlan.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "VXLAN 不存在", "NOT_FOUND");

      const nextVlanId = body.vlanId !== undefined ? body.vlanId : existing.vlanId;
      const vlan = await resolveVxlanVlan(tx, nextVlanId, id);
      const supplierId = await resolveSupplierForVxlanUpdate(
        tx,
        existing.supplierId,
        body.supplierId,
        vlan,
      );
      const vni = body.vni ?? existing.vni;
      if (vni !== existing.vni) await assertVniAvailable(tx, vni, id);

      const data: Record<string, unknown> = {
        vni,
        vlanId: vlan?.id ?? null,
        supplierId,
      };
      for (const key of ["name", "status", "description"] as const) {
        if (body[key] !== undefined) data[key] = body[key];
      }
      const vxlan = await tx.vxlan.update({
        where: { id },
        data,
        include: {
          vlan: { select: { id: true, vid: true, name: true } },
          supplier: { select: { id: true, name: true } },
        },
      });
      await writeChangeLog(tx, {
        user,
        resource: "vxlan",
        recordId: id,
        action: "UPDATE",
        summary: `修改 VXLAN ${vxlan.vni}${vxlan.name ? ` ${vxlan.name}` : ""}`,
        before: existing,
        after: vxlan,
      });
      return vxlan;
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
      const existing = await tx.vxlan.findUnique({
        where: { id },
        select: { id: true, vni: true, name: true },
      });
      if (!existing) throw new ApiError(404, "VXLAN 不存在", "NOT_FOUND");
      await assertResourceNotAllocated(tx, "vxlan", id, `VXLAN ${existing.vni}`);
      await tx.vxlan.delete({ where: { id } });
      await writeChangeLog(tx, {
        user,
        resource: "vxlan",
        recordId: id,
        action: "DELETE",
        summary: `删除 VXLAN ${existing.vni}${existing.name ? ` ${existing.name}` : ""}`,
        before: existing,
      });
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
