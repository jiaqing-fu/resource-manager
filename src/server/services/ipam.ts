import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";
import {
  blockContainsBlock,
  blockOverlapsBlock,
  ipInBlock,
  ipv4LongToIp,
  ipv4ToLong,
  ipv4UsableCount,
  listIpv4Hosts,
  MAX_RANGE_ADDRESSES,
  parseBlockSpec,
  parseIp,
  parseIpRange,
  parseStoredBlock,
  rangeToBlock,
  type ParsedBlock,
} from "@/lib/ip";

type Tx = Prisma.TransactionClient;

const CHUNK_SIZE = 500;

export type BlockInput = {
  cidr: string;
  status: string;
  role: string;
  parentId?: string | null;
  gateway?: string | null;
  vlanId?: string | null;
  supplierId?: string | null;
  description?: string | null;
  assignedAt?: string | null;
};

export type RangeBlockRef = {
  id: string;
  cidr: string;
  kind: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  ipVersion: number;
  supplierId: string | null;
};

type ParsedRow = {
  id: string;
  cidr: string;
  kind: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  spec: ParsedBlock;
};

function chunkArray<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sameCoverage(a: ParsedBlock, b: ParsedBlock): boolean {
  if (a.version !== b.version) return false;
  if (a.version === 4) {
    return a.startLong === b.startLong && a.endLong === b.endLong;
  }
  return a.canonical === b.canonical;
}

async function loadParsedBlocks(tx: Tx, excludeId?: string): Promise<ParsedRow[]> {
  const rows = await tx.ipBlock.findMany({
    select: { id: true, cidr: true, kind: true, rangeStart: true, rangeEnd: true },
  });
  const parsed: ParsedRow[] = [];
  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue;
    const spec = parseStoredBlock(row);
    if (spec) parsed.push({ ...row, spec });
  }
  return parsed;
}

function parseBlockSpecStrict(input: string): ParsedBlock {
  const spec = parseBlockSpec(input);
  if (spec) return spec;
  const maybeRange = parseIpRange(input);
  if (maybeRange?.version === 6) {
    throw new ApiError(422, "暂不支持 IPv6 任意 IP 区间", "IPV6_RANGE_UNSUPPORTED");
  }
  throw new ApiError(
    422,
    "请使用 CIDR（如 192.168.1.0/24）或 IPv4 IP 区间（如 10.99.1.0-10.99.1.255）",
    "INVALID_CIDR",
  );
}

function addressList(startLong: number, endLong: number): string[] {
  const out: string[] = [];
  for (let n = startLong; n <= endLong; n++) out.push(ipv4LongToIp(n));
  return out;
}

function spanFromIps(startIp: string, endIp: string) {
  const range = parseIpRange(`${startIp}-${endIp}`);
  if (
    !range ||
    range.version !== 4 ||
    range.size === null ||
    range.size > MAX_RANGE_ADDRESSES
  ) {
    return null;
  }
  return range;
}

/** 所有 IP 段的父级由覆盖范围自动推导，保证树与利用率一致。 */
export async function recomputeBlockParents(tx: Tx): Promise<void> {
  const blocks = await tx.ipBlock.findMany({
    select: {
      id: true,
      cidr: true,
      parentId: true,
      kind: true,
      rangeStart: true,
      rangeEnd: true,
    },
  });
  const parsed: { id: string; parentId: string | null; spec: ParsedBlock }[] = [];
  for (const b of blocks) {
    const spec = parseStoredBlock(b);
    if (spec) parsed.push({ id: b.id, parentId: b.parentId, spec });
  }
  parsed.sort((a, b) => {
    if (a.spec.version !== b.spec.version) return a.spec.version - b.spec.version;
    if (a.spec.version === 4) return (b.spec.size ?? 0) - (a.spec.size ?? 0);
    return (a.spec.prefix ?? 128) - (b.spec.prefix ?? 128);
  });

  const updates: { id: string; parentId: string | null }[] = [];
  for (const current of parsed) {
    let parent: string | null = null;
    // 已按覆盖范围从大到小排序，最后一个严格包含项即最具体父段。
    for (const candidate of parsed) {
      if (candidate.id === current.id) continue;
      if (!blockContainsBlock(candidate.spec, current.spec)) continue;
      if (sameCoverage(candidate.spec, current.spec)) continue;
      parent = candidate.id;
    }
    if (parent !== current.parentId) updates.push({ id: current.id, parentId: parent });
  }
  for (const u of updates) {
    await tx.ipBlock.update({ where: { id: u.id }, data: { parentId: u.parentId } });
  }
}

