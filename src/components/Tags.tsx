"use client";

import { Tag } from "antd";
import { colorOf, labelOf, type Option } from "@/lib/enums";

export function EnumTag({ options, value }: { options: Option[]; value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className="rm-muted">—</span>;
  return <Tag color={colorOf(options, value)}>{labelOf(options, value)}</Tag>;
}

export function BoolTag({ value, trueText = "是", falseText = "否" }: { value: boolean; trueText?: string; falseText?: string }) {
  return <Tag color={value ? "green" : "default"}>{value ? trueText : falseText}</Tag>;
}

export function Maybe({ value }: { value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return <span className="rm-muted">—</span>;
  return <>{value}</>;
}
