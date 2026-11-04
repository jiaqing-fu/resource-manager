"use client";

import { Select } from "antd";
import type { SelectProps } from "antd";
import type { OptionsData } from "@/lib/types";

type Party = OptionsData["suppliers"][number];

export function partyOptions(
  parties: Party[] | undefined,
  showLevel = true,
): Array<{ value: string; label: string }> {
  if (!parties) return [];
  const byId = new Map(parties.map((p) => [p.id, p]));
  return parties.map((p) => {
    const parent = p.parentId ? byId.get(p.parentId) : null;
    const path = p.level === 2 ? `${parent?.name ?? "未知一级"} / ${p.name}` : p.name;
    const label = showLevel ? `${p.level === 1 ? "一级" : "二级"} · ${path}` : path;
    return { value: p.id, label };
  });
}

export function PartySelect({
  kind,
  parties,
  placeholder,
  ...rest
}: {
  kind: "supplier" | "customer";
  parties: Party[] | undefined;
  placeholder?: string;
} & Omit<SelectProps<string>, "options" | "placeholder">) {
  return (
    <Select
      showSearch
      allowClear
      optionFilterProp="label"
      placeholder={placeholder ?? (kind === "supplier" ? "选择供应商" : "选择客户")}
      options={partyOptions(parties)}
      {...rest}
    />
  );
}