async function assertBlockCoverageAvailable(
  tx: Tx,
  spec: ParsedBlock,
  excludeId?: string,
): Promise<void> {
  const existing = await loadParsedBlocks(tx, excludeId);
  for (const row of existing) {
    if (row.spec.version !== spec.version) continue;
    if (!blockOverlapsBlock(row.spec, spec)) continue;
    const contained =
      blockContainsBlock(row.spec, spec) || blockContainsBlock(spec, row.spec);
    if (!contained || sameCoverage(row.spec, spec)) {
      const reason = sameCoverage(row.spec, spec)
        ? "已存在相同覆盖范围"
        : "与已有 IP 段部分重叠";
      throw new ApiError(
        409,
        `${reason}：${row.cidr}，请调整范围`,
        "BLOCK_RANGE_OVERLAP",
      );
    }
  }
}

/** 校验 IP 段新增/编辑的字段，返回规范化数据。 */
export async function validateBlockInput(
  tx: Tx,
  input: BlockInput,
  id?: string,
): Promise<{
  cidr: string;
  kind: "cidr" | "range";
  rangeStart: string | null;
  rangeEnd: string | null;
  ipVersion: number;
  parentId: string | null;
}> {
  const spec = parseBlockSpecStrict(input.cidr);

  if (spec.kind === "range") {
    if (spec.size === null || spec.size > MAX_RANGE_ADDRESSES) {
      throw new ApiError(
        422,
        `单个 IP 区间最多 ${MAX_RANGE_ADDRESSES} 个地址，请拆分为多个区间`,
        "RANGE_TOO_LARGE",
      );
    }
    if (input.status === "container") {
      throw new ApiError(422, "IP 区间不能设为容器状态", "RANGE_CONTAINER_UNSUPPORTED");
    }
  }

  if (input.gateway) {
    const gw = parseIp(input.gateway);
    if (!gw) throw new ApiError(422, "网关地址格式不正确", "INVALID_GATEWAY");
    if (!ipInBlock(gw.canonical, spec)) {
      throw new ApiError(422, "网关必须属于该网段且协议版本一致", "GATEWAY_OUT_OF_RANGE");
    }
  }

  if (id) {
    const existing = await tx.ipBlock.findUnique({
      where: { id },
      select: {
        id: true,
        cidr: true,
        kind: true,
        rangeStart: true,
        rangeEnd: true,
        _count: { select: { ipAddresses: true, children: true } },
      },
    });
    if (!existing) throw new ApiError(404, "IP 段不存在", "NOT_FOUND");
    if (existing.kind !== spec.kind) {
      throw new ApiError(
        409,
        "CIDR 与 IP 区间不能互相转换，请删除后重新创建",
        "BLOCK_KIND_CHANGE_UNSUPPORTED",
      );
    }
    if (input.status === "container" && existing._count.ipAddresses > 0) {
      throw new ApiError(409, "该网段下已有 IP 地址，不能设为容器状态", "CONTAINER_HAS_IPS");
    }

    const oldSpec = parseStoredBlock(existing);
    const coverageChanged = !oldSpec || oldSpec.canonical !== spec.canonical;
    if (coverageChanged) {
      if (existing._count.children > 0) {
        throw new ApiError(
          409,
          "该网段下已有子网段，不能修改覆盖范围",
          "BLOCK_HAS_CHILDREN",
        );
      }
      const ips = await tx.ipAddress.findMany({
        where: { blockId: id },
        select: { address: true },
      });
      const outside = ips.filter((ip) => !ipInBlock(ip.address, spec));
      if (outside.length > 0) {
        throw new ApiError(
          409,
          `新范围不包含已有 IP（如 ${outside[0].address}），请先调整 IP 归属`,
          "IPS_OUTSIDE_BLOCK",
        );
      }

      const allocations = await tx.resourceAllocation.findMany({
        where: { resourceType: "ipRange", ipBlockId: id, releasedAt: null },
        select: { ipRangeStart: true, ipRangeEnd: true },
      });
      for (const allocation of allocations) {
        const range =
          allocation.ipRangeStart && allocation.ipRangeEnd
            ? parseIpRange(`${allocation.ipRangeStart}-${allocation.ipRangeEnd}`)
            : null;
        const rangeSpec = range ? rangeToBlock(range) : null;
        if (!rangeSpec || !blockContainsBlock(spec, rangeSpec)) {
          throw new ApiError(
            409,
            "新范围不包含该段上的有效 IP 区间分配，请先释放相关分配",
            "ALLOCATIONS_OUTSIDE_BLOCK",
          );
        }
      }
    }
  }

  await assertBlockCoverageAvailable(tx, spec, id);

  let parentId: string | null = null;
  const rawParent = input.parentId;
  if (rawParent) {
    if (id && rawParent === id) {
      throw new ApiError(422, "不能将自身设置为父网段", "SELF_PARENT");
    }
    const parent = await tx.ipBlock.findUnique({
      where: { id: rawParent },
      select: {
        id: true,
        cidr: true,
        kind: true,
        rangeStart: true,
        rangeEnd: true,
      },
    });
    if (!parent) throw new ApiError(422, "父网段不存在", "PARENT_NOT_FOUND");
    const parentSpec = parseStoredBlock(parent);
    if (
      !parentSpec ||
      !blockContainsBlock(parentSpec, spec) ||
      sameCoverage(parentSpec, spec)
    ) {
      throw new ApiError(
        422,
        `父网段 ${parent.cidr} 不包含 ${spec.canonical}`,
        "PARENT_NOT_CONTAIN",
      );
    }
    parentId = parent.id;
  }

  return {
    cidr: spec.canonical,
    kind: spec.kind,
    rangeStart: spec.kind === "range" ? spec.startIp : null,
    rangeEnd: spec.kind === "range" ? spec.endIp : null,
    ipVersion: spec.version,
    parentId,
  };
}

