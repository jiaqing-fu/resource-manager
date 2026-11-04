import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireAdmin, requireUser } from "@/lib/api";
import { broadbandUpdateSchema } from "@/lib/broadband-schema";
import { computeReusePercent } from "@/lib/broadband";
import { summarizeAllocationCustomers } from "@/lib/customer-summary";
import { resolveSupplierForUpdate } from "@/server/services/supplier-requirements";
import { assertResourceNotAllocated } from "@/server/services/allocations";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const broadband = await prisma.broadband.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        rack: { select: { id: true, code: true, location: true, uStart: true, uEnd: true } },
        device: { select: { id: true, name: true } },
        line: { select: { id: true, code: true, name: true } },
        ipAddress: { select: { id: true, address: true } },
        allocations: {
          where: { releasedAt: null },
          orderBy: { allocatedAt: "desc" },
          select: {
            id: true,
            customerId: true,
            customer: { select: { id: true, name: true } },
            allocatedMbps: true,
            allocatedAt: true,
            notes: true,
            uStart: true,
            uEnd: true,
          },
        },
      },
    });
    if (!broadband) throw new ApiError(404, "宽带不存在", "NOT_FOUND");
    const allocatedMbps = broadband.allocations.reduce(
      (sum, allocation) => sum + (allocation.allocatedMbps ?? 0),
      0,
    );
    const summary = summarizeAllocationCustomers(broadband.allocations);
    return jsonOk({
      ...broadband,
      allocatedMbps,
      reusePercent: computeReusePercent(broadband.bandwidthMbps, allocatedMbps),
      customerSummary: summary.customerSummary,
      customerNames: summary.customerNames,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = broadbandUpdateSchema.parse(await readJson(req));
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.broadband.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "宽带不存在", "NOT_FOUND");
      if (body.name && body.name !== existing.name) {
        const dup = await tx.broadband.findUnique({ where: { name: body.name } });
        if (dup) {
          throw new ApiError(
            409,
            `宽带名称/编号「${body.name}」已存在`,
            "DUPLICATE_BROADBAND_NAME",
          );
        }
      }
      const supplierId = await resolveSupplierForUpdate(
        tx,
        existing.supplierId,
        body.supplierId,
      );
      const data: Record<string, unknown> = { supplierId };
      for (const key of [
        "name",
        "bandwidthMbps",
        "status",
        "expireDate",
        "account",
        "password",
        "installAddress",
        "rackId",
        "deviceId",
        "lineId",
        "ipAddressId",
        "monthlyFeeCents",
        "contractNo",
        "description",
        "notes",
      ] as const) {
        if (body[key] !== undefined) data[key] = body[key];
      }
      const broadband = await tx.broadband.update({
        where: { id },
        data,
        include: { supplier: { select: { id: true, name: true } } },
      });
      await writeChangeLog(tx, {
        user,
        resource: "broadband",
        recordId: id,
        action: "UPDATE",
        summary: `修改宽带 ${broadband.name}`,
        before: existing,
        after: broadband,
      });
      return broadband;
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
      const existing = await tx.broadband.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!existing) throw new ApiError(404, "宽带不存在", "NOT_FOUND");
      await assertResourceNotAllocated(tx, "broadband", id, `宽带「${existing.name}」`);
      await tx.broadband.delete({ where: { id } });
      await writeChangeLog(tx, {
        user,
        resource: "broadband",
        recordId: id,
        action: "DELETE",
        summary: `删除宽带 ${existing.name}`,
        before: existing,
      });
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
