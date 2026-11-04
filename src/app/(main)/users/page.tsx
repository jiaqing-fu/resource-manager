"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { CrudDrawer } from "@/components/CrudDrawer";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { BatchEntryList } from "@/components/batch/BatchEntryList";
import { submitBatch } from "@/components/batch/submitBatch";
import { useSessionUser } from "@/components/SessionContext";
import { useInitialParams } from "@/components/useInitialParams";
import { apiFetch, buildQuery, errorMessage } from "@/lib/client";
import { USER_ROLES, colorOf, labelOf } from "@/lib/enums";
import { formatDateTime } from "@/lib/dates";
import type { ListResult, User } from "@/lib/types";

type UserForm = {
  username?: string;
  password?: string;
  displayName?: string;
  role: string;
  active: boolean;
};

const defaults = (): UserForm => ({ role: "USER", active: true });

export default function UsersPage() {
  const me = useSessionUser();
  const isAdmin = me.role === "ADMIN";
  const router = useRouter();
  const { message } = App.useApp();
  const initial = useInitialParams("keyword");

  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, error, isLoading, mutate } = useSWR<ListResult<User>>(
    isAdmin ? `/api/users${buildQuery({ keyword, page, pageSize })}` : null,
  );

  const [form] = Form.useForm<{ items: UserForm[] }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ items: [defaults()] });
    setDrawerOpen(true);
  };

  const openEdit = (row: User) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      items: [
        {
          username: row.username,
          displayName: row.displayName,
          role: row.role,
          active: row.active,
          password: "",
        },
      ],
    });
    setDrawerOpen(true);
  };

  const submit = async () => {
    let values: { items: UserForm[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const items = values.items ?? [];
    setSaving(true);
    try {
      if (editing) {
        const item = items[0];
        const payload: Record<string, unknown> = {
          displayName: item.displayName?.trim(),
          role: item.role,
          active: Boolean(item.active),
        };
        if (item.password) payload.password = item.password;
        await apiFetch(`/api/users/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        message.success("用户已更新");
      } else {
        const result = await submitBatch(items, async (item) => {
          await apiFetch("/api/users", {
            method: "POST",
            body: JSON.stringify({
              username: item.username?.trim(),
              password: item.password,
              displayName: item.displayName?.trim(),
              role: item.role,
            }),
          });
        });
        if (result.ok) {
          message.success(`已新增 ${result.count} 个用户`);
        } else {
          message.warning(
            `已成功 ${result.successCount} 条，第 ${result.failedIndex + 1} 条失败：${errorMessage(
              result.error,
            )}`,
          );
        }
      }
      setDrawerOpen(false);
      await mutate();
      router.refresh();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: User) => {
    try {
      await apiFetch(`/api/users/${row.id}`, { method: "DELETE" });
      message.success("用户已删除");
      await mutate();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="用户管理" />
        <Alert type="warning" showIcon message="仅管理员可以访问用户管理。" />
      </div>
    );
  }

  const columns: ColumnsType<User> = [
    { title: "用户名", dataIndex: "username", width: 180, className: "rm-mono" },
    { title: "姓名", dataIndex: "displayName", width: 160 },
    {
      title: "角色",
      dataIndex: "role",
      width: 120,
      render: (v: string) => <Tag color={colorOf(USER_ROLES, v)}>{labelOf(USER_ROLES, v)}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "active",
      width: 100,
      render: (v: boolean) => (
        <Tag color={v ? "green" : "default"}>{v ? "启用" : "停用"}</Tag>
      ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: "操作",
      width: 160,
      fixed: "right",
      render: (_v, row) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          {row.id === me.id ? null : (
            <Popconfirm
              title="确认删除该用户？"
              description="删除后该用户立即无法登录。"
              onConfirm={() => void remove(row)}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="用户管理"
        description="管理员可维护账号、角色与启停状态；系统始终保留至少一个启用的管理员，停用或改密会立即失效旧会话。"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增用户
          </Button>
        }
      />

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            placeholder="搜索用户名 / 姓名"
            style={{ width: 240 }}
            onSearch={(v) => {
              setKeyword(v);
              setPage(1);
            }}
          />
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
          刷新
        </Button>
      </div>

      <Table<User>
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data?.items ?? []}
        columns={columns}
        scroll={{ x: 900 }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        locale={{ emptyText: error ? errorMessage(error) : "暂无用户" }}
      />

      <CrudDrawer
        open={drawerOpen}
        title={editing ? `编辑用户：${editing.username}` : "批量新增用户"}
        onClose={() => setDrawerOpen(false)}
        onSave={() => void submit()}
        saving={saving}
        width={560}
      >
        <Form<{ items: UserForm[] }> form={form} layout="vertical" requiredMark>
          <BatchEntryList
            form={form}
            batch={!editing}
            defaultItem={defaults()}
            renderItem={(field) => (
              <>
                <Form.Item
                  name={[field.name, "username"]}
                  label="用户名"
                  rules={[
                    { required: true, message: "请输入用户名" },
                    { pattern: /^[a-zA-Z0-9_.-]+$/, message: "只能包含字母、数字、下划线、点和短横线" },
                    { min: 3, message: "至少 3 个字符" },
                  ]}
                >
                  <Input disabled={Boolean(editing)} maxLength={50} />
                </Form.Item>
                <Form.Item
                  name={[field.name, "displayName"]}
                  label="姓名"
                  rules={[{ required: true, message: "请输入姓名" }]}
                >
                  <Input maxLength={50} />
                </Form.Item>
                <Form.Item
                  name={[field.name, "password"]}
                  label={editing ? "重置密码（留空不修改）" : "初始密码"}
                  rules={[
                    { required: !editing, message: "请输入密码" },
                    { min: 8, message: "密码至少 8 个字符" },
                  ]}
                >
                  <Input.Password autoComplete="new-password" maxLength={72} />
                </Form.Item>
                <Form.Item name={[field.name, "role"]} label="角色">
                  <Select options={USER_ROLES} />
                </Form.Item>
                {editing ? (
                  <Form.Item name={[field.name, "active"]} label="启用账号" valuePropName="checked">
                    <Switch disabled={editing.id === me.id} />
                  </Form.Item>
                ) : null}
              </>
            )}
          />
        </Form>
      </CrudDrawer>
    </div>
  );
}
