import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireAdmin, requireUser } from "@/lib/api";
import { salespersonUpdateSchema } from "@/lib/salesperson-schema";
import { writeChangeLog } from "@/lib/changelog";
import {
  assertSalespersonNameUnique,
  assertSalespersonUnbound,
} from "@/server/services/salesperson";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const salesperson = await prisma.salesperson.findUnique({
      where: { id },
      include: { _count: { select: { customers: true } } },
    });
    if (!salesperson) throw new ApiError(404, "业务员不存在", "NOT_FOUND");
    return jsonOk(salesperson);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAdmin(req);
    const { id } = await params;
    const body = salespersonUpdateSchema.parse(await readJson(req));
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.salesperson.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "业务员不存在", "NOT_FOUND");

      if (body.name && body.name !== existing.name) {
        await assertSalespersonNameUnique(tx, body.name, id);
      }

      const data: Record<string, unknown> = {};
      for (const key of ["name", "phone", "status", "notes"] as const) {
        if (body[key] !== undefined) data[key] = body[key];
      }

      let salesperson;
      try {
        salesperson = await tx.salesperson.update({
          where: { id },
          data,
          include: { _count: { select: { customers: true } } },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ApiError(
            409,
            `业务员姓名「${body.name ?? existing.name}」已存在`,
            "DUPLICATE_SALESPERSON_NAME",
          );
        }
        throw error;
      }

      await writeChangeLog(tx, {
        user,
        resource: "salesperson",
        recordId: id,
        action: "UPDATE",
        summary: `修改业务员 ${salesperson.name}`,
        before: existing,
        after: salesperson,
      });
      return salesperson;
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
      const existing = await tx.salesperson.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "业务员不存在", "NOT_FOUND");
      await assertSalespersonUnbound(tx, id);
      await tx.salesperson.delete({ where: { id } });
      await writeChangeLog(tx, {
        user,
        resource: "salesperson",
        recordId: id,
        action: "DELETE",
        summary: `删除业务员 ${existing.name}`,
        before: existing,
      });
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
