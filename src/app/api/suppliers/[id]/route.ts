import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireAdmin, requireUser } from "@/lib/api";
import { PARTY_STATUS, SUPPLIER_CATEGORIES } from "@/lib/enums";
import {
  assertNameUnique,
  contactSchema,
  replaceContacts,
} from "@/server/services/party-write";
import { assertPartyDeletable, validatePartyHierarchy } from "@/server/services/party";
import { writeChangeLog } from "@/lib/changelog";
import { nullableId, optionalInt, optionalText, requiredText, zEnum } from "@/lib/validators";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: requiredText("名称", 100).optional(),
  level: z.coerce.number().int().min(1).max(2).optional(),
  parentId: nullableId,
  status: zEnum(PARTY_STATUS, "状态").optional(),
  category: zEnum(SUPPLIER_CATEGORIES, "供应商分类").optional(),
  asn: optionalInt,
  contactName: optionalText(50),
  phone: optionalText(50),
  email: optionalText(100),
  address: optionalText(200),
  notes: optionalText(1000),
  contacts: z.array(contactSchema).max(50).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true, level: true } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        _count: {
          select: {
            ipBlocks: true,
            ipAddresses: true,
            racks: true,
            vlans: true,
            vxlans: true,
            broadbands: true,
            devices: true,
            lines: true,
          },
        },
      },
    });
    if (!supplier) throw new ApiError(404, "供应商不存在", "NOT_FOUND");
    return jsonOk(supplier);
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
      const existing = await tx.supplier.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "供应商不存在", "NOT_FOUND");

      const level = body.level ?? existing.level;
      const parentId = body.parentId !== undefined ? body.parentId : existing.parentId;
      const hierarchy = await validatePartyHierarchy(tx, "supplier", { id, level, parentId });
      const name = body.name ?? existing.name;
      await assertNameUnique(tx, "supplier", name, hierarchy.level, hierarchy.parentId, id);

      const data: Record<string, unknown> = {
        name,
        level: hierarchy.level,
        parentId: hierarchy.parentId,
      };
      for (const key of [
        "status",
        "category",
        "asn",
        "contactName",
        "phone",
        "email",
        "address",
        "notes",
      ] as const) {
        if (body[key] !== undefined) data[key] = body[key];
      }

      if (body.contacts !== undefined) {
        await replaceContacts(tx, id, body.contacts);
      }

      const supplier = await tx.supplier.update({
        where: { id },
        data,
        include: {
          parent: { select: { id: true, name: true } },
          contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        },
      });
      await writeChangeLog(tx, {
        user,
        resource: "supplier",
        recordId: id,
        action: "UPDATE",
        summary: `修改供应商 ${supplier.name}`,
        before: existing,
        after: supplier,
      });
      return supplier;
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
      const existing = await tx.supplier.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "供应商不存在", "NOT_FOUND");
      await assertPartyDeletable(tx, "supplier", id);
      await tx.supplier.delete({ where: { id } });
      await writeChangeLog(tx, {
        user,
        resource: "supplier",
        recordId: id,
        action: "DELETE",
        summary: `删除供应商 ${existing.name}`,
        before: existing,
      });
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
