"use client";

import useSWR from "swr";
import type { OptionsData } from "@/lib/types";

export function useOptions() {
  const { data, error, isLoading, mutate } = useSWR<OptionsData>("/api/options");
  return {
    data,
    options: data,
    error,
    isLoading,
    mutate,
  };
}
