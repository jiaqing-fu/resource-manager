"use client";

import { Button, Form, Input, Space, Switch, Typography } from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";

/** 供应商联系人可编辑列表；path 支持批量表单中的 items[].contacts。 */
export function SupplierContactsEditor({
  path = [],
  title = "联系方式",
}: {
  path?: Array<string | number>;
  title?: string;
}) {
  return (
    <>
      <Typography.Title level={5}>{title}</Typography.Title>
      <Form.List name={[...path, "contacts"]}>
        {(fields, { add, remove }) => (
          <>
            {fields.map((field) => (
              <div
                key={field.key}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: "12px 12px 0",
                  marginBottom: 10,
                }}
              >
                <Space size={8} style={{ display: "flex" }} align="start">
                  <Form.Item
                    name={[field.name, "name"]}
                    label="姓名"
                    rules={[{ required: true, message: "请输入姓名" }]}
                    style={{ flex: 1 }}
                  >
                    <Input maxLength={50} />
                  </Form.Item>
                  <Form.Item name={[field.name, "role"]} label="职务" style={{ flex: 1 }}>
                    <Input maxLength={50} />
                  </Form.Item>
                  <Form.Item name={[field.name, "phone"]} label="电话" style={{ flex: 1 }}>
                    <Input maxLength={50} />
                  </Form.Item>
                  <Form.Item name={[field.name, "isPrimary"]} label="主要" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Button
                    type="text"
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={() => remove(field.name)}
                    style={{ marginTop: 30 }}
                  />
                </Space>
                <Space size={8} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "email"]} label="邮箱" style={{ flex: 1 }}>
                    <Input maxLength={100} />
                  </Form.Item>
                  <Form.Item name={[field.name, "wechat"]} label="微信" style={{ flex: 1 }}>
                    <Input maxLength={50} />
                  </Form.Item>
                  <Form.Item name={[field.name, "notes"]} label="备注" style={{ flex: 1 }}>
                    <Input maxLength={500} />
                  </Form.Item>
                </Space>
              </div>
            ))}
            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={() => add({ isPrimary: fields.length === 0 })}
            >
              添加联系方式
            </Button>
          </>
        )}
      </Form.List>
    </>
  );
}
