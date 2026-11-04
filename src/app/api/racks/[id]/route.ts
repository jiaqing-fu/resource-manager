import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireAdmin, requireUser } from "@/lib/api";
import { computeRackUsage, validateRackSegment } from "@/server/services/inventory";
import { writeChangeLog } from "@/lib/changelog";
import { rackUpdateSchema } from "@/lib/rack-schema";
import { rackRangeText } from "@/lib/rack";
import { summarizeAllocationCustomers } from "@/lib/customer-summary";
import { rangeWithin } from "@/lib/ranges";
import { resolveSupplierForUpdate } from "@/server/services/supplier-requirements";
import { assertResourceNotAllocated } from "@/server/services/allocations";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const rack = await prisma.rack.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true } },
        allocations: {
          where: { releasedAt: null },
          orderBy: [{ uStart: "asc" }, { allocatedAt: "asc" }],
          select: {
            id: true,
            customerId: true,
            customer: { select: { id: true, name: true } },
            uStart: true,
            uEnd: true,
            allocatedAt: true,
            notes: true,
          },
        },
        devices: {
          orderBy: [{ uStart: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            type: true,
            status: true,
            manufacturer: true,
            model: true,
            uStart: true,
            uHeight: true,
            face: true,
          },
        },
        _count: { select: { devices: true, ipAddresses: true } },
      },
    });
    if (!rack) throw new ApiError(404, "机柜不存在", "NOT_FOUND");
    return jsonOk({
      ...rack,
      ...computeRackUsage(rack.devices),
      ...summarizeAllocationCustomers(rack.allocations),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = rackUpdateSchema.parse(await readJson(req));
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.rack.findUnique({
        where: { id },
        include: {
          devices: {
            select: { name: true, uStart: true, uHeight: true, face: true },
          },
          allocations: {
            where: { releasedAt: null },
            select: { id: true, uStart: true, uEnd: true },
          },
        },
      });
      if (!existing) throw new ApiError(404, "机柜不存在", "NOT_FOUND");

      const code = body.code ?? existing.code;
      const uStart = body.uStart ?? existing.uStart;
      const uEnd = body.uEnd ?? existing.uEnd;
      await validateRackSegment(tx, { code, uStart, uEnd, excludeId: id });

      const deviceOut = existing.devices.find((device) => {
        if (device.uStart === null) return false;
        const deviceEnd = device.uStart + device.uHeight - 1;
        return !rangeWithin(device.uStart, deviceEnd, uStart, uEnd);
      });
      if (deviceOut && deviceOut.uStart !== null) {
        throw new ApiError(
          422,
          `设备「${deviceOut.name}」占用 ${deviceOut.uStart}-${deviceOut.uStart + deviceOut.uHeight - 1}U，超出新机柜区间 ${rackRangeText(uStart, uEnd)}`,
          "DEVICE_OUT_OF_RANGE",
        );
      }

      const rangeChanged = uStart !== existing.uStart || uEnd !== existing.uEnd;
      const allocationOut = existing.allocations.find((allocation) => {
        if (allocation.uStart === null || allocation.uEnd === null) {
          return rangeChanged;
        }
        return !rangeWithin(allocation.uStart, allocation.uEnd, uStart, uEnd);
      });
      if (allocationOut) {
        throw new ApiError(
          422,
          allocationOut.uStart !== null && allocationOut.uEnd !== null
            ? `有效分配区间 ${rackRangeText(allocationOut.uStart, allocationOut.uEnd)} 超出新机柜区间 ${rackRangeText(uStart, uEnd)}，请先释放或调整该分配`
            : "存在缺少区间的历史分配记录，无法调整机柜区间",
          "ALLOCATION_OUT_OF_RANGE",
        );
      }

      const supplierId = await resolveSupplierForUpdate(
        tx,
        existing.supplierId,
        body.supplierId,
      );

      const data: Record<string, unknown> = { code, uStart, uEnd, supplierId };
      for (const key of [
        "location",
        "status",
        "width",
        "power",
        "serial",
        "notes",
      ] as const) {
        if (body[key] !== undefined) data[key] = body[key];
      }
      const rack = await tx.rack.update({
        where: { id },
        data,
        include: { supplier: { select: { id: true, name: true } } },
      });
      await writeChangeLog(tx, {
        user,
        resource: "rack",
        recordId: id,
        action: "UPDATE",
        summary: `修改机柜 ${existing.code} ${rackRangeText(existing.uStart, existing.uEnd)} → ${rack.code} ${rackRangeText(rack.uStart, rack.uEnd)}`,
        before: existing,
        after: rack,
      });
      return rack;
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
      const existing = await tx.rack.findUnique({
        where: { id },
        select: {
          id: true,
          code: true,
          uStart: true,
          uEnd: true,
          _count: {
            select: { devices: true, ipAddresses: true, terminations: true, broadbands: true },
          },
        },
      });
      if (!existing) throw new ApiError(404, "机柜不存在", "NOT_FOUND");
      const c = existing._count;
      const reasons: string[] = [];
      if (c.devices > 0) reasons.push(`${c.devices} 台设备`);
      if (c.ipAddresses > 0) reasons.push(`${c.ipAddresses} 个 IP`);
      if (c.terminations > 0) reasons.push(`${c.terminations} 个线路端点`);
      if (c.broadbands > 0) reasons.push(`${c.broadbands} 条宽带`);
      if (reasons.length > 0) {
        throw new ApiError(409, `机柜「${existing.code}」仍关联 ${reasons.join("、")}，请先清理`, "IN_USE");
      }
      await assertResourceNotAllocated(tx, "rack", id, `机柜「${existing.code}」`);
      await tx.rack.delete({ where: { id } });
      await writeChangeLog(tx, {
        user,
        resource: "rack",
        recordId: id,
        action: "DELETE",
        summary: `删除机柜 ${existing.code} ${rackRangeText(existing.uStart, existing.uEnd)}`,
        before: existing,
      });
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
