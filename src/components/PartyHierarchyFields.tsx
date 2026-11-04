"use client";

import { Form, Select } from "antd";
import { PARTY_LEVELS } from "@/lib/enums";
import { useOptions } from "@/components/OptionsProvider";

/**
 * 供应商/客户的两级字段：层级 + 上级。
 * 二级必须选择一级；切回一级时自动清空上级。
 */
export function PartyHierarchyFields({
  kind,
  path = [],
  watchPath = path,
  levelName = "level",
  parentName = "parentId",
}: {
  kind: "supplier" | "customer";
  /** Form.Item 使用的路径（位于 Form.List 内时传相对路径）。 */
  path?: Array<string | number>;
  /** useWatch / setFieldValue 使用的完整路径，必须包含 Form.List 的名称。 */
  watchPath?: Array<string | number>;
  levelName?: string;
  parentName?: string;
}) {
  const form = Form.useFormInstance();
  const namePath = [...path, levelName];
  const parentPath = [...path, parentName];
  const level = Form.useWatch([...watchPath, levelName], form);
  const { data } = useOptions();
  const label = kind === "supplier" ? "供应商" : "客户";
  const level1 = (kind === "supplier" ? data?.suppliers : data?.customers)?.filter(
    (p) => p.level === 1,
  );

  return (
    <>
      <Form.Item
        name={namePath}
        label="层级"
        rules={[{ required: true, message: `请选择${label}层级` }]}
      >
        <Select
          options={PARTY_LEVELS.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(value) => {
            if (value !== "2") {
              form.setFieldValue([...watchPath, parentName], null);
            }
          }}
        />
      </Form.Item>
      {String(level ?? "") === "2" ? (
        <Form.Item
          name={parentPath}
          label="上级名称"
          rules={[{ required: true, message: `二级${label}必须选择一级${label}` }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder={`选择一级${label}`}
            options={(level1 ?? []).map((p) => ({ value: p.id, label: p.name }))}
          />
        </Form.Item>
      ) : null}
    </>
  );
}
