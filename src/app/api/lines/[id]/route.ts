import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireAdmin, requireUser } from "@/lib/api";
import { lineUpdateSchema } from "@/lib/line-schema";
import { validateTerminations } from "@/server/services/inventory";
import { resolveSupplierForUpdate } from "@/server/services/supplier-requirements";
import { assertResourceNotAllocated } from "@/server/services/allocations";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const line = await prisma.line.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        terminations: {
          orderBy: { side: "asc" },
          include: {
            rack: { select: { id: true, code: true, location: true, uStart: true, uEnd: true } },
            device: { select: { id: true, name: true } },
          },
        },
        ipAddresses: {
          select: { id: true, address: true, status: true, role: true, isPrimary: true },
        },
      },
    });
    if (!line) throw new ApiError(404, "线路不存在", "NOT_FOUND");
    return jsonOk(line);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = lineUpdateSchema.parse(await readJson(req));
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.line.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "线路不存在", "NOT_FOUND");
      if (body.code && body.code !== existing.code) {
        const dup = await tx.line.findUnique({ where: { code: body.code } });
        if (dup) throw new ApiError(409, `线路编号「${body.code}」已存在`, "DUPLICATE_CODE");
      }

      if (body.terminations !== undefined) {
        const terms = await validateTerminations(tx, body.terminations);
        await tx.lineTermination.deleteMany({ where: { lineId: id } });
        if (terms.length > 0) {
          await tx.lineTermination.createMany({
            data: terms.map((t) => ({ ...t, lineId: id })),
          });
        }
      }

      const supplierId = await resolveSupplierForUpdate(
        tx,
        existing.supplierId,
        body.supplierId,
      );
      const data: Record<string, unknown> = { supplierId };
      for (const key of [
        "code",
        "name",
        "type",
        "status",
        "bandwidthMbps",
        "monthlyFeeCents",
        "circuitNo",
        "installDate",
        "expireDate",
        "description",
      ] as const) {
        if (body[key] !== undefined) data[key] = body[key];
      }
      const line = await tx.line.update({
        where: { id },
        data,
        include: {
          supplier: { select: { id: true, name: true } },
          terminations: {
            orderBy: { side: "asc" },
            include: {
              rack: { select: { id: true, code: true, location: true, uStart: true, uEnd: true } },
              device: { select: { id: true, name: true } },
            },
          },
        },
      });
      await writeChangeLog(tx, {
        user,
        resource: "line",
        recordId: id,
        action: "UPDATE",
        summary: `修改线路 ${line.code} ${line.name}`,
        before: existing,
        after: line,
      });
      return line;
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
      const existing = await tx.line.findUnique({
        where: { id },
        select: {
          id: true,
          code: true,
          name: true,
          _count: { select: { ipAddresses: true, broadbands: true } },
        },
      });
      if (!existing) throw new ApiError(404, "线路不存在", "NOT_FOUND");
      if (existing._count.ipAddresses > 0) {
        throw new ApiError(
          409,
          `线路「${existing.code}」仍关联 ${existing._count.ipAddresses} 个 IP，请先解除关联`,
          "IN_USE",
        );
      }
      if (existing._count.broadbands > 0) {
        throw new ApiError(
          409,
          `线路「${existing.code}」仍关联 ${existing._count.broadbands} 条宽带，请先解除关联`,
          "IN_USE",
        );
      }
      await assertResourceNotAllocated(tx, "line", id, `线路「${existing.code}」`);
      await tx.line.delete({ where: { id } });
      await writeChangeLog(tx, {
        user,
        resource: "line",
        recordId: id,
        action: "DELETE",
        summary: `删除线路 ${existing.code} ${existing.name}`,
        before: existing,
      });
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
