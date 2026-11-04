"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  App,
  Button,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
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
import { ImportExport } from "@/components/ImportExport";
import { Maybe } from "@/components/Tags";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { BatchEntryList } from "@/components/batch/BatchEntryList";
import { submitBatch } from "@/components/batch/submitBatch";
import { useOptions } from "@/components/OptionsProvider";
import { useSessionUser } from "@/components/SessionContext";
import { useInitialParams } from "@/components/useInitialParams";
import { apiFetch, buildQuery, errorMessage } from "@/lib/client";
import { PARTY_STATUS, labelOf } from "@/lib/enums";
import { formatDateTime } from "@/lib/dates";
import type { ListResult, Salesperson } from "@/lib/types";

type SalespersonForm = {
  name?: string;
  phone?: string;
  status: string;
  notes?: string;
};

const defaults = (): SalespersonForm => ({ status: "active" });

export default function SalespersonsPage() {
  const user = useSessionUser();
  const isAdmin = user.role === "ADMIN";
  const { message } = App.useApp();
  const { mutate: mutateOptions } = useOptions();
  const initial = useInitialParams("keyword");

  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [status, setStatus] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const filters = { keyword, status, page, pageSize };
  const { data, error, isLoading, mutate } = useSWR<ListResult<Salesperson>>(
    `/api/salespersons${buildQuery(filters)}`,
  );
  const exportQuery = buildQuery({ keyword, status });

  const [form] = Form.useForm<{ items: SalespersonForm[] }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Salesperson | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ items: [defaults()] });
    setDrawerOpen(true);
  };

  const openEdit = (row: Salesperson) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      items: [
        {
          name: row.name,
          phone: row.phone ?? undefined,
          status: row.status,
          notes: row.notes ?? undefined,
        },
      ],
    });
    setDrawerOpen(true);
  };

  const toPayload = (values: SalespersonForm) => ({
    name: values.name?.trim(),
    phone: values.phone?.trim() || null,
    status: values.status,
    notes: values.notes?.trim() || null,
  });

  const submit = async () => {
    let values: { items: SalespersonForm[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const items = values.items ?? [];
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/salespersons/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(items[0])),
        });
        message.success("业务员已更新");
      } else {
        const result = await submitBatch(items, async (item) => {
          await apiFetch("/api/salespersons", {
            method: "POST",
            body: JSON.stringify(toPayload(item)),
          });
        });
        if (result.ok) {
          message.success(`已新增 ${result.count} 个业务员`);
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
      await mutateOptions();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: Salesperson) => {
    try {
      await apiFetch(`/api/salespersons/${row.id}`, { method: "DELETE" });
      message.success("业务员已删除");
      await mutate();
      await mutateOptions();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const columns: ColumnsType<Salesperson> = [
    { title: "姓名", dataIndex: "name" },
    { title: "电话", dataIndex: "phone", width: 150, render: (v) => <Maybe value={v} /> },
    {
      title: "关联客户",
      width: 100,
      render: (_v, row) => (
        <Link href={`/customers?salespersonId=${row.id}`}>
          {row._count?.customers ?? 0} 个
        </Link>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v: string) => (
        <Tag color={v === "active" ? "green" : "default"}>{labelOf(PARTY_STATUS, v)}</Tag>
      ),
    },
    {
      title: "备注",
      dataIndex: "notes",
      width: 220,
      render: (v: string | null) =>
        v ? (
          <Typography.Text ellipsis={{ tooltip: v }} style={{ maxWidth: 200 }}>
            {v}
          </Typography.Text>
        ) : (
          "—"
        ),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 170,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: "操作",
      width: 150,
      fixed: "right",
      render: (_v, row) =>
        isAdmin ? (
          <Space size={0}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(row)}
            >
              编辑
            </Button>
            <Popconfirm
              title="确认删除该业务员？"
              description="仍绑定客户时无法删除，请先在客户管理中解除绑定。"
              onConfirm={() => void remove(row)}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="业务员管理"
        description="维护业务员主数据；创建客户时可绑定一个业务员。仅管理员可新增、编辑和删除。"
        extra={
          <Space wrap>
            <ImportExport
              module="salespersons"
              moduleLabel="业务员"
              exportQuery={exportQuery}
              isAdmin={isAdmin}
              onImported={() => {
                void mutate();
                void mutateOptions();
              }}
            />
            {isAdmin ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新增业务员
              </Button>
            ) : null}
          </Space>
        }
      />

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            placeholder="搜索姓名 / 电话 / 备注"
            style={{ width: 260 }}
            onSearch={(v) => {
              setKeyword(v);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 100 }}
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={PARTY_STATUS}
          />
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
          刷新
        </Button>
      </div>

      <Table<Salesperson>
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data?.items ?? []}
        columns={columns}
        scroll={{ x: 1000 }}
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
        locale={{ emptyText: error ? errorMessage(error) : "暂无业务员" }}
      />

      <CrudDrawer
        open={drawerOpen}
        title={editing ? `编辑业务员：${editing.name}` : "批量新增业务员"}
        width={560}
        onClose={() => setDrawerOpen(false)}
        onSave={() => void submit()}
        saving={saving}
      >
        <Form<{ items: SalespersonForm[] }> form={form} layout="vertical" requiredMark>
          <BatchEntryList
            form={form}
            batch={!editing}
            defaultItem={defaults()}
            renderItem={(field) => (
              <>
                <Form.Item
                  name={[field.name, "name"]}
                  label="姓名"
                  rules={[{ required: true, message: "请输入业务员姓名" }]}
                >
                  <Input maxLength={100} />
                </Form.Item>
                <Form.Item name={[field.name, "phone"]} label="电话">
                  <Input maxLength={50} />
                </Form.Item>
                <Form.Item name={[field.name, "status"]} label="状态">
                  <Select options={PARTY_STATUS} />
                </Form.Item>
                <Form.Item name={[field.name, "notes"]} label="备注">
                  <Input.TextArea rows={3} maxLength={1000} />
                </Form.Item>
              </>
            )}
          />
        </Form>
      </CrudDrawer>
    </div>
  );
}
