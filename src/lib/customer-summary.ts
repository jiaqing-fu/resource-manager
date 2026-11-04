/** 机柜 / 宽带等可被多个客户共享的资源，客户列按有效分配动态汇总。 */
export type AllocationCustomerRow = {
  customerId: string;
  customer?: { name: string } | null;
};

export type CustomerSummary = {
  customerSummary: string | null;
  customerNames: string[];
};

export function summarizeAllocationCustomers(
  rows: AllocationCustomerRow[],
): CustomerSummary {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.customerId)) continue;
    seen.add(row.customerId);
    if (row.customer?.name) names.push(row.customer.name);
  }
  return {
    customerSummary:
      names.length === 0
        ? null
        : names.length === 1
          ? names[0]
          : `${names.length} 个客户`,
    customerNames: names,
  };
}
