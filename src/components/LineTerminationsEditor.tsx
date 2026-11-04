"use client";

import { Button, Form, Input, Select, Space, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useOptions } from "@/components/OptionsProvider";
import { LINE_SIDES } from "@/lib/enums";

export type TerminationFormValue = {
  side: string;
  rackId?: string | null;
  deviceId?: string | null;
  port?: string | null;
  description?: string | null;
};

export function LineTerminationsEditor({ path = [] }: { path?: Array<string | number> }) {
  const form = Form.useFormInstance();
  const { data: options } = useOptions();
  const racks = options?.racks ?? [];
  const devices = options?.devices ?? [];
  const listName = [...path, "terminations"];

  return (
    <Form.List name={listName}>
      {(fields, { add, remove }) => (
        <div>
          {fields.map((field) => {
            const prefix = [...listName, field.name];
            return (
              <div
                key={field.key}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: "12px 12px 0",
                  marginBottom: 12,
                  background: "#fafafa",
                }}
              >
                <Space size={12} style={{ display: "flex" }} align="start" wrap>
                  <Form.Item
                    name={[field.name, "side"]}
                    label="端"
                    rules={[{ required: true, message: "请选择 A/Z 端" }]}
                    style={{ width: 90 }}
                  >
                    <Select options={LINE_SIDES} />
                  </Form.Item>
                  <Form.Item name={[field.name, "rackId"]} label="机柜" style={{ width: 210 }}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      options={racks.map((r) => ({
                        value: r.id,
                        label: `${r.location ? `${r.location} / ` : ""}${r.code} [${r.uStart}-${r.uEnd}]U`,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, "deviceId"]} label="设备" style={{ width: 180 }}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      options={devices.map((d) => ({
                        value: d.id,
                        label: d.name,
                        rackId: d.rackId,
                      }))}
                      onChange={(v: string | undefined) => {
                        const device = devices.find((d) => d.id === v);
                        if (!device) return;
                        form.setFieldValue(
                          [...prefix, "rackId"],
                          device.rackId ?? form.getFieldValue([...prefix, "rackId"]),
                        );
                      }}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, "port"]} label="端口" style={{ width: 130 }}>
                    <Input maxLength={100} placeholder="如 ether1" />
                  </Form.Item>
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    style={{ marginTop: 30 }}
                    onClick={() => remove(field.name)}
                  />
                </Space>
                <Form.Item name={[field.name, "description"]} label="端点说明">
                  <Input maxLength={200} />
                </Form.Item>
              </div>
            );
          })}
          {fields.length < 2 ? (
            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={() => {
                const current = (form.getFieldValue(listName) ?? []) as TerminationFormValue[];
                add({ side: current.some((t) => t?.side === "A") ? "Z" : "A" });
              }}
            >
              添加端点
            </Button>
          ) : (
            <Typography.Text type="secondary">
              每条线路最多一个 A 端和一个 Z 端；机柜与设备需归属一致。
            </Typography.Text>
          )}
        </div>
      )}
    </Form.List>
  );
}
