import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ApiError,
  getPaging,
  handleApiError,
  jsonOk,
  listResult,
  queryValue,
  readJson,
  requireAdmin,
  requireUser,
} from "@/lib/api";
import { PARTY_STATUS } from "@/lib/enums";
import { salespersonSchema } from "@/lib/salesperson-schema";
import { writeChangeLog } from "@/lib/changelog";
import { assertSalespersonNameUnique } from "@/server/services/salesperson";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const where: Record<string, unknown> = {};
    if (paging.keyword) {
      where.OR = [
        { name: { contains: paging.keyword } },
        { phone: { contains: paging.keyword } },
        { notes: { contains: paging.keyword } },
      ];
    }
    const status = queryValue(req, "status");
    if (status && PARTY_STATUS.some((o) => o.value === status)) where.status = status;

    const [items, total] = await Promise.all([
      prisma.salesperson.findMany({
        where,
        orderBy: [{ status: "asc" }, { name: "asc" }],
        skip: paging.skip,
        take: paging.pageSize,
        include: { _count: { select: { customers: true } } },
      }),
      prisma.salesperson.count({ where }),
    ]);
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin(req);
    const body = salespersonSchema.parse(await readJson(req));
    const created = await prisma.$transaction(async (tx) => {
      await assertSalespersonNameUnique(tx, body.name);
      let salesperson;
      try {
        salesperson = await tx.salesperson.create({ data: body });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ApiError(
            409,
            `业务员姓名「${body.name}」已存在`,
            "DUPLICATE_SALESPERSON_NAME",
          );
        }
        throw error;
      }
      await writeChangeLog(tx, {
        user,
        resource: "salesperson",
        recordId: salesperson.id,
        action: "CREATE",
        summary: `创建业务员 ${salesperson.name}`,
        after: salesperson,
      });
      return salesperson;
    });
    return jsonOk(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
