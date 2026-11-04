import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";

type Tx = Prisma.TransactionClient;

export type PartyKind = "supplier" | "customer";

type PartyRow = { id: string; level: number; parentId: string | null };

interface PartyDelegate {
  findUnique(args: {
    where: { id: string };
    select: { id: true; level: true; parentId: true; children?: { select: { id: true } } };
  }): Promise<(PartyRow & { children?: { id: string }[] }) | null>;
}

function delegate(tx: Tx, kind: PartyKind): PartyDelegate {
  return (kind === "supplier" ? tx.supplier : tx.customer) as unknown as PartyDelegate;
}

/**
 * 校验并规范化供应商/客户的两级层级：
 * - 一级不能有上级；
 * - 二级必须有上级，且上级必须是一级；
 * - 已有下级的记录不能改为二级；
 * - 不允许自指。
 */
export async function validatePartyHierarchy(
  tx: Tx,
  kind: PartyKind,
  input: { id?: string; level: number; parentId?: string | null },
): Promise<{ level: number; parentId: string | null }> {
  const label = kind === "supplier" ? "供应商" : "客户";
  if (input.level !== 1 && input.level !== 2) {
    throw new ApiError(422, `${label}层级只能是一级或二级`, "INVALID_LEVEL");
  }

  if (input.level === 1) {
    return { level: 1, parentId: null };
  }

  if (input.id) {
    const existing = await delegate(tx, kind).findUnique({
      where: { id: input.id },
      select: { id: true, level: true, parentId: true, children: { select: { id: true } } },
    });
    if (existing && existing.level === 1 && (existing.children?.length ?? 0) > 0) {
      throw new ApiError(
        409,
        `该${label}下仍有二级记录，不能改为二级`,
        "HAS_CHILDREN",
      );
    }
  }

  if (!input.parentId) {
    throw new ApiError(422, `二级${label}必须选择上级一级${label}`, "PARENT_REQUIRED");
  }
  if (input.id && input.parentId === input.id) {
    throw new ApiError(422, `不能将自身设置为上级`, "SELF_PARENT");
  }
  const parent = await delegate(tx, kind).findUnique({
    where: { id: input.parentId },
    select: { id: true, level: true, parentId: true },
  });
  if (!parent) {
    throw new ApiError(422, `上级${label}不存在`, "PARENT_NOT_FOUND");
  }
  if (parent.level !== 1) {
    throw new ApiError(422, `二级${label}的上级必须是一级${label}，不能挂到二级下`, "PARENT_NOT_LEVEL1");
  }
  return { level: 2, parentId: parent.id };
}

/** 删除前检查引用关系，给出明确的中文原因。 */
export async function assertPartyDeletable(
  tx: Tx,
  kind: PartyKind,
  id: string,
): Promise<void> {
  const label = kind === "supplier" ? "供应商" : "客户";
  if (kind === "supplier") {
    const row = await tx.supplier.findUnique({
      where: { id },
      select: {
        name: true,
        _count: {
          select: {
            children: true,
            ipBlocks: true,
            ipAddresses: true,
            racks: true,
            vlans: true,
            vxlans: true,
            broadbands: true,
            devices: true,
            lines: true,
          },
        },
      },
    });
    if (!row) throw new ApiError(404, "供应商不存在", "NOT_FOUND");
    const c = row._count;
    const reasons: string[] = [];
    if (c.children > 0) reasons.push(`${c.children} 个二级供应商`);
    if (c.ipBlocks > 0) reasons.push(`${c.ipBlocks} 个 IP 段`);
    if (c.ipAddresses > 0) reasons.push(`${c.ipAddresses} 个 IP`);
    if (c.racks > 0) reasons.push(`${c.racks} 个机柜`);
    if (c.vlans > 0) reasons.push(`${c.vlans} 个 VLAN`);
    if (c.vxlans > 0) reasons.push(`${c.vxlans} 个 VXLAN`);
    if (c.broadbands > 0) reasons.push(`${c.broadbands} 条宽带`);
    if (c.devices > 0) reasons.push(`${c.devices} 台设备`);
    if (c.lines > 0) reasons.push(`${c.lines} 条线路`);
    if (reasons.length > 0) {
      throw new ApiError(
        409,
        `${label}「${row.name}」仍关联 ${reasons.join("、")}，请先解除关联`,
        "IN_USE",
      );
    }
    return;
  }

  const row = await tx.customer.findUnique({
    where: { id },
    select: {
      name: true,
      _count: {
        select: {
          children: true,
          ipBlocks: true,
          ipAddresses: true,
          racks: true,
          vlans: true,
          vxlans: true,
          broadbands: true,
          devices: true,
          lines: true,
          customerTests: true,
          allocations: true,
        },
      },
    },
  });
  if (!row) throw new ApiError(404, "客户不存在", "NOT_FOUND");
  const c = row._count;
  const reasons: string[] = [];
  if (c.children > 0) reasons.push(`${c.children} 个二级客户`);
  if (c.ipBlocks > 0) reasons.push(`${c.ipBlocks} 个 IP 段`);
  if (c.ipAddresses > 0) reasons.push(`${c.ipAddresses} 个 IP`);
  if (c.racks > 0) reasons.push(`${c.racks} 个机柜`);
  if (c.vlans > 0) reasons.push(`${c.vlans} 个 VLAN`);
  if (c.vxlans > 0) reasons.push(`${c.vxlans} 个 VXLAN`);
  if (c.broadbands > 0) reasons.push(`${c.broadbands} 条宽带`);
  if (c.devices > 0) reasons.push(`${c.devices} 台设备`);
  if (c.lines > 0) reasons.push(`${c.lines} 条线路`);
  if (c.allocations > 0) reasons.push(`${c.allocations} 条资源分配记录`);
  if (c.customerTests > 0) reasons.push(`${c.customerTests} 条测试记录`);
  if (reasons.length > 0) {
    throw new ApiError(
      409,
      `${label}「${row.name}」仍关联 ${reasons.join("、")}，请先解除关联`,
      "IN_USE",
    );
  }
}
