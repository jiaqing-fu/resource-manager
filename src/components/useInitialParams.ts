"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

/** 读取地址栏筛选参数；同一页面内 router.push 后也会更新。 */
export function useInitialParams(keys: string): Record<string, string> {
  const searchParams = useSearchParams();
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of keys.split(",")) {
      const trimmed = key.trim();
      const value = searchParams.get(trimmed);
      if (value) out[trimmed] = value;
    }
    return out;
  }, [keys, searchParams]);
}