export type DeleteBlockResult = { deletedAddresses: number; cidr: string };

/**
 * 删除 IP 段。withAddresses 为 true 时连带删除未被引用、未被有效区间分配覆盖的直属 IP。
 */
export async function deleteBlockCascade(
  tx: Tx,
  id: string,
  opts: { withAddresses: boolean },
): Promise<DeleteBlockResult> {
  const block = await tx.ipBlock.findUnique({
    where: { id },
    select: {
      id: true,
      cidr: true,
      _count: { select: { children: true, ipAddresses: true } },
    },
  });
  if (!block) throw new ApiError(404, "IP 段不存在", "NOT_FOUND");
  if (block._count.children > 0) {
    throw new ApiError(
      409,
      `IP 段 ${block.cidr} 下仍有 ${block._count.children} 个子网段，请先清理`,
      "IN_USE",
    );
  }

  const activeBlockAllocations = await tx.resourceAllocation.count({
    where: {
      ipBlockId: id,
      releasedAt: null,
      resourceType: { in: ["ipBlock", "ipRange"] },
    },
  });
  if (activeBlockAllocations > 0) {
    throw new ApiError(409, "该 IP 段上仍有有效资源分配，请先释放", "RESOURCE_ALLOCATED");
  }

  const ips = await tx.ipAddress.findMany({
    where: { blockId: id },
    select: { id: true, address: true },
  });
  if (ips.length > 0 && !opts.withAddresses) {
    throw new ApiError(
      409,
      `IP 段 ${block.cidr} 下仍有 ${ips.length} 个 IP，可勾选“连带删除未使用 IP”后重试`,
      "IN_USE",
    );
  }

  if (ips.length > 0) {
    const ipIds = ips.map((ip) => ip.id);
    const reasons: string[] = [];

    const endpointCount = await tx.businessSystemEndpoint.count({
      where: { ipAddressId: { in: ipIds } },
    });
    if (endpointCount > 0) reasons.push(`${endpointCount} 个业务系统端点`);

    const broadbandCount = await tx.broadband.count({
      where: { ipAddressId: { in: ipIds } },
    });
    if (broadbandCount > 0) reasons.push(`${broadbandCount} 条宽带引用`);

    const allocatedCount = await tx.resourceAllocation.count({
      where: {
        resourceType: "ipAddress",
        ipAddressId: { in: ipIds },
        releasedAt: null,
      },
    });
    if (allocatedCount > 0) reasons.push(`${allocatedCount} 个有效单 IP 分配`);

    const activeRanges = await tx.resourceAllocation.findMany({
      where: { resourceType: "ipRange", releasedAt: null },
      select: { ipRangeStart: true, ipRangeEnd: true },
    });
    const intervals = activeRanges.flatMap((row) => {
      if (!row.ipRangeStart || !row.ipRangeEnd) return [];
      const range = parseIpRange(`${row.ipRangeStart}-${row.ipRangeEnd}`);
      if (!range || range.startLong === null || range.endLong === null) return [];
      return [{ start: range.startLong, end: range.endLong }];
    });
    const covered = ips.find((ip) => {
      const n = ipv4ToLong(ip.address);
      return n !== null && intervals.some((r) => n >= r.start && n <= r.end);
    });
    if (covered) reasons.push(`IP ${covered.address} 被有效区间分配覆盖`);

    if (reasons.length > 0) {
      throw new ApiError(
        409,
        `IP 段 ${block.cidr} 下的 IP 仍被引用（${reasons.join("、")}），不能删除`,
        "IN_USE",
      );
    }

    await tx.ipAddress.deleteMany({ where: { blockId: id } });
  }

  await tx.ipBlock.delete({ where: { id } });
  await recomputeBlockParents(tx);
  return { deletedAddresses: ips.length, cidr: block.cidr };
}

