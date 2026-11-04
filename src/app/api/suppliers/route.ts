import { NextRequest } from "next/server";
import { z } from "zod";
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
import { SUPPLIER_CATEGORIES, PARTY_STATUS } from "@/lib/enums";
import { assertNameUnique, contactSchema, partyBaseSchema } from "@/server/services/party-write";
import { validatePartyHierarchy } from "@/server/services/party";
import { writeChangeLog } from "@/lib/changelog";
import { optionalInt, zEnum } from "@/lib/validators";

export const dynamic = "force-dynamic";

const createSchema = partyBaseSchema.extend({
  category: zEnum(SUPPLIER_CATEGORIES, "供应商分类").default("other"),
  asn: optionalInt,
  contacts: z.array(contactSchema).max(50).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const level = queryValue(req, "level");
    const parentId = queryValue(req, "parentId");
    const status = queryValue(req, "status");
    const category = queryValue(req, "category");
    const where: Record<string, unknown> = {};
    if (paging.keyword) {
      where.OR = [
        { name: { contains: paging.keyword } },
        { contactName: { contains: paging.keyword } },
        { phone: { contains: paging.keyword } },
        { email: { contains: paging.keyword } },
        { address: { contains: paging.keyword } },
        { notes: { contains: paging.keyword } },
        { parent: { is: { name: { contains: paging.keyword } } } },
      ];
    }
    if (level === "1" || level === "2") where.level = Number(level);
    if (parentId) where.parentId = parentId;
    if (status && PARTY_STATUS.some((o) => o.value === status)) where.status = status;
    if (category && SUPPLIER_CATEGORIES.some((o) => o.value === category)) where.category = category;

    const [items, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        orderBy: [{ level: "asc" }, { name: "asc" }],
        skip: paging.skip,
        take: paging.pageSize,
        include: {
          parent: { select: { id: true, name: true } },
          _count: {
            select: {
              children: true,
              contacts: true,
              racks: true,
              ipBlocks: true,
              ipAddresses: true,
              vlans: true,
              vxlans: true,
              broadbands: true,
              devices: true,
              lines: true,
            },
          },
        },
      }),
      prisma.supplier.count({ where }),
    ]);
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = createSchema.parse(await readJson(req));
    const created = await prisma.$transaction(async (tx) => {
      const hierarchy = await validatePartyHierarchy(tx, "supplier", {
        level: body.level,
        parentId: body.parentId,
      });
      await assertNameUnique(tx, "supplier", body.name, hierarchy.level, hierarchy.parentId);
      const { contacts, ...rest } = body;
      if (contacts && contacts.filter((c) => c.isPrimary).length > 1) {
        throw new ApiError(422, "只能设置一个主要联系人", "MULTIPLE_PRIMARY_CONTACTS");
      }
      const supplier = await tx.supplier.create({
        data: {
          ...rest,
          level: hierarchy.level,
          parentId: hierarchy.parentId,
          contacts: contacts?.length ? { create: contacts } : undefined,
        },
        include: { parent: { select: { id: true, name: true } } },
      });
      await writeChangeLog(tx, {
        user,
        resource: "supplier",
        recordId: supplier.id,
        action: "CREATE",
        summary: `创建供应商 ${supplier.name}`,
        after: supplier,
      });
      return supplier;
    });
    return jsonOk(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
