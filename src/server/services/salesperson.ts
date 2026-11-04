import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";

type Tx = Prisma.TransactionClient;

/** 业务员姓名全局唯一。 */
export async function assertSalespersonNameUnique(
  tx: Tx,
  name: string,
  excludeId?: string,
): Promise<void> {
  const count = await tx.salesperson.count({
    where: { name, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (count > 0) {
    throw new ApiError(409, `业务员姓名「${name}」已存在`, "DUPLICATE_SALESPERSON_NAME");
  }
}

/** 客户绑定前确认业务员仍然存在。 */
export async function assertSalespersonExists(tx: Tx, id: string): Promise<void> {
  const count = await tx.salesperson.count({ where: { id } });
  if (count === 0) {
    throw new ApiError(422, "所选业务员不存在", "SALESPERSON_NOT_FOUND");
  }
}

/** 仍有客户绑定时禁止删除业务员。 */
export async function assertSalespersonUnbound(tx: Tx, id: string): Promise<void> {
  const count = await tx.customer.count({ where: { salespersonId: id } });
  if (count > 0) {
    throw new ApiError(
      409,
      `该业务员仍绑定 ${count} 个客户，请先在客户管理中解除绑定`,
      "SALESPERSON_IN_USE",
    );
  }
}
