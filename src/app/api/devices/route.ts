import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
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
import { DEVICE_ROLES, DEVICE_STATUS, DEVICE_TYPES } from "@/lib/enums";
import { deviceSchema } from "@/lib/device-schema";
import { assignResourceCustomer } from "@/server/services/allocations";
import { validateDevicePlacement } from "@/server/services/inventory";
import { resolveSupplierForCreate } from "@/server/services/supplier-requirements";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const where: Prisma.DeviceWhereInput = {};
    if (paging.keyword) {
      const kw = paging.keyword;
      where.OR = [
        { name: { contains: kw } },
        { serialNo: { contains: kw } },
        { model: { contains: kw } },
        { assetTag: { contains: kw } },
        { mac: { contains: kw } },
        { manufacturer: { contains: kw } },
        { osVersion: { contains: kw } },
        { owner: { contains: kw } },
        { notes: { contains: kw } },
        { rack: { is: { code: { contains: kw } } } },
        { rack: { is: { location: { contains: kw } } } },
        { supplier: { is: { name: { contains: kw } } } },
        { customer: { is: { name: { contains: kw } } } },
      ];
    }
    const type = queryValue(req, "type");
    const role = queryValue(req, "role");
    const status = queryValue(req, "status");
    if (type && DEVICE_TYPES.some((o) => o.value === type)) where.type = type;
    if (role && DEVICE_ROLES.some((o) => o.value === role)) where.role = role;
    if (status && DEVICE_STATUS.some((o) => o.value === status)) where.status = status;
    for (const key of ["rackId", "supplierId", "customerId"] as const) {
      const v = queryValue(req, key);
      if (v) where[key] = v;
    }
    const warrantyBefore = queryValue(req, "warrantyBefore");
    if (warrantyBefore) {
      where.warrantyEnd = { not: null, lte: warrantyBefore };
    }

    const [items, total] = await Promise.all([
      prisma.device.findMany({
        where,
        orderBy: { name: "asc" },
        skip: paging.skip,
        take: paging.pageSize,
        include: {
          rack: {
            select: { id: true, code: true, location: true, uStart: true, uEnd: true },
          },
          supplier: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          ipAddresses: {
            where: { isPrimary: true },
            take: 1,
            select: { id: true, address: true },
          },
          _count: { select: { ipAddresses: true, terminations: true } },
        },
      }),
      prisma.device.count({ where }),
    ]);
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = deviceSchema.parse(await readJson(req));
    const created = await prisma.$transaction(async (tx) => {
      const placement = await validateDevicePlacement(tx, body);
      if (body.serialNo) {
        const dup = await tx.device.findUnique({ where: { serialNo: body.serialNo } });
        if (dup) throw new ApiError(409, "设备序列号已存在", "DUPLICATE_SERIAL");
      }
      const rack = placement.rackId
        ? await tx.rack.findUnique({
            where: { id: placement.rackId },
            select: { supplierId: true },
          })
        : null;
      const supplierId = await resolveSupplierForCreate(tx, body.supplierId, [rack?.supplierId]);
      let device = await tx.device.create({
        data: {
          name: body.name,
          type: body.type,
          role: body.role,
          status: body.status,
          manufacturer: body.manufacturer ?? null,
          model: body.model ?? null,
          serialNo: body.serialNo ?? null,
          assetTag: body.assetTag ?? null,
          osVersion: body.osVersion ?? null,
          mac: body.mac ?? null,
          owner: body.owner ?? null,
          lastInventoryAt: body.lastInventoryAt ?? null,
          purchaseDate: body.purchaseDate ?? null,
          warrantyEnd: body.warrantyEnd ?? null,
          notes: body.notes ?? null,
          supplierId,
          customerId: null,
          ...placement,
        },
        include: {
          rack: { select: { id: true, code: true, location: true, uStart: true, uEnd: true } },
          supplier: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
        },
      });
      if (body.customerId) {
        await assignResourceCustomer(tx, {
          resourceType: "device",
          resourceId: device.id,
          customerId: body.customerId,
          notes: "创建资源时绑定",
        });
        device = await tx.device.findUniqueOrThrow({
          where: { id: device.id },
          include: {
            rack: { select: { id: true, code: true, location: true, uStart: true, uEnd: true } },
            supplier: { select: { id: true, name: true } },
            customer: { select: { id: true, name: true } },
          },
        });
      }
      await writeChangeLog(tx, {
        user,
        resource: "device",
        recordId: device.id,
        action: "CREATE",
        summary: `创建设备 ${device.name}`,
        after: device,
      });
      return device;
    });
    return jsonOk(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
