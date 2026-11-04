"use client";

import { Button, Card, Form, Space } from "antd";
import type { FormInstance } from "antd";
import type { FormListFieldData } from "antd/es/form/FormList";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { cloneFormValue } from "./cloneFormValue";

/**
 * 批量表单卡片列表：每条右上角「新增 / 删除」。
 * 新增复制当前条全部字段并插入到其后；最后一条不可删除。
 * 编辑模式（batch=false）只渲染一条且不显示按钮。
 */
export function BatchEntryList({
  form,
  batch,
  renderItem,
  defaultItem,
}: {
  form: FormInstance;
  batch: boolean;
  renderItem: (field: FormListFieldData, index: number) => React.ReactNode;
  defaultItem?: Record<string, unknown>;
}) {
  return (
    <Form.List name="items">
      {(fields, { add, remove }) => (
        <div className="rm-batch-list">
          {fields.map((field, index) => (
            <Card
              key={field.key}
              size="small"
              className="rm-batch-card"
              title={`第 ${index + 1} 条`}
              extra={
                batch ? (
                  <Space size={4}>
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        const items = (form.getFieldValue("items") ?? []) as unknown[];
                        add(cloneFormValue(items[index] ?? defaultItem ?? {}), index + 1);
                      }}
                    >
                      新增
                    </Button>
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      disabled={fields.length <= 1}
                      onClick={() => remove(field.name)}
                    >
                      删除
                    </Button>
                  </Space>
                ) : null
              }
            >
              {renderItem(field, index)}
            </Card>
          ))}
        </div>
      )}
    </Form.List>
  );
}