export type BlockTreeNode = {
  id: string;
  cidr: string;
  kind: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  status: string;
  role: string;
  parentId: string | null;
  supplierId: string | null;
  customerId: string | null;
  supplierName: string | null;
  customerName: string | null;
  directUsed: number;
  /** 兼容旧字段：等于 entered。 */
  used: number;
  entered: number;
  allocated: number;
  total: number | null;
  percent: number | null;
  children: BlockTreeNode[];
};

/** 构建 IP 段树，并聚合每个节点（含子段）的利用情况。 */
export async function buildBlockTree(tx: Tx): Promise<BlockTreeNode[]> {
  const [blocks, grouped, allocatedGrouped, wholeBlockRows] = await Promise.all([
    tx.ipBlock.findMany({
      orderBy: { cidr: "asc" },
      include: {
        supplier: { select: { name: true } },
        customer: { select: { name: true } },
      },
    }),
    tx.ipAddress.groupBy({ by: ["blockId"], _count: { _all: true } }),
    tx.ipAddress.groupBy({
      by: ["blockId"],
      where: { customerId: { not: null } },
      _count: { _all: true },
    }),
    tx.resourceAllocation.findMany({
      where: { resourceType: "ipBlock", releasedAt: null, ipBlockId: { not: null } },
      select: { ipBlockId: true },
    }),
  ]);
  const directCount = new Map<string, number>();
  for (const g of grouped) {
    if (g.blockId) directCount.set(g.blockId, g._count._all);
  }
  const directAllocated = new Map<string, number>();
  for (const g of allocatedGrouped) {
    if (g.blockId) directAllocated.set(g.blockId, g._count._all);
  }
  const wholeBlock = new Set(
    wholeBlockRows.map((row) => row.ipBlockId).filter((v): v is string => Boolean(v)),
  );

  const nodes = new Map<string, BlockTreeNode>();
  for (const b of blocks) {
    const spec = parseStoredBlock(b);
    const direct = directCount.get(b.id) ?? 0;
    const total =
      spec?.kind === "range"
        ? spec.size
        : spec?.version === 4 && spec.prefix !== null
          ? ipv4UsableCount(spec.prefix)
          : null;
    nodes.set(b.id, {
      id: b.id,
      cidr: b.cidr,
      kind: b.kind,
      rangeStart: b.rangeStart,
      rangeEnd: b.rangeEnd,
      status: b.status,
      role: b.role,
      parentId: b.parentId,
      supplierId: b.supplierId,
      customerId: b.customerId,
      supplierName: b.supplier?.name ?? null,
      customerName: b.customer?.name ?? null,
      directUsed: direct,
      used: direct,
      entered: direct,
      allocated: directAllocated.get(b.id) ?? 0,
      total,
      percent: null,
      children: [],
    });
  }

  const roots: BlockTreeNode[] = [];
  for (const b of blocks) {
    const node = nodes.get(b.id)!;
    if (b.parentId && nodes.has(b.parentId)) {
      nodes.get(b.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const aggregate = (
    node: BlockTreeNode,
  ): { entered: number; allocated: number; total: number | null } => {
    let entered = node.directUsed;
    let total = node.total;
    let childAllocated = 0;
    if (node.children.length > 0) {
      let childTotal = 0;
      let childTotalKnown = true;
      for (const child of node.children) {
        const r = aggregate(child);
        entered += r.entered;
        childAllocated += r.allocated;
        if (r.total === null) childTotalKnown = false;
        else childTotal += r.total;
      }
      if (node.status === "container") {
        total = childTotalKnown ? childTotal : null;
      } else if (node.total === null) {
        total = null;
      }
    } else if (node.status === "container") {
      total = 0;
    }

    let allocated = (directAllocated.get(node.id) ?? 0) + childAllocated;
    if (wholeBlock.has(node.id)) {
      allocated = total ?? node.directUsed;
    }
    if (total !== null) allocated = Math.min(allocated, total);

    node.entered = entered;
    node.used = entered;
    node.allocated = allocated;
    node.total = total;
    node.percent =
      total && total > 0 ? Math.min(100, Math.round((allocated / total) * 1000) / 10) : 0;
    return { entered, allocated, total };
  };

  for (const root of roots) aggregate(root);
  return roots;
}

export function findTreeNode(nodes: BlockTreeNode[], id: string): BlockTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findTreeNode(node.children, id);
    if (found) return found;
  }
  return null;
}

export async function getBlockUtilization(tx: Tx, id: string) {
  const tree = await buildBlockTree(tx);
  const node = findTreeNode(tree, id);
  if (!node) throw new ApiError(404, "IP 段不存在", "NOT_FOUND");
  return node;
}

export type AddressInput = {
  address: string;
  blockId?: string | null;
  status: string;
  role: string;
  supplierId?: string | null;
  rackId?: string | null;
  deviceId?: string | null;
  lineId?: string | null;
  isPrimary: boolean;
  dnsName?: string | null;
  description?: string | null;
  assignedAt?: string | null;
};

/**
 * 校验 IP 地址并补齐网段/设备/机柜/线路带出的关联字段。
 * 客户归属由资源分配与 recomputeIpCustomersForSpan 维护。
 */
export async function validateAddressInput(
  tx: Tx,
  input: AddressInput,
): Promise<Record<string, unknown>> {
  const ip = parseIp(input.address);
  if (!ip) throw new ApiError(422, "IP 地址格式不正确", "INVALID_IP");

  const data: Record<string, unknown> = {
    address: ip.canonical,
    status: input.status,
    role: input.role,
    isPrimary: input.isPrimary,
    dnsName: input.dnsName ?? null,
    description: input.description ?? null,
    assignedAt: input.assignedAt ?? null,
  };

  let block: {
    id: string;
    cidr: string;
    kind: string;
    rangeStart: string | null;
    rangeEnd: string | null;
    status: string;
    supplierId: string | null;
  } | null = null;
  if (input.blockId) {
    block = await tx.ipBlock.findUnique({
      where: { id: input.blockId },
      select: {
        id: true,
        cidr: true,
        kind: true,
        rangeStart: true,
        rangeEnd: true,
        status: true,
        supplierId: true,
      },
    });
    if (!block) throw new ApiError(422, "所选 IP 段不存在", "BLOCK_NOT_FOUND");
    if (block.status === "container") {
      throw new ApiError(422, "容器网段不能直接分配 IP，请选择具体子网段", "CONTAINER_BLOCK");
    }
    const blockSpec = parseStoredBlock(block);
    if (!blockSpec) {
      throw new ApiError(422, "所选 IP 段的覆盖范围无效", "INVALID_BLOCK_RANGE");
    }
    if (!ipInBlock(ip.canonical, blockSpec)) {
      throw new ApiError(422, `IP ${ip.canonical} 不属于网段 ${block.cidr}`, "IP_OUTSIDE_BLOCK");
    }
    data.blockId = block.id;
  } else {
    data.blockId = null;
  }

  const device = input.deviceId
    ? await tx.device.findUnique({
        where: { id: input.deviceId },
        select: { id: true, rackId: true, supplierId: true },
      })
    : null;
  if (input.deviceId && !device) {
    throw new ApiError(422, "所选设备不存在", "DEVICE_NOT_FOUND");
  }

  const rack = input.rackId
    ? await tx.rack.findUnique({
        where: { id: input.rackId },
        select: { id: true, supplierId: true },
      })
    : null;
  if (input.rackId && !rack) {
    throw new ApiError(422, "所选机柜不存在", "RACK_NOT_FOUND");
  }

  const line = input.lineId
    ? await tx.line.findUnique({
        where: { id: input.lineId },
        select: { id: true, supplierId: true },
      })
    : null;
  if (input.lineId && !line) {
    throw new ApiError(422, "所选线路不存在", "LINE_NOT_FOUND");
  }

  let rackId = input.rackId ?? null;
  if (device) {
    if (!rackId && device.rackId) rackId = device.rackId;
    if (rackId && device.rackId && rackId !== device.rackId) {
      throw new ApiError(422, "IP 所属机柜与设备所在机柜不一致", "RACK_MISMATCH");
    }
  }

  const supplierId =
    input.supplierId ??
    block?.supplierId ??
    device?.supplierId ??
    rack?.supplierId ??
    line?.supplierId ??
    null;

  data.supplierId = supplierId || null;
  data.rackId = rackId || null;
  data.deviceId = device?.id ?? null;
  data.lineId = line?.id ?? null;

  if (input.isPrimary && !device) {
    throw new ApiError(422, "只有绑定设备的 IP 才能设为主管理 IP", "PRIMARY_REQUIRES_DEVICE");
  }

  return data;
}

/** 批量生成 IPv4 地址，排除网络地址、广播地址与网关。 */
export async function generateAddresses(
  tx: Tx,
  blockId: string,
  opts: { count: number; status: string; role: string; description?: string | null },
): Promise<{ created: number; first: string | null; last: string | null }> {
  const block = await tx.ipBlock.findUnique({
    where: { id: blockId },
    select: {
      id: true,
      cidr: true,
      kind: true,
      rangeStart: true,
      rangeEnd: true,
      status: true,
      gateway: true,
      supplierId: true,
    },
  });
  if (!block) throw new ApiError(404, "IP 段不存在", "NOT_FOUND");
  if (block.kind === "range") {
    throw new ApiError(
      422,
      "IP 区间在创建时已自动生成区间内全部地址，无需批量生成",
      "RANGE_AUTO_GENERATED",
    );
  }
  if (block.status === "container") {
    throw new ApiError(422, "容器网段不能生成 IP", "CONTAINER_BLOCK");
  }
  const parsed = parseBlockSpec(block.cidr);
  if (!parsed || parsed.kind !== "cidr" || parsed.version !== 4) {
    throw new ApiError(422, "批量生成仅支持 IPv4 网段", "IPV6_GENERATE_UNSUPPORTED");
  }
  if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > 4096) {
    throw new ApiError(422, "单次生成数量必须在 1 到 4096 之间", "INVALID_COUNT");
  }
  const existing = await tx.ipAddress.findMany({
    where: { blockId },
    select: { address: true },
  });
  const exclude = new Set(existing.map((e) => e.address));
  if (block.gateway) exclude.add(block.gateway);
  const available = ipv4UsableCount(parsed.prefix ?? 32) - exclude.size;
  if (available < opts.count) {
    throw new ApiError(
      422,
      `可用地址不足：剩余约 ${Math.max(0, available)} 个，请求生成 ${opts.count} 个`,
      "NOT_ENOUGH_ADDRESSES",
    );
  }
  const ips = listIpv4Hosts(block.cidr, opts.count, exclude);
  if (ips.length < opts.count) {
    throw new ApiError(422, "可用地址不足，无法生成指定数量", "NOT_ENOUGH_ADDRESSES");
  }
  await tx.ipAddress.createMany({
    data: ips.map((address) => ({
      address,
      blockId: block.id,
      status: opts.status,
      role: opts.role,
      supplierId: block.supplierId,
      description: opts.description ?? null,
    })),
  });
  if (ips.length > 0) {
    await recomputeIpCustomersForSpan(tx, ips[0], ips[ips.length - 1]);
  }
  return { created: ips.length, first: ips[0] ?? null, last: ips[ips.length - 1] ?? null };
}

