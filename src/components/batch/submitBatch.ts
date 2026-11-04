export type BatchSubmitResult =
  | { ok: true; count: number }
  | { ok: false; successCount: number; failedIndex: number; error: unknown };

/** 逐条提交；某条失败即停止，返回已成功条数与失败序号。 */
export async function submitBatch<T>(
  items: T[],
  saveOne: (item: T, index: number) => Promise<void>,
): Promise<BatchSubmitResult> {
  let successCount = 0;
  for (let index = 0; index < items.length; index += 1) {
    try {
      await saveOne(items[index], index);
      successCount += 1;
    } catch (error) {
      return { ok: false, successCount, failedIndex: index, error };
    }
  }
  return { ok: true, count: successCount };
}
