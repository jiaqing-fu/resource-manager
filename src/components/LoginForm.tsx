"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Form, Input, Typography } from "antd";
import { ApartmentOutlined, LockOutlined, UserOutlined } from "@ant-design/icons";
import { apiFetch, errorMessage } from "@/lib/client";

type LoginValues = { username: string; password: string };

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: LoginValues) => {
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rm-login-wrap">
      <div className="rm-login-card">
        <div className="rm-login-brand">
          <span className="rm-logo-mark">
            <ApartmentOutlined />
          </span>
          <Typography.Title level={4} style={{ margin: 0 }}>
            技术部资源管理系统
          </Typography.Title>
        </div>
        <div className="rm-login-sub">IP、机柜、线路、设备、供应商与客户资源统一台账</div>

        {error ? (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
        ) : null}

        <Form<LoginValues> layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input
              size="large"
              prefix={<UserOutlined />}
              placeholder="请输入用户名"
              autoComplete="username"
              autoFocus
            />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password
              size="large"
              prefix={<LockOutlined />}
              placeholder="请输入密码"
              autoComplete="current-password"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            登录
          </Button>
        </Form>

        <div className="rm-muted" style={{ fontSize: 12, marginTop: 18, textAlign: "center" }}>
          内网系统 · 账号由管理员分配
        </div>
      </div>
    </div>
  );
}
