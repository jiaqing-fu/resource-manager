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
import { IP_BLOCK_ROLES, IP_BLOCK_STATUS } from "@/lib/enums";
import { ipBlockSchema } from "@/lib/ip-block-schema";
import { ipInBlock, parseIp, parseStoredBlock, usableCount } from "@/lib/ip";
import {
  customerIpBlockWhere,
  recomputeBlockParents,
  syncRangeAddresses,
  validateBlockInput,
} from "@/server/services/ipam";
import {
  assertSupplierConsistent,
  resolveSupplierForCreate,
} from "@/server/services/supplier-requirements";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const where: Prisma.IpBlockWhereInput = {};
    if (paging.keyword) {
      const kw = paging.keyword;
      const or: Prisma.IpBlockWhereInput[] = [
        { cidr: { contains: kw } },
        { description: { contains: kw } },
        { gateway: { contains: kw } },
        { supplier: { is: { name: { contains: kw } } } },
        { customer: { is: { name: { contains: kw } } } },
        { vlan: { is: { name: { contains: kw } } } },
      ];
      if (/^\d+$/.test(kw)) or.push({ vlan: { is: { vid: Number(kw) } } });
      // 输入 IP 时，同时匹配覆盖该地址的 IP 段/区间。
      const ip = parseIp(kw);
      if (ip) {
        const candidates = await prisma.ipBlock.findMany({
          select: {
            id: true,
            cidr: true,
            kind: true,
            rangeStart: true,
            rangeEnd: true,
          },
        });
        const ids = candidates
          .filter((row) => {
            const spec = parseStoredBlock(row);
            return Boolean(
              spec && spec.version === ip.version && ipInBlock(ip.canonical, spec),
            );
          })
          .map((row) => row.id);
        if (ids.length > 0) or.push({ id: { in: ids } });
      }
      where.OR = or;
    }
    const status = queryValue(req, "status");
    const role = queryValue(req, "role");
    const parentId = queryValue(req, "parentId");
    const supplierId = queryValue(req, "supplierId");
    const customerId = queryValue(req, "customerId");
    const vlanId = queryValue(req, "vlanId");
    if (status && IP_BLOCK_STATUS.some((o) => o.value === status)) where.status = status;
    if (role && IP_BLOCK_ROLES.some((o) => o.value === role)) where.role = role;
    if (parentId) where.parentId = parentId;
    if (supplierId) where.supplierId = supplierId;
    if (vlanId) where.vlanId = vlanId;
    if (customerId) {
      // 客户条件与关键字 OR 通过 AND 组合，避免覆盖 where.OR。
      where.AND = [customerIpBlockWhere(customerId)];
    }

    const [rows, total] = await Promise.all([
      prisma.ipBlock.findMany({
        where,
        orderBy: [{ cidr: "asc" }],
        skip: paging.skip,
        take: paging.pageSize,
        include: {
          parent: { select: { id: true, cidr: true } },
          supplier: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          vlan: { select: { id: true, vid: true, name: true } },
          _count: { select: { children: true, ipAddresses: true } },
          ...(customerId
            ? {
                allocations: {
                  where: {
                    customerId,
                    releasedAt: null,
                    ipBlockId: { not: null },
                  },
                  select: {
                    id: true,
                    resourceType: true,
                    ipRangeStart: true,
                    ipRangeEnd: true,
                  },
                },
              }
            : {}),
        },
      }),
      prisma.ipBlock.count({ where }),
    ]);
    const items = rows.map((r) => {
      const parsed = parseStoredBlock(r);
      const isRange = parsed?.kind === "range";
      return {
        ...r,
        version: parsed?.version ?? 4,
        prefix: isRange ? null : (parsed?.prefix ?? null),
        usable: isRange
          ? parsed?.size
          : parsed?.version === 4 && parsed.prefix !== null
            ? usableCount(parsed.version, parsed.prefix)
            : null,
        rangeSize: isRange ? (parsed?.size ?? null) : null,
      };
    });
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = ipBlockSchema.parse(await readJson(req));
    const created = await prisma.$transaction(async (tx) => {
      const normalized = await validateBlockInput(tx, body);
      const dup = await tx.ipBlock.findUnique({ where: { cidr: normalized.cidr } });
      if (dup) throw new ApiError(409, `IP 段 ${normalized.cidr} 已存在`, "DUPLICATE_CIDR");

      const vlan = body.vlanId
        ? await tx.vlan.findUnique({
            where: { id: body.vlanId },
            select: { id: true, supplierId: true },
          })
        : null;
      if (body.vlanId && !vlan) {
        throw new ApiError(422, "所选 VLAN 不存在", "VLAN_NOT_FOUND");
      }
      const parent = normalized.parentId
        ? await tx.ipBlock.findUnique({
            where: { id: normalized.parentId },
            select: { supplierId: true },
          })
        : null;
      const supplierId = await resolveSupplierForCreate(tx, body.supplierId, [
        parent?.supplierId,
        vlan?.supplierId,
      ]);
      assertSupplierConsistent(supplierId, vlan?.supplierId ?? null, " VLAN ");

      const block = await tx.ipBlock.create({
        data: {
          cidr: normalized.cidr,
          kind: normalized.kind,
          rangeStart: normalized.rangeStart,
          rangeEnd: normalized.rangeEnd,
          ipVersion: normalized.ipVersion,
          parentId: normalized.parentId,
          status: body.status,
          role: body.role,
          vlanId: body.vlanId ?? null,
          supplierId,
          customerId: null,
          gateway: body.gateway ?? null,
          description: body.description ?? null,
          assignedAt: body.assignedAt ?? null,
        },
      });
      await recomputeBlockParents(tx);
      const generated = await syncRangeAddresses(tx, block);
      await writeChangeLog(tx, {
        user,
        resource: "ipBlock",
        recordId: block.id,
        action: "CREATE",
        summary: `创建 IP 段 ${block.cidr}`,
        after: block,
      });
      const result = await tx.ipBlock.findUniqueOrThrow({
        where: { id: block.id },
        include: {
          parent: { select: { id: true, cidr: true } },
          supplier: { select: { id: true, name: true } },
        },
      });
      return { ...result, generated };
    }, { maxWait: 10_000, timeout: 30_000 });
    return jsonOk(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
