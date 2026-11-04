import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireAdmin, requireUser } from "@/lib/api";
import { PARTY_STATUS } from "@/lib/enums";
import { assertNameUnique } from "@/server/services/party-write";
import { assertPartyDeletable, validatePartyHierarchy } from "@/server/services/party";
import { assertSalespersonExists } from "@/server/services/salesperson";
import { writeChangeLog } from "@/lib/changelog";
import { nullableId, optionalText, requiredText, zEnum } from "@/lib/validators";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: requiredText("名称", 100).optional(),
  level: z.coerce.number().int().min(1).max(2).optional(),
  parentId: nullableId,
  status: zEnum(PARTY_STATUS, "状态").optional(),
  salespersonId: nullableId,
  contactName: optionalText(50),
  phone: optionalText(50),
  email: optionalText(100),
  address: optionalText(200),
  notes: optionalText(1000),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true, status: true } },
        children: { select: { id: true, name: true, level: true } },
        _count: {
          select: {
            ipBlocks: true,
            ipAddresses: true,
            vlans: true,
            vxlans: true,
            devices: true,
            lines: true,
            customerTests: true,
            allocations: true,
          },
        },
      },
    });
    if (!customer) throw new ApiError(404, "客户不存在", "NOT_FOUND");
    const [rackAllocations, broadbandAllocations] = await Promise.all([
      prisma.resourceAllocation.findMany({
        where: { customerId: id, releasedAt: null, resourceType: "rack", rackId: { not: null } },
        select: { rackId: true },
        distinct: ["rackId"],
      }),
      prisma.resourceAllocation.findMany({
        where: {
          customerId: id,
          releasedAt: null,
          resourceType: "broadband",
          broadbandId: { not: null },
        },
        select: { broadbandId: true },
        distinct: ["broadbandId"],
      }),
    ]);
    return jsonOk({
      ...customer,
      _count: {
        ...customer._count,
        racks: rackAllocations.length,
        broadbands: broadbandAllocations.length,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = updateSchema.parse(await readJson(req));
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.customer.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "客户不存在", "NOT_FOUND");
      const level = body.level ?? existing.level;
      const parentId = body.parentId !== undefined ? body.parentId : existing.parentId;
      const hierarchy = await validatePartyHierarchy(tx, "customer", { id, level, parentId });
      const name = body.name ?? existing.name;
      await assertNameUnique(tx, "customer", name, hierarchy.level, hierarchy.parentId, id);
      if (body.salespersonId) {
        await assertSalespersonExists(tx, body.salespersonId);
      }

      const data: Record<string, unknown> = {
        name,
        level: hierarchy.level,
        parentId: hierarchy.parentId,
      };
      for (const key of [
        "status",
        "salespersonId",
        "contactName",
        "phone",
        "email",
        "address",
        "notes",
      ] as const) {
        if (body[key] !== undefined) data[key] = body[key];
      }
      const customer = await tx.customer.update({
        where: { id },
        data,
        include: {
          parent: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true, status: true } },
        },
      });
      await writeChangeLog(tx, {
        user,
        resource: "customer",
        recordId: id,
        action: "UPDATE",
        summary: `修改客户 ${customer.name}`,
        before: existing,
        after: customer,
      });
      return customer;
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
      const existing = await tx.customer.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "客户不存在", "NOT_FOUND");
      await assertPartyDeletable(tx, "customer", id);
      await tx.customer.delete({ where: { id } });
      await writeChangeLog(tx, {
        user,
        resource: "customer",
        recordId: id,
        action: "DELETE",
        summary: `删除客户 ${existing.name}`,
        before: existing,
      });
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
