import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireAdmin, requireUser } from "@/lib/api";
import { ipBlockUpdateSchema } from "@/lib/ip-block-schema";
import {
  assertBlockDeletable,
  recomputeBlockParents,
  validateBlockInput,
} from "@/server/services/ipam";
import {
  assertSupplierConsistent,
  resolveSupplierForUpdate,
} from "@/server/services/supplier-requirements";
import { assertResourceNotAllocated } from "@/server/services/allocations";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const block = await prisma.ipBlock.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, cidr: true } },
        children: {
          select: {
            id: true,
            cidr: true,
            status: true,
            role: true,
            _count: { select: { ipAddresses: true, children: true } },
          },
        },
        vlan: { select: { id: true, vid: true, name: true } },
        supplier: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        _count: { select: { ipAddresses: true, children: true } },
      },
    });
    if (!block) throw new ApiError(404, "IP 段不存在", "NOT_FOUND");
    return jsonOk(block);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = ipBlockUpdateSchema.parse(await readJson(req));
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.ipBlock.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "IP 段不存在", "NOT_FOUND");

      const pick = <T,>(key: keyof typeof body, fallback: T): T =>
        body[key] !== undefined ? (body[key] as T) : fallback;

      const merged = {
        cidr: pick("cidr", existing.cidr),
        status: pick("status", existing.status),
        role: pick("role", existing.role),
        gateway: pick("gateway", existing.gateway),
        vlanId: pick("vlanId", existing.vlanId),
        supplierId: pick("supplierId", existing.supplierId),
        description: pick("description", existing.description),
        assignedAt: pick("assignedAt", existing.assignedAt),
        parentId: pick("parentId", existing.parentId),
      };
      const normalized = await validateBlockInput(tx, merged, id);
      const dup = await tx.ipBlock.findUnique({ where: { cidr: normalized.cidr } });
      if (dup && dup.id !== id) {
        throw new ApiError(409, `IP 段 ${normalized.cidr} 已存在`, "DUPLICATE_CIDR");
      }
      const vlan = merged.vlanId
        ? await tx.vlan.findUnique({
            where: { id: merged.vlanId },
            select: { id: true, supplierId: true },
          })
        : null;
      if (merged.vlanId && !vlan) {
        throw new ApiError(422, "所选 VLAN 不存在", "VLAN_NOT_FOUND");
      }
      const supplierId = await resolveSupplierForUpdate(
        tx,
        existing.supplierId,
        body.supplierId,
      );
      assertSupplierConsistent(supplierId, vlan?.supplierId ?? null, " VLAN ");

      const block = await tx.ipBlock.update({
        where: { id },
        data: {
          cidr: normalized.cidr,
          ipVersion: normalized.ipVersion,
          status: merged.status,
          role: merged.role,
          gateway: merged.gateway ?? null,
          vlanId: merged.vlanId ?? null,
          supplierId,
          description: merged.description ?? null,
          assignedAt: merged.assignedAt ?? null,
        },
      });
      await recomputeBlockParents(tx);
      await writeChangeLog(tx, {
        user,
        resource: "ipBlock",
        recordId: id,
        action: "UPDATE",
        summary: `修改 IP 段 ${block.cidr}`,
        before: existing,
        after: block,
      });
      return tx.ipBlock.findUniqueOrThrow({
        where: { id },
        include: {
          parent: { select: { id: true, cidr: true } },
          supplier: { select: { id: true, name: true } },
        },
      });
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
      const existing = await tx.ipBlock.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "IP 段不存在", "NOT_FOUND");
      await assertBlockDeletable(tx, id);
      await assertResourceNotAllocated(tx, "ipBlock", id, `IP 段 ${existing.cidr}`);
      await tx.ipBlock.delete({ where: { id } });
      await recomputeBlockParents(tx);
      await writeChangeLog(tx, {
        user,
        resource: "ipBlock",
        recordId: id,
        action: "DELETE",
        summary: `删除 IP 段 ${existing.cidr}`,
        before: existing,
      });
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
