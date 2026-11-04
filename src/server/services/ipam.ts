import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";
import {
  cidrContainsCidr,
  ipInCidr,
  ipv4UsableCount,
  listIpv4Hosts,
  parseCidr,
  parseIp,
  usableCount,
} from "@/lib/ip";

type Tx = Prisma.TransactionClient;

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

/** 所有 IP 段的父级由 CIDR 包含关系自动推导，保证树与利用率一致。 */
export async function recomputeBlockParents(tx: Tx): Promise<void> {
  const blocks = await tx.ipBlock.findMany({
    select: { id: true, cidr: true, parentId: true, ipVersion: true },
  });
  const parsed = blocks
    .map((b) => ({ ...b, p: parseCidr(b.cidr) }))
    .filter((b): b is typeof b & { p: NonNullable<typeof b.p> } => Boolean(b.p))
    .sort((a, b) => a.p.prefix - b.p.prefix);

  const updates: { id: string; parentId: string | null }[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const current = parsed[i];
    let parent: string | null = null;
    for (let j = 0; j < i; j++) {
      const candidate = parsed[j];
      if (candidate.p.version !== current.p.version) continue;
      if (cidrContainsCidr(candidate.cidr, current.cidr)) parent = candidate.id;
    }
    if (parent !== current.parentId) updates.push({ id: current.id, parentId: parent });
  }
  for (const u of updates) {
    await tx.ipBlock.update({ where: { id: u.id }, data: { parentId: u.parentId } });
  }
}

/** 校验 IP 段新增/编辑的字段，返回规范化数据。 */
export async function validateBlockInput(
  tx: Tx,
  input: BlockInput,
  id?: string,
): Promise<{ cidr: string; ipVersion: number; parentId: string | null }> {
  const parsed = parseCidr(input.cidr);
  if (!parsed) {
    throw new ApiError(422, `IP 段格式不正确，请使用 CIDR，如 192.168.1.0/24`, "INVALID_CIDR");
  }

  if (input.gateway) {
    const gw = parseIp(input.gateway);
    if (!gw) throw new ApiError(422, "网关地址格式不正确", "INVALID_GATEWAY");
    if (gw.version !== parsed.version || !ipInCidr(gw.canonical, parsed.canonical)) {
      throw new ApiError(422, "网关必须属于该网段且协议版本一致", "GATEWAY_OUT_OF_RANGE");
    }
  }

  if (id) {
    const existing = await tx.ipBlock.findUnique({
      where: { id },
      select: { id: true, cidr: true, _count: { select: { ipAddresses: true, children: true } } },
    });
    if (!existing) throw new ApiError(404, "IP 段不存在", "NOT_FOUND");
    if (input.status === "container" && existing._count.ipAddresses > 0) {
      throw new ApiError(409, "该网段下已有 IP 地址，不能设为容器状态", "CONTAINER_HAS_IPS");
    }
    if (existing.cidr !== parsed.canonical) {
      if (existing._count.children > 0) {
        throw new ApiError(409, "该网段下已有子网段，不能修改 CIDR", "BLOCK_HAS_CHILDREN");
      }
      const ips = await tx.ipAddress.findMany({ where: { blockId: id }, select: { address: true } });
      const outside = ips.filter((ip) => !ipInCidr(ip.address, parsed.canonical));
      if (outside.length > 0) {
        throw new ApiError(
          409,
          `新 CIDR 不包含已有 IP（如 ${outside[0].address}），请先调整 IP 归属`,
          "IPS_OUTSIDE_BLOCK",
        );
      }
    }
  }

  let parentId: string | null = null;

  // 显式指定父段时只做包含关系校验，最终父级由 recomputeBlockParents 计算。
  const rawParent = input.parentId;
  if (rawParent) {
    if (id && rawParent === id) {
      throw new ApiError(422, "不能将自身设置为父网段", "SELF_PARENT");
    }
    const parent = await tx.ipBlock.findUnique({
      where: { id: rawParent },
      select: { id: true, cidr: true },
    });
    if (!parent) throw new ApiError(422, "父网段不存在", "PARENT_NOT_FOUND");
    if (!cidrContainsCidr(parent.cidr, parsed.canonical) || parent.cidr === parsed.canonical) {
      throw new ApiError(422, `父网段 ${parent.cidr} 不包含 ${parsed.canonical}`, "PARENT_NOT_CONTAIN");
    }
    parentId = parent.id;
  }

  return { cidr: parsed.canonical, ipVersion: parsed.version, parentId };
}