/**
 * 重算一段 IPv4 地址的客户缓存。
 * 单 IP 有效分配优先，其次有效区间分配；都没有则清空。
 */
export async function recomputeIpCustomersForSpan(
  tx: Tx,
  startIp: string,
  endIp: string,
): Promise<void> {
  const span = spanFromIps(startIp, endIp);
  if (!span || span.startLong === null || span.endLong === null) return;

  const activeRanges = await tx.resourceAllocation.findMany({
    where: { resourceType: "ipRange", releasedAt: null },
    select: {
      customerId: true,
      ipRangeStart: true,
      ipRangeEnd: true,
    },
  });
  const intervals = activeRanges.flatMap((row) => {
    if (!row.ipRangeStart || !row.ipRangeEnd) return [];
    const range = parseIpRange(`${row.ipRangeStart}-${row.ipRangeEnd}`);
    if (
      !range ||
      range.version !== 4 ||
      range.startLong === null ||
      range.endLong === null
    ) {
      return [];
    }
    if (range.startLong > span.endLong! || range.endLong < span.startLong!) return [];
    return [{ start: range.startLong, end: range.endLong, customerId: row.customerId }];
  });

  const addresses = addressList(span.startLong, span.endLong);
  for (const chunk of chunkArray(addresses)) {
    const ips = await tx.ipAddress.findMany({
      where: { address: { in: chunk } },
      select: { id: true, address: true, customerId: true },
    });
    if (ips.length === 0) continue;

    const individual = await tx.resourceAllocation.findMany({
      where: {
        resourceType: "ipAddress",
        releasedAt: null,
        ipAddressId: { in: ips.map((ip) => ip.id) },
      },
      select: { ipAddressId: true, customerId: true },
    });
    const individualByIp = new Map<string, string>();
    for (const row of individual) {
      if (row.ipAddressId) individualByIp.set(row.ipAddressId, row.customerId);
    }

    const changes = new Map<string | null, string[]>();
    for (const ip of ips) {
      const n = ipv4ToLong(ip.address);
      const desired =
        individualByIp.get(ip.id) ??
        (n === null
          ? null
          : (intervals.find((r) => n >= r.start && n <= r.end)?.customerId ?? null));
      if (desired === ip.customerId) continue;
      const key = desired ?? null;
      const ids = changes.get(key) ?? [];
      ids.push(ip.id);
      changes.set(key, ids);
    }

    for (const [customerId, ids] of changes) {
      for (const idChunk of chunkArray(ids)) {
        await tx.ipAddress.updateMany({
          where: { id: { in: idChunk } },
          data: { customerId },
        });
      }
    }
  }
}

