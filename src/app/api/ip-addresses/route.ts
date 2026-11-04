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
  sortParams,
} from "@/lib/api";
import { IP_ADDRESS_ROLES, IP_ADDRESS_STATUS } from "@/lib/enums";
import { ipAddressSchema } from "@/lib/ip-address-schema";
import { recomputeIpCustomersForSpan, validateAddressInput } from "@/server/services/ipam";
import { resolveSupplierForCreate } from "@/server/services/supplier-requirements";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const where: Prisma.IpAddressWhereInput = {};
    if (paging.keyword) {
      const kw = paging.keyword;
      where.OR = [
        { address: { contains: kw } },
        { dnsName: { contains: kw } },
        { description: { contains: kw } },
        { block: { is: { cidr: { contains: kw } } } },
        { supplier: { is: { name: { contains: kw } } } },
        { customer: { is: { name: { contains: kw } } } },
        { rack: { is: { code: { contains: kw } } } },
        { device: { is: { name: { contains: kw } } } },
        { line: { is: { code: { contains: kw } } } },
      ];
    }
    const status = queryValue(req, "status");
    const role = queryValue(req, "role");
    if (status && IP_ADDRESS_STATUS.some((o) => o.value === status)) where.status = status;
    if (role && IP_ADDRESS_ROLES.some((o) => o.value === role)) where.role = role;
    for (const key of [
      "blockId",
      "deviceId",
      "lineId",
      "supplierId",
      "customerId",
      "rackId",
    ] as const) {
      const v = queryValue(req, key);
      if (v) where[key] = v;
    }
    const { orderBy } = sortParams(
      req,
      { address: "address", createdAt: "createdAt", updatedAt: "updatedAt" },
      "address",
    );
    const [items, total] = await Promise.all([
      prisma.ipAddress.findMany({
        where,
        orderBy,
        skip: paging.skip,
        take: paging.pageSize,
        include: {
          block: {
            select: {
              id: true,
              cidr: true,
              kind: true,
              rangeStart: true,
              rangeEnd: true,
              status: true,
            },
          },
          supplier: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          rack: { select: { id: true, code: true, location: true, uStart: true, uEnd: true } },
          device: { select: { id: true, name: true } },
          line: { select: { id: true, code: true } },
          _count: { select: { endpoints: true } },
        },
      }),
      prisma.ipAddress.count({ where }),
    ]);
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = ipAddressSchema.parse(await readJson(req));
    const created = await prisma.$transaction(async (tx) => {
      const data = await validateAddressInput(tx, body);
      const supplierId = await resolveSupplierForCreate(
        tx,
        data.supplierId as string | null,
      );
      data.supplierId = supplierId;

      if (body.isPrimary && body.deviceId) {
        await tx.ipAddress.updateMany({
          where: { deviceId: body.deviceId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const exists = await tx.ipAddress.findUnique({ where: { address: String(data.address) } });
      if (exists) throw new ApiError(409, `IP 地址 ${data.address} 已存在`, "DUPLICATE_IP");
      const ip = await tx.ipAddress.create({
        data: data as unknown as Prisma.IpAddressUncheckedCreateInput,
      });
      await recomputeIpCustomersForSpan(tx, ip.address, ip.address);
      await writeChangeLog(tx, {
        user,
        resource: "ipAddress",
        recordId: ip.id,
        action: "CREATE",
        summary: `创建 IP ${ip.address}`,
        after: ip,
      });
      return tx.ipAddress.findUniqueOrThrow({ where: { id: ip.id } });
    });
    return jsonOk(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
