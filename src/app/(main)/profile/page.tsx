"use client";

import { useState } from "react";
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Row,
  Tag,
  Typography,
} from "antd";
import { LockOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { useSessionUser } from "@/components/SessionContext";
import { apiFetch, errorMessage } from "@/lib/client";
import { USER_ROLES, colorOf, labelOf } from "@/lib/enums";

type PasswordForm = {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export default function ProfilePage() {
  const user = useSessionUser();
  const { message } = App.useApp();
  const [form] = Form.useForm<PasswordForm>();
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    let values: PasswordForm;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          oldPassword: values.oldPassword,
          newPassword: values.newPassword,
        }),
      });
      message.success("密码已修改，其他设备上的旧会话已失效");
      form.resetFields();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="账号设置" description="查看当前账号信息并修改登录密码。" />

      <Row gutter={16}>
        <Col xs={24} lg={10}>
          <Card title="账号信息" size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="用户名">
                <span className="rm-mono">{user.username}</span>
              </Descriptions.Item>
              <Descriptions.Item label="姓名">{user.displayName}</Descriptions.Item>
              <Descriptions.Item label="角色">
                <Tag color={colorOf(USER_ROLES, user.role)}>{labelOf(USER_ROLES, user.role)}</Tag>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card
            title={
              <span>
                <LockOutlined /> 修改密码
              </span>
            }
            size="small"
          >
            <Form<PasswordForm> form={form} layout="vertical" requiredMark>
              <Form.Item
                name="oldPassword"
                label="原密码"
                rules={[{ required: true, message: "请输入原密码" }]}
              >
                <Input.Password autoComplete="current-password" maxLength={72} />
              </Form.Item>
              <Form.Item
                name="newPassword"
                label="新密码"
                rules={[
                  { required: true, message: "请输入新密码" },
                  { min: 8, message: "新密码至少 8 个字符" },
                ]}
              >
                <Input.Password autoComplete="new-password" maxLength={72} />
              </Form.Item>
              <Form.Item
                name="confirmPassword"
                label="确认新密码"
                dependencies={["newPassword"]}
                rules={[
                  { required: true, message: "请再次输入新密码" },
                  ({ getFieldValue }) => ({
                    validator(_rule, value) {
                      if (!value || getFieldValue("newPassword") === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error("两次输入的新密码不一致"));
                    },
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" maxLength={72} />
              </Form.Item>
              <Typography.Paragraph type="secondary">
                修改成功后，当前浏览器会自动更新会话；其他设备上的旧登录会话将失效。
              </Typography.Paragraph>
              <Button type="primary" loading={saving} onClick={() => void submit()}>
                保存新密码
              </Button>
            </Form>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
