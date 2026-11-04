"use client";

import { Button, Drawer, Space } from "antd";

export function CrudDrawer({
  open,
  title,
  width = 680,
  onClose,
  onSave,
  saving = false,
  children,
  extra,
}: {
  open: boolean;
  title: React.ReactNode;
  width?: number;
  onClose: () => void;
  onSave: () => void;
  saving?: boolean;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <Drawer
      open={open}
      title={title}
      width={width}
      onClose={onClose}
      destroyOnHidden
      maskClosable={false}
      extra={extra}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} onClick={onSave}>
              保存
            </Button>
          </Space>
        </div>
      }
    >
      {children}
    </Drawer>
  );
}