async function reparentAddressesToBlock(
  tx: Tx,
  block: RangeBlockRef,
  ids: string[],
): Promise<void> {
  for (const chunk of chunkArray(ids)) {
    await tx.ipAddress.updateMany({
      where: { id: { in: chunk } },
      data: { blockId: block.id },
    });
  }
}

/**
 * 区间段创建/编辑后同步区间内全部 IP。幂等；跳过子段覆盖的地址。
 */
export async function syncRangeAddresses(
  tx: Tx,
  block: RangeBlockRef,
): Promise<{ created: number; reused: number }> {
  if (block.kind !== "range") return { created: 0, reused: 0 };
  const spec = parseStoredBlock(block);
  if (!spec || spec.kind !== "range" || spec.version !== 4) {
    throw new ApiError(422, "IP 区间的覆盖范围无效", "INVALID_BLOCK_RANGE");
  }
  if (spec.size === null || spec.size > MAX_RANGE_ADDRESSES) {
    throw new ApiError(
      422,
      `单个 IP 区间最多 ${MAX_RANGE_ADDRESSES} 个地址，请拆分为多个区间`,
      "RANGE_TOO_LARGE",
    );
  }

  const others = await loadParsedBlocks(tx, block.id);
  const descendants = others.filter(
    (row) =>
      blockContainsBlock(spec, row.spec) && !sameCoverage(row.spec, spec),
  );
  const coveredByDescendant = (n: number) =>
    descendants.some(
      (row) =>
        row.spec.startLong !== null &&
        row.spec.endLong !== null &&
        n >= row.spec.startLong &&
        n <= row.spec.endLong,
    );

  const addresses = addressList(spec.startLong!, spec.endLong!);
  const existingRows: { id: string; address: string; blockId: string | null }[] = [];
  for (const chunk of chunkArray(addresses)) {
    const rows = await tx.ipAddress.findMany({
      where: { address: { in: chunk } },
      select: { id: true, address: true, blockId: true },
    });
    existingRows.push(...rows);
  }
  const existing = new Map(existingRows.map((row) => [row.address, row]));
  const otherById = new Map(others.map((row) => [row.id, row]));

  const reparentIds: string[] = [];
  for (const row of existingRows) {
    if (!row.blockId) {
      reparentIds.push(row.id);
      continue;
    }
    if (row.blockId === block.id) continue;
    const owner = otherById.get(row.blockId);
    if (
      owner &&
      blockContainsBlock(owner.spec, spec) &&
      !sameCoverage(owner.spec, spec)
    ) {
      reparentIds.push(row.id);
    }
  }
  await reparentAddressesToBlock(tx, block, reparentIds);

  const missing: string[] = [];
  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    if (existing.has(address)) continue;
    if (coveredByDescendant(spec.startLong! + i)) continue;
    missing.push(address);
  }
  for (const chunk of chunkArray(missing)) {
    await tx.ipAddress.createMany({
      data: chunk.map((address) => ({
        address,
        blockId: block.id,
        status: "active",
        role: "other",
        supplierId: block.supplierId,
      })),
    });
  }

  await recomputeIpCustomersForSpan(tx, spec.startIp, spec.endIp);
  return { created: missing.length, reused: existingRows.length };
}

