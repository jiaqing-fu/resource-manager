import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";
import {
  assertSupplierConsistent,
  resolveSupplierForCreate,
  resolveSupplierForUpdate,
} from "@/server/services/supplier-requirements";

type Tx = Prisma.TransactionClient;

export async function assertVniAvailable(
  tx: Tx,
  vni: number,
  excludeId?: string,
): Promise<void> {
  const dup = await tx.vxlan.findUnique({ where: { vni }, select: { id: true } });
  if (dup && dup.id !== excludeId) {
    throw new ApiError(409, `VXLAN VNI ${vni} 已存在`, "DUPLICATE_VXLAN_VNI");
  }
}

export type VlanRef = { id: string; vid: number; name: string; supplierId: string | null };

export async function resolveVxlanVlan(
  tx: Tx,
  vlanId: string | null | undefined,
  excludeVxlanId?: string,
): Promise<VlanRef | null> {
  if (!vlanId) return null;
  const vlan = await tx.vlan.findUnique({
    where: { id: vlanId },
    select: { id: true, vid: true, name: true, supplierId: true },
  });
  if (!vlan) throw new ApiError(422, "所选 VLAN 不存在", "VLAN_NOT_FOUND");
  const owner = await tx.vxlan.findUnique({
    where: { vlanId },
    select: { id: true, vni: true },
  });
  if (owner && owner.id !== excludeVxlanId) {
    throw new ApiError(
      409,
      `VLAN ${vlan.vid} 已关联 VXLAN ${owner.vni}，一个 VLAN 最多关联一个 VXLAN`,
      "VLAN_ALREADY_HAS_VXLAN",
    );
  }
  return vlan;
}

/** 创建 VXLAN：供应商显式优先，否则继承 VLAN。 */
export async function resolveSupplierForVxlanCreate(
  tx: Tx,
  explicitId: string | null | undefined,
  vlan: VlanRef | null,
): Promise<string> {
  const supplierId = await resolveSupplierForCreate(tx, explicitId, [vlan?.supplierId]);
  assertSupplierConsistent(supplierId, vlan?.supplierId ?? null, " VLAN ");
  return supplierId;
}

/** 编辑 VXLAN：保留历史空值，已关联供应商不可清空。 */
export async function resolveSupplierForVxlanUpdate(
  tx: Tx,
  existingSupplierId: string | null,
  incomingId: string | null | undefined,
  vlan: VlanRef | null,
): Promise<string | null> {
  const supplierId = await resolveSupplierForUpdate(tx, existingSupplierId, incomingId);
  assertSupplierConsistent(supplierId, vlan?.supplierId ?? null, " VLAN ");
  return supplierId;
}