export async function assertBlockDeletable(tx: Tx, id: string): Promise<void> {
  const block = await tx.ipBlock.findUnique({
    where: { id },
    select: {
      cidr: true,
      _count: { select: { children: true, ipAddresses: true } },
    },
  });
  if (!block) throw new ApiError(404, "IP 段不存在", "NOT_FOUND");
  const reasons: string[] = [];
  if (block._count.children > 0) reasons.push(`${block._count.children} 个子网段`);
  if (block._count.ipAddresses > 0) reasons.push(`${block._count.ipAddresses} 个 IP`);
  if (reasons.length > 0) {
    throw new ApiError(409, `IP 段 ${block.cidr} 下仍有 ${reasons.join("、")}，请先清理`, "IN_USE");
  }
}

export type BlockTreeNode = {
  id: string;
  cidr: string;
  status: string;
  role: string;
  parentId: string | null;
  supplierId: string | null;
  customerId: string | null;
  supplierName: string | null;
  customerName: string | null;
  directUsed: number;
  used: number;
  total: number | null;
  percent: number | null;
  children: BlockTreeNode[];
};

/** 构建 IP 段树，并聚合每个节点（含子段）的利用情况。 */
export async function buildBlockTree(tx: Tx): Promise<BlockTreeNode[]> {
  const [blocks, grouped] = await Promise.all([
    tx.ipBlock.findMany({
      orderBy: { cidr: "asc" },
      include: {
        supplier: { select: { name: true } },
        customer: { select: { name: true } },
      },
    }),
    tx.ipAddress.groupBy({ by: ["blockId"], _count: { _all: true } }),
  ]);
  const directCount = new Map<string, number>();
  for (const g of grouped) {
    if (g.blockId) directCount.set(g.blockId, g._count._all);
  }

  const nodes = new Map<string, BlockTreeNode>();
  for (const b of blocks) {
    const parsed = parseCidr(b.cidr);
    const direct = directCount.get(b.id) ?? 0;
    nodes.set(b.id, {
      id: b.id,
      cidr: b.cidr,
      status: b.status,
      role: b.role,
      parentId: b.parentId,
      supplierId: b.supplierId,
      customerId: b.customerId,
      supplierName: b.supplier?.name ?? null,
      customerName: b.customer?.name ?? null,
      directUsed: direct,
      used: direct,
      total: parsed ? usableCount(parsed.version, parsed.prefix) : null,
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

  const aggregate = (node: BlockTreeNode): { used: number; total: number | null } => {
    let used = node.directUsed;
    let total = node.total;
    if (node.children.length > 0) {
      let childTotal = 0;
      let childTotalKnown = true;
      for (const child of node.children) {
        const r = aggregate(child);
        used += r.used;
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
    node.used = used;
    node.total = total;
    node.percent = total && total > 0 ? Math.min(100, Math.round((used / total) * 1000) / 10) : 0;
    return { used, total };
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
 * 客户归属只由资源分配服务维护，这里不读取也不写入 customerId。
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
    status: string;
    supplierId: string | null;
  } | null = null;
  if (input.blockId) {
    block = await tx.ipBlock.findUnique({
      where: { id: input.blockId },
      select: { id: true, cidr: true, status: true, supplierId: true },
    });
    if (!block) throw new ApiError(422, "所选 IP 段不存在", "BLOCK_NOT_FOUND");
    if (block.status === "container") {
      throw new ApiError(422, "容器网段不能直接分配 IP，请选择具体子网段", "CONTAINER_BLOCK");
    }
    if (!ipInCidr(ip.canonical, block.cidr)) {
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
    select: { id: true, cidr: true, status: true, gateway: true, supplierId: true },
  });
  if (!block) throw new ApiError(404, "IP 段不存在", "NOT_FOUND");
  if (block.status === "container") {
    throw new ApiError(422, "容器网段不能生成 IP", "CONTAINER_BLOCK");
  }
  const parsed = parseCidr(block.cidr);
  if (!parsed || parsed.version !== 4) {
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
  const available = ipv4UsableCount(parsed.prefix) - exclude.size;
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
  return { created: ips.length, first: ips[0] ?? null, last: ips[ips.length - 1] ?? null };
}
