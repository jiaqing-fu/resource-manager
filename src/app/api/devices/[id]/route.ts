import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireAdmin, requireUser } from "@/lib/api";
import { deviceUpdateSchema } from "@/lib/device-schema";
import { validateDevicePlacement } from "@/server/services/inventory";
import { resolveSupplierForUpdate } from "@/server/services/supplier-requirements";
import { assertResourceNotAllocated } from "@/server/services/allocations";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const device = await prisma.device.findUnique({
      where: { id },
      include: {
        rack: {
          select: { id: true, code: true, location: true, uStart: true, uEnd: true },
        },
        supplier: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        ipAddresses: {
          orderBy: [{ isPrimary: "desc" }, { address: "asc" }],
          select: {
            id: true,
            address: true,
            status: true,
            role: true,
            isPrimary: true,
            dnsName: true,
          },
        },
        terminations: {
          select: {
            id: true,
            side: true,
            port: true,
            line: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (!device) throw new ApiError(404, "设备不存在", "NOT_FOUND");
    return jsonOk(device);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = deviceUpdateSchema.parse(await readJson(req));
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.device.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "设备不存在", "NOT_FOUND");

      const rackId = body.rackId !== undefined ? body.rackId : existing.rackId;
      const placement = await validateDevicePlacement(
        tx,
        {
          rackId,
          uStart: rackId
            ? body.uStart !== undefined
              ? body.uStart
              : existing.uStart
            : null,
          uHeight: body.uHeight ?? existing.uHeight,
          face: body.face ?? existing.face,
        },
        id,
      );
      if (body.serialNo) {
        const dup = await tx.device.findUnique({ where: { serialNo: body.serialNo } });
        if (dup && dup.id !== id) throw new ApiError(409, "设备序列号已存在", "DUPLICATE_SERIAL");
      }
      const supplierId = await resolveSupplierForUpdate(
        tx,
        existing.supplierId,
        body.supplierId,
      );

      const data: Record<string, unknown> = {
        ...placement,
        supplierId,
      };
      for (const key of [
        "name",
        "type",
        "role",
        "status",
        "manufacturer",
        "model",
        "serialNo",
        "assetTag",
        "osVersion",
        "mac",
        "owner",
        "lastInventoryAt",
        "purchaseDate",
        "warrantyEnd",
        "notes",
      ] as const) {
        if (body[key] !== undefined) data[key] = body[key];
      }
      const device = await tx.device.update({
        where: { id },
        data,
        include: {
          rack: { select: { id: true, code: true, location: true, uStart: true, uEnd: true } },
          supplier: { select: { id: true, name: true } },
        },
      });
      await writeChangeLog(tx, {
        user,
        resource: "device",
        recordId: id,
        action: "UPDATE",
        summary: `修改设备 ${device.name}`,
        before: existing,
        after: device,
      });
      return device;
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
      const existing = await tx.device.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          _count: { select: { ipAddresses: true, terminations: true, broadbands: true } },
        },
      });
      if (!existing) throw new ApiError(404, "设备不存在", "NOT_FOUND");
      const reasons: string[] = [];
      if (existing._count.ipAddresses > 0) reasons.push(`${existing._count.ipAddresses} 个 IP`);
      if (existing._count.terminations > 0) reasons.push(`${existing._count.terminations} 个线路端点`);
      if (existing._count.broadbands > 0) reasons.push(`${existing._count.broadbands} 条宽带`);
      if (reasons.length > 0) {
        throw new ApiError(409, `设备「${existing.name}」仍关联 ${reasons.join("、")}，请先解除关联`, "IN_USE");
      }
      await assertResourceNotAllocated(tx, "device", id, `设备「${existing.name}」`);
      await tx.device.delete({ where: { id } });
      await writeChangeLog(tx, {
        user,
        resource: "device",
        recordId: id,
        action: "DELETE",
        summary: `删除设备 ${existing.name}`,
        before: existing,
      });
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
