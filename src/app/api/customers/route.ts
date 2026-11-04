import { NextRequest } from "next/server";
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
import { PARTY_STATUS } from "@/lib/enums";
import { assertNameUnique, partyBaseSchema } from "@/server/services/party-write";
import { validatePartyHierarchy } from "@/server/services/party";
import { assertSalespersonExists } from "@/server/services/salesperson";
import { writeChangeLog } from "@/lib/changelog";
import { nullableId, zEnum } from "@/lib/validators";

export const dynamic = "force-dynamic";

const createSchema = partyBaseSchema.extend({
  salespersonId: nullableId,
  status: zEnum(PARTY_STATUS, "状态").default("active"),
});

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const level = queryValue(req, "level");
    const parentId = queryValue(req, "parentId");
    const status = queryValue(req, "status");
    const salespersonId = queryValue(req, "salespersonId");
    const where: Record<string, unknown> = {};
    if (paging.keyword) {
      where.OR = [
        { name: { contains: paging.keyword } },
        { contactName: { contains: paging.keyword } },
        { salesperson: { is: { name: { contains: paging.keyword } } } },
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
    if (salespersonId) where.salespersonId = salespersonId;

    const [items, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: [{ level: "asc" }, { name: "asc" }],
        skip: paging.skip,
        take: paging.pageSize,
        include: {
          parent: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true, status: true } },
          _count: {
            select: {
              children: true,
              racks: true,
              ipBlocks: true,
              ipAddresses: true,
              vlans: true,
              vxlans: true,
              broadbands: true,
              devices: true,
              lines: true,
              customerTests: true,
              allocations: true,
            },
          },
        },
      }),
      prisma.customer.count({ where }),
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
      const hierarchy = await validatePartyHierarchy(tx, "customer", {
        level: body.level,
        parentId: body.parentId,
      });
      await assertNameUnique(tx, "customer", body.name, hierarchy.level, hierarchy.parentId);
      if (body.salespersonId) {
        await assertSalespersonExists(tx, body.salespersonId);
      }
      const customer = await tx.customer.create({
        data: { ...body, level: hierarchy.level, parentId: hierarchy.parentId },
        include: {
          parent: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true, status: true } },
        },
      });
      await writeChangeLog(tx, {
        user,
        resource: "customer",
        recordId: customer.id,
        action: "CREATE",
        summary: `创建客户 ${customer.name}`,
        after: customer,
      });
      return customer;
    });
    return jsonOk(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
