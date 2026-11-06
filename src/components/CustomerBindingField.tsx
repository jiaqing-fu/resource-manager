"use client";

import type { SelectProps } from "antd";
import { PartySelect } from "@/components/PartySelect";
import { useOptions } from "@/components/OptionsProvider";

/**
 * 资源新增时的可选客户绑定。客户变更或释放仍通过「资源分配」处理。
 *
 * 必须透传 Form.Item 注入的 value/onChange，否则选择结果不会写回表单。
 */
export function CustomerBindingField({
  placeholder = "留空则不绑定客户",
  ...rest
}: Omit<SelectProps<string>, "options"> & {
  placeholder?: string;
}) {
  const { data: options } = useOptions();
  return (
    <PartySelect
      kind="customer"
      parties={options?.customers}
      placeholder={placeholder}
      {...rest}
    />
  );
}
