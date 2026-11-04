import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";

type Tx = Prisma.TransactionClient;

/**
 * 创建资源时解析最终供应商：显式值优先，其次按继承顺序取第一个非空值。
 * 资源创建必须关联供应商，继承后仍为空则拒绝。
 */
export async function resolveSupplierForCreate(
  tx: Tx,
  explicitId: string | null | undefined,
  inheritedIds: Array<string | null | undefined> = [],
): Promise<string> {
  const candidate =
    explicitId ?? inheritedIds.find((id): id is string => Boolean(id)) ?? null;
  if (!candidate) {
    throw new ApiError(422, "请关联供应商（资源创建必须关联供应商）", "SUPPLIER_REQUIRED");
  }
  const supplier = await tx.supplier.findUnique({
    where: { id: candidate },
    select: { id: true },
  });
  if (!supplier) {
    throw new ApiError(422, "所选供应商不存在", "SUPPLIER_NOT_FOUND");
  }
  return candidate;
}

/**
 * 编辑资源时的供应商规则：
 * - 不传表示保留原值；
 * - 已关联的供应商不能清空；
 * - 历史空值允许继续为空；
 * - 传新值需存在。
 */
export async function resolveSupplierForUpdate(
  tx: Tx,
  existingId: string | null,
  incomingId: string | null | undefined,
): Promise<string | null> {
  if (incomingId === undefined) return existingId;
  if (incomingId === null) {
    if (existingId) {
      throw new ApiError(422, "已关联的供应商不能清空", "SUPPLIER_CANNOT_CLEAR");
    }
    return null;
  }
  const supplier = await tx.supplier.findUnique({
    where: { id: incomingId },
    select: { id: true },
  });
  if (!supplier) throw new ApiError(422, "所选供应商不存在", "SUPPLIER_NOT_FOUND");
  return incomingId;
}

/** 关联对象（VLAN/机柜/网段）与资源供应商不一致时拒绝。 */
export function assertSupplierConsistent(
  supplierId: string | null,
  relatedSupplierId: string | null,
  relatedLabel: string,
): void {
  if (supplierId && relatedSupplierId && supplierId !== relatedSupplierId) {
    throw new ApiError(
      422,
      `供应商与所关联的${relatedLabel}供应商不一致`,
      "SUPPLIER_MISMATCH",
    );
  }
}
