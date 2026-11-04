"use client";

import { Fragment } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Remounts the page subtree whenever the query string changes, so pages can
 * initialize filter state from `useSearchParams` without sync effects.
 */
export function SearchParamsKey({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  return <Fragment key={params.toString()}>{children}</Fragment>;
}