/**
 * 仅补齐指定 span 内缺失的 IP，用于在尚未生成地址的段上创建区间分配。
 */
export async function ensureAddressesInSpan(
  tx: Tx,
  block: RangeBlockRef,
  startIp: string,
  endIp: string,
): Promise<{ created: number; reused: number }> {
  const blockSpec = parseStoredBlock(block);
  const span = spanFromIps(startIp, endIp);
  if (!blockSpec || !span || span.startLong === null || span.endLong === null) {
    throw new ApiError(422, "IP 区间格式不正确或超过 4096 个地址", "INVALID_IP_RANGE");
  }
  const spanSpec = rangeToBlock(span);
  if (!spanSpec || !blockContainsBlock(blockSpec, spanSpec)) {
    throw new ApiError(422, "分配区间必须位于所选 IP 段内", "IP_RANGE_OUTSIDE_BLOCK");
  }

  const others = await loadParsedBlocks(tx, block.id);
  const descendants = others.filter(
    (row) =>
      blockContainsBlock(blockSpec, row.spec) && !sameCoverage(row.spec, blockSpec),
  );
  const coveredByDescendant = (n: number) =>
    descendants.some(
      (row) =>
        row.spec.startLong !== null &&
        row.spec.endLong !== null &&
        n >= row.spec.startLong &&
        n <= row.spec.endLong,
    );

  const addresses = addressList(span.startLong, span.endLong);
  const existingRows: { id: string; address: string; blockId: string | null }[] = [];
  for (const chunk of chunkArray(addresses)) {
    const rows = await tx.ipAddress.findMany({
      where: { address: { in: chunk } },
      select: { id: true, address: true, blockId: true },
    });
    existingRows.push(...rows);
  }
  const existing = new Set(existingRows.map((row) => row.address));
  const otherById = new Map(others.map((row) => [row.id, row]));

  const reparentIds: string[] = [];
  for (const row of existingRows) {
    if (!row.blockId) {
      reparentIds.push(row.id);
      continue;
    }
    if (row.blockId === block.id) continue;
    const owner = otherById.get(row.blockId);
    if (
      owner &&
      blockContainsBlock(owner.spec, blockSpec) &&
      !sameCoverage(owner.spec, blockSpec)
    ) {
      reparentIds.push(row.id);
    }
  }
  await reparentAddressesToBlock(tx, block, reparentIds);

  const missing: string[] = [];
  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    if (existing.has(address)) continue;
    if (coveredByDescendant(span.startLong + i)) continue;
    missing.push(address);
  }
  for (const chunk of chunkArray(missing)) {
    await tx.ipAddress.createMany({
      data: chunk.map((address) => ({
        address,
        blockId: block.id,
        status: "active",
        role: "other",
        supplierId: block.supplierId,
      })),
    });
  }

  return { created: missing.length, reused: existingRows.length };
}

/** 地址是否处于有效区间分配内；是则抛出 409。 */
export async function assertAddressNotInActiveIpRange(
  tx: Tx,
  address: string,
): Promise<void> {
  const ip = parseIp(address);
  const n = ipv4ToLong(address);
  if (!ip || ip.version !== 4 || n === null) return;
  const rows = await tx.resourceAllocation.findMany({
    where: { resourceType: "ipRange", releasedAt: null },
    select: {
      ipRangeStart: true,
      ipRangeEnd: true,
      customer: { select: { name: true } },
    },
  });
  for (const row of rows) {
    if (!row.ipRangeStart || !row.ipRangeEnd) continue;
    const range = parseIpRange(`${row.ipRangeStart}-${row.ipRangeEnd}`);
    if (
      !range ||
      range.startLong === null ||
      range.endLong === null ||
      n < range.startLong ||
      n > range.endLong
    ) {
      continue;
    }
    throw new ApiError(
      409,
      `IP ${ip.canonical} 属于有效区间分配（客户 ${row.customer.name}），不能修改或删除`,
      "IP_IN_ALLOCATED_RANGE",
    );
  }
}
