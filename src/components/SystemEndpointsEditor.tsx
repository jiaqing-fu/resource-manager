"use client";

import useSWR from "swr";
import { Button, Form, Input, InputNumber, Select, Space, Switch, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { PROTOCOLS } from "@/lib/enums";
import type { IpAddress, ListResult } from "@/lib/types";

export type EndpointFormValue = {
  ipAddressId?: string | null;
  ipText?: string;
  protocol: string;
  port?: number | null;
  isPrimary?: boolean;
  description?: string;
};

export function SystemEndpointsEditor({ path = [] }: { path?: Array<string | number> }) {
  const form = Form.useFormInstance();
  const { data } = useSWR<ListResult<IpAddress>>(
    "/api/ip-addresses?page=1&pageSize=200&sortBy=address&sortOrder=asc",
  );
  const ipOptions = (data?.items ?? []).map((ip) => ({
    value: ip.id,
    label: ip.address,
  }));
  const listName = [...path, "endpoints"];

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
                  <Form.Item name={[field.name, "ipAddressId"]} label="关联 IP 台账" style={{ width: 180 }}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      options={ipOptions}
                      placeholder="可留空"
                      onChange={(v: string | undefined) => {
                        if (v) form.setFieldValue([...prefix, "ipText"], "");
                      }}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, "ipText"]} label="或填写 IP 文本" style={{ width: 170 }}>
                    <Input
                      maxLength={100}
                      placeholder="二者至少填一项"
                      onChange={(e) => {
                        if (e.target.value) form.setFieldValue([...prefix, "ipAddressId"], null);
                      }}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, "protocol"]} label="协议" style={{ width: 100 }}>
                    <Select options={PROTOCOLS} />
                  </Form.Item>
                  <Form.Item name={[field.name, "port"]} label="端口" style={{ width: 110 }}>
                    <InputNumber min={1} max={65535} precision={0} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "isPrimary"]}
                    label="主端点"
                    valuePropName="checked"
                    style={{ width: 90 }}
                  >
                    <Switch />
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
                  <Input maxLength={500} />
                </Form.Item>
              </div>
            );
          })}
          <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ protocol: "tcp" })}>
            添加访问端点
          </Button>
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
            关联 IP 台账与填写 IP 文本至少填一项；关联台账时忽略 IP 文本。
          </Typography.Text>
        </div>
      )}
    </Form.List>
  );
}
