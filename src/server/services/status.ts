import { todayStr } from "@/lib/dates";

export type TestDisplayStatus = "testing" | "passed" | "failed" | "expired";

export type TestRow = {
  status: string | null;
  converted: boolean;
  endAt: string;
};

/**
 * 客户测试展示状态：
 * 1. 手动未通过 → 测试未通过
 * 2. 转正或手动通过 → 测试通过
 * 3. 已过结束日期且未通过/未转正 → 测试到期
 * 4. 未到期且无结果 → 测试中（不落库）
 */
export function computeTestStatus(test: TestRow, today: string = todayStr()): TestDisplayStatus {
  if (test.status === "failed") return "failed";
  if (test.status === "passed" || test.converted) return "passed";
  if (test.endAt < today) return "expired";
  return "testing";
}

/** 按展示状态构造 Prisma 查询条件。 */
export function testStatusWhere(status: string, today: string = todayStr()) {
  switch (status) {
    case "passed":
      return { OR: [{ status: "passed" }, { converted: true }] };
    case "failed":
      return { status: "failed" };
    case "expired":
      return { status: null, converted: false, endAt: { lt: today } };
    case "testing":
      return { status: null, converted: false, endAt: { gte: today } };
    default:
      return {};
  }
}
