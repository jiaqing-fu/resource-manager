"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  App,
  Button,
  Descriptions,
  Drawer,
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
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { CrudDrawer } from "@/components/CrudDrawer";
import { ImportExport } from "@/components/ImportExport";
import { PartyHierarchyFields } from "@/components/PartyHierarchyFields";
import { Maybe } from "@/components/Tags";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { BatchEntryList } from "@/components/batch/BatchEntryList";
import { submitBatch } from "@/components/batch/submitBatch";
import { useOptions } from "@/components/OptionsProvider";
import { useSessionUser } from "@/components/SessionContext";
import { useInitialParams } from "@/components/useInitialParams";
import { apiFetch, buildQuery, errorMessage } from "@/lib/client";
import { PARTY_LEVELS, PARTY_STATUS, labelOf } from "@/lib/enums";
import type { Customer, ListResult } from "@/lib/types";

type CustomerForm = {
  name?: string;
  level: string;
  parentId?: string | null;
  salespersonId?: string | null;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  status: string;
  notes?: string;
};

const defaults = (): CustomerForm => ({ level: "1", status: "active" });

export default function CustomersPage() {
  const user = useSessionUser();
  const isAdmin = user.role === "ADMIN";
  const { message } = App.useApp();
  const { data: options, mutate: mutateOptions } = useOptions();
  const initial = useInitialParams("keyword,salespersonId");
  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [level, setLevel] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [salespersonId, setSalespersonId] = useState<string | undefined>(
    initial.salespersonId,
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const filters = { keyword, level, status, salespersonId, page, pageSize };
  const { data, error, isLoading, mutate } = useSWR<ListResult<Customer>>(
    `/api/customers${buildQuery(filters)}`,
  );

  const [form] = Form.useForm<{ items: CustomerForm[] }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<Customer | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const exportQuery = buildQuery({ keyword, level, status, salespersonId });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ items: [defaults()] });
    setDrawerOpen(true);
  };

  const openEdit = (row: Customer) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      items: [
        {
          name: row.name,
          level: String(row.level),
          parentId: row.parentId,
          salespersonId: row.salespersonId ?? undefined,
          contactName: row.contactName ?? undefined,
          phone: row.phone ?? undefined,
          email: row.email ?? undefined,
          address: row.address ?? undefined,
          status: row.status,
          notes: row.notes ?? undefined,
        },
      ],
    });
    setDrawerOpen(true);
  };

  const openDetail = async (row: Customer) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await apiFetch<Customer>(`/api/customers/${row.id}`));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const toPayload = (values: CustomerForm) => ({
    name: values.name?.trim(),
    level: Number(values.level),
    parentId: Number(values.level) === 2 ? values.parentId ?? null : null,
    salespersonId: values.salespersonId ?? null,
    contactName: values.contactName?.trim() || null,
    phone: values.phone?.trim() || null,
    email: values.email?.trim() || null,
    address: values.address?.trim() || null,
    status: values.status,
    notes: values.notes?.trim() || null,
  });

  const submit = async () => {
    let values: { items: CustomerForm[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const items = values.items ?? [];
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/customers/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(items[0])),
        });
        message.success("客户已更新");
      } else {
        const result = await submitBatch(items, async (item) => {
          await apiFetch("/api/customers", {
            method: "POST",
            body: JSON.stringify(toPayload(item)),
          });
        });
        if (result.ok) {
          message.success(`已新增 ${result.count} 个客户`);
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

  const remove = async (row: Customer) => {
    try {
      await apiFetch(`/api/customers/${row.id}`, { method: "DELETE" });
      message.success("客户已删除");
      await mutate();
      await mutateOptions();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const columns: ColumnsType<Customer> = [
    {
      title: "名称",
      dataIndex: "name",
      render: (_v, row) => (
        <Space size={6}>
          <a onClick={() => void openDetail(row)}>{row.name}</a>
          <Tag color={row.level === 1 ? "geekblue" : "cyan"}>
            {labelOf(PARTY_LEVELS, row.level)}
          </Tag>
        </Space>
      ),
    },
    {
      title: "上级客户",
      dataIndex: "parent",
      width: 160,
      render: (_v, row) => <Maybe value={row.parent?.name} />,
    },
    {
      title: "业务员",
      dataIndex: "salesperson",
      width: 110,
      render: (_v, row) => <Maybe value={row.salesperson?.name} />,
    },
    { title: "联系人", dataIndex: "contactName", width: 110, render: (v) => <Maybe value={v} /> },
    { title: "电话", dataIndex: "phone", width: 140, render: (v) => <Maybe value={v} /> },
    {
      title: "关联",
      width: 230,
      render: (_v, row) => (
        <Space size={4} wrap>
          <Tag>{row._count?.allocations ?? 0} 分配</Tag>
          <Tag>{row._count?.ipAddresses ?? 0} IP</Tag>
          <Tag>{row._count?.lines ?? 0} 线路</Tag>
          <Tag>{row._count?.customerTests ?? 0} 测试</Tag>
        </Space>
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
      title: "操作",
      width: 170,
      fixed: "right",
      render: (_v, row) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => void openDetail(row)}>
            详情
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          {isAdmin ? (
            <Popconfirm
              title="确认删除该客户？"
              description="存在资源分配历史、IP、线路、设备等引用时将无法删除。"
              onConfirm={() => void remove(row)}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="客户管理"
        description="严格两级：一级必须存在，二级挂在一级下；客户与资源的关联通过「资源分配」建立。"
        extra={
          <Space wrap>
            <ImportExport
              module="customers"
              moduleLabel="客户"
              exportQuery={exportQuery}
              isAdmin={isAdmin}
              onImported={() => {
                void mutate();
                void mutateOptions();
              }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增客户
            </Button>
          </Space>
        }
      />

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            placeholder="搜索名称 / 业务员 / 电话 / 邮箱 / 联系人"
            style={{ width: 280 }}
            onSearch={(v) => {
              setKeyword(v);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="层级"
            style={{ width: 100 }}
            value={level}
            onChange={(v) => {
              setLevel(v);
              setPage(1);
            }}
            options={PARTY_LEVELS.map((o) => ({ value: o.value, label: o.label }))}
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
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="业务员"
            style={{ width: 140 }}
            value={salespersonId}
            onChange={(v) => {
              setSalespersonId(v);
              setPage(1);
            }}
            options={(options?.salespeople ?? []).map((s) => ({
              value: s.id,
              label: s.status === "inactive" ? `${s.name}（停用）` : s.name,
            }))}
          />
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
          刷新
        </Button>
      </div>

      <Table<Customer>
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data?.items ?? []}
        columns={columns}
        scroll={{ x: 1180 }}
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
        locale={{ emptyText: error ? errorMessage(error) : "暂无客户" }}
      />

      <CrudDrawer
        open={drawerOpen}
        title={editing ? `编辑客户：${editing.name}` : "批量新增客户"}
        onClose={() => setDrawerOpen(false)}
        onSave={() => void submit()}
        saving={saving}
        width={760}
      >
        <Form<{ items: CustomerForm[] }> form={form} layout="vertical" requiredMark>
          <BatchEntryList
            form={form}
            batch={!editing}
            defaultItem={defaults()}
            renderItem={(field) => (
              <>
                <Form.Item
                  name={[field.name, "name"]}
                  label="名称"
                  rules={[{ required: true, message: "请输入名称" }]}
                >
                  <Input maxLength={100} />
                </Form.Item>
                <PartyHierarchyFields
                  kind="customer"
                  path={[field.name]}
                  watchPath={["items", field.name]}
                />
                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "salespersonId"]} label="业务员" style={{ flex: 1 }}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      placeholder="未分配"
                      options={(options?.salespeople ?? []).map((s) => ({
                        value: s.id,
                        label: s.status === "inactive" ? `${s.name}（停用）` : s.name,
                        disabled: s.status !== "active",
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, "contactName"]} label="联系人" style={{ flex: 1 }}>
                    <Input maxLength={50} />
                  </Form.Item>
                  <Form.Item name={[field.name, "status"]} label="状态" style={{ flex: 1 }}>
                    <Select options={PARTY_STATUS} />
                  </Form.Item>
                </Space>
                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "phone"]} label="电话" style={{ flex: 1 }}>
                    <Input maxLength={50} />
                  </Form.Item>
                  <Form.Item name={[field.name, "email"]} label="邮箱" style={{ flex: 1 }}>
                    <Input maxLength={100} />
                  </Form.Item>
                </Space>
                <Form.Item name={[field.name, "address"]} label="地址">
                  <Input maxLength={200} />
                </Form.Item>
                <Form.Item name={[field.name, "notes"]} label="备注">
                  <Input.TextArea rows={3} maxLength={1000} />
                </Form.Item>
              </>
            )}
          />
        </Form>
      </CrudDrawer>

      <Drawer
        open={detailOpen}
        title={detail ? `客户详情：${detail.name}` : "客户详情"}
        width={680}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading && !detail}
      >
        {detail ? (
          <>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="名称">{detail.name}</Descriptions.Item>
              <Descriptions.Item label="层级">{labelOf(PARTY_LEVELS, detail.level)}</Descriptions.Item>
              <Descriptions.Item label="上级">{detail.parent?.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="业务员">
                {detail.salesperson?.name ?? "—"}
              </Descriptions.Item>
              <Descriptions.Item label="联系人">{detail.contactName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="电话">{detail.phone ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{detail.email ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="状态">{labelOf(PARTY_STATUS, detail.status)}</Descriptions.Item>
              <Descriptions.Item label="地址" span={2}>{detail.address ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>{detail.notes ?? "—"}</Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5} style={{ marginTop: 18 }}>关联资源</Typography.Title>
            <Space wrap>
              <Link href={`/resource-allocations?customerId=${detail.id}`}>
                <Tag color="gold">{detail._count?.allocations ?? 0} 条资源分配</Tag>
              </Link>
              <Link href={`/ip/addresses?customerId=${detail.id}`}>
                <Tag color="blue">{detail._count?.ipAddresses ?? 0} 个 IP 地址</Tag>
              </Link>
              <Link href={`/ip/blocks?customerId=${detail.id}`}>
                <Tag color="blue">{detail._count?.ipBlocks ?? 0} 个 IP 段</Tag>
              </Link>
              <Link href={`/vlans?customerId=${detail.id}`}>
                <Tag color="cyan">{detail._count?.vlans ?? 0} 个 VLAN</Tag>
              </Link>
              <Link href={`/vxlans?customerId=${detail.id}`}>
                <Tag color="cyan">{detail._count?.vxlans ?? 0} 个 VXLAN</Tag>
              </Link>
              <Link href={`/broadbands?customerId=${detail.id}`}>
                <Tag color="orange">{detail._count?.broadbands ?? 0} 条宽带</Tag>
              </Link>
              <Link href={`/lines?customerId=${detail.id}`}>
                <Tag color="cyan">{detail._count?.lines ?? 0} 条线路</Tag>
              </Link>
              <Link href={`/racks?customerId=${detail.id}`}>
                <Tag color="geekblue">{detail._count?.racks ?? 0} 个机柜</Tag>
              </Link>
              <Link href={`/devices?customerId=${detail.id}`}>
                <Tag color="purple">{detail._count?.devices ?? 0} 台设备</Tag>
              </Link>
              <Link href={`/customer-tests?customerId=${detail.id}`}>
                <Tag color="orange">{detail._count?.customerTests ?? 0} 条测试</Tag>
              </Link>
            </Space>

            {detail.children && detail.children.length > 0 ? (
              <>
                <Typography.Title level={5} style={{ marginTop: 18 }}>下级客户</Typography.Title>
                <Space wrap>
                  {detail.children.map((child) => (
                    <Tag key={child.id}>{child.name}</Tag>
                  ))}
                </Space>
              </>
            ) : null}
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
