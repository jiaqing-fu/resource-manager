import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireAdmin, requireUser } from "@/lib/api";
import { ipAddressUpdateSchema } from "@/lib/ip-address-schema";
import { validateAddressInput } from "@/server/services/ipam";
import { resolveSupplierForUpdate } from "@/server/services/supplier-requirements";
import { assertResourceNotAllocated } from "@/server/services/allocations";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const ip = await prisma.ipAddress.findUnique({
      where: { id },
      include: {
        block: { select: { id: true, cidr: true, status: true } },
        supplier: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        rack: { select: { id: true, code: true, location: true, uStart: true, uEnd: true } },
        device: { select: { id: true, name: true } },
        line: { select: { id: true, code: true, name: true } },
        endpoints: {
          select: {
            id: true,
            port: true,
            protocol: true,
            isPrimary: true,
            system: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!ip) throw new ApiError(404, "IP 地址不存在", "NOT_FOUND");
    return jsonOk(ip);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = ipAddressUpdateSchema.parse(await readJson(req));
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.ipAddress.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "IP 地址不存在", "NOT_FOUND");

      const enforcedSupplierId = await resolveSupplierForUpdate(
        tx,
        existing.supplierId,
        body.supplierId,
      );
      const merged = {
        address: body.address ?? existing.address,
        status: body.status ?? existing.status,
        role: body.role ?? existing.role,
        blockId: body.blockId !== undefined ? body.blockId : existing.blockId,
        supplierId: enforcedSupplierId,
        rackId: body.rackId !== undefined ? body.rackId : existing.rackId,
        deviceId: body.deviceId !== undefined ? body.deviceId : existing.deviceId,
        lineId: body.lineId !== undefined ? body.lineId : existing.lineId,
        isPrimary: body.isPrimary !== undefined ? body.isPrimary : existing.isPrimary,
        dnsName: body.dnsName !== undefined ? body.dnsName : existing.dnsName,
        description: body.description !== undefined ? body.description : existing.description,
        assignedAt: body.assignedAt !== undefined ? body.assignedAt : existing.assignedAt,
      };
      const data = await validateAddressInput(tx, merged);
      if (body.supplierId === null) {
        data.supplierId = null;
      }

      if (merged.isPrimary && merged.deviceId) {
        await tx.ipAddress.updateMany({
          where: { deviceId: merged.deviceId, isPrimary: true, id: { not: id } },
          data: { isPrimary: false },
        });
      }
      const dup = await tx.ipAddress.findUnique({ where: { address: String(data.address) } });
      if (dup && dup.id !== id) {
        throw new ApiError(409, `IP 地址 ${data.address} 已存在`, "DUPLICATE_IP");
      }
      const ip = await tx.ipAddress.update({
        where: { id },
        data: data as unknown as Prisma.IpAddressUncheckedUpdateInput,
      });
      await writeChangeLog(tx, {
        user,
        resource: "ipAddress",
        recordId: id,
        action: "UPDATE",
        summary: `修改 IP ${ip.address}`,
        before: existing,
        after: ip,
      });
      return ip;
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
      const existing = await tx.ipAddress.findUnique({
        where: { id },
        select: {
          id: true,
          address: true,
          _count: { select: { endpoints: true, broadbands: true } },
        },
      });
      if (!existing) throw new ApiError(404, "IP 地址不存在", "NOT_FOUND");
      if (existing._count.endpoints > 0) {
        throw new ApiError(
          409,
          `IP ${existing.address} 仍被 ${existing._count.endpoints} 个业务系统端点引用，请先解除关联`,
          "IN_USE",
        );
      }
      if (existing._count.broadbands > 0) {
        throw new ApiError(
          409,
          `IP ${existing.address} 仍关联 ${existing._count.broadbands} 条宽带，请先解除关联`,
          "IN_USE",
        );
      }
      await assertResourceNotAllocated(tx, "ipAddress", id, `IP ${existing.address}`);
      await tx.ipAddress.delete({ where: { id } });
      await writeChangeLog(tx, {
        user,
        resource: "ipAddress",
        recordId: id,
        action: "DELETE",
        summary: `删除 IP ${existing.address}`,
        before: existing,
      });
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
