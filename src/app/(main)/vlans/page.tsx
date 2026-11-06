"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Alert,
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
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
import { CustomerBindingField } from "@/components/CustomerBindingField";
import { ImportExport } from "@/components/ImportExport";
import { PartySelect } from "@/components/PartySelect";
import { Maybe } from "@/components/Tags";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { BatchEntryList } from "@/components/batch/BatchEntryList";
import { submitBatch } from "@/components/batch/submitBatch";
import { useOptions } from "@/components/OptionsProvider";
import { useSessionUser } from "@/components/SessionContext";
import { useInitialParams } from "@/components/useInitialParams";
import { apiFetch, buildQuery, errorMessage } from "@/lib/client";
import { VLAN_STATUS, colorOf, labelOf } from "@/lib/enums";
import type { ListResult, Vlan } from "@/lib/types";

type VlanForm = {
  vid?: number;
  name: string;
  status: string;
  description?: string;
  supplierId?: string | null;
  customerId?: string | null;
};

const defaults = (): VlanForm => ({ name: "", status: "active" });

export default function VlansPage() {
  const user = useSessionUser();
  const isAdmin = user.role === "ADMIN";
  const { message } = App.useApp();
  const { data: options, mutate: mutateOptions } = useOptions();
  const initial = useInitialParams("keyword,supplierId,customerId");
  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [status, setStatus] = useState<string | undefined>();
  const [supplierId, setSupplierId] = useState<string | undefined>(initial.supplierId);
  const [customerId, setCustomerId] = useState<string | undefined>(initial.customerId);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, error, isLoading, mutate } = useSWR<ListResult<Vlan>>(
    `/api/vlans${buildQuery({ keyword, status, supplierId, customerId, page, pageSize })}`,
  );

  const [form] = Form.useForm<{ items: VlanForm[] }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Vlan | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<Vlan | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ items: [defaults()] });
    setDrawerOpen(true);
  };

  const openEdit = (row: Vlan) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      items: [
        {
          vid: row.vid,
          name: row.name,
          status: row.status,
          description: row.description ?? undefined,
          supplierId: row.supplierId,
        },
      ],
    });
    setDrawerOpen(true);
  };

  const openDetail = async (row: Vlan) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await apiFetch<Vlan>(`/api/vlans/${row.id}`));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const toPayload = (values: VlanForm) => ({
    vid: values.vid,
    name: values.name.trim(),
    status: values.status,
    description: values.description?.trim() || null,
    supplierId: values.supplierId || null,
    customerId: values.customerId || null,
  });

  const submit = async () => {
    let values: { items: VlanForm[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const items = values.items ?? [];
    if (!editing) {
      const seen = new Set<string>();
      for (let i = 0; i < items.length; i += 1) {
        const key = `${items[i].supplierId ?? ""}:${items[i].vid}`;
        if (seen.has(key)) {
          message.error(`第 ${i + 1} 条 VLAN ID 在同一供应商下重复`);
          return;
        }
        seen.add(key);
      }
    }
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/vlans/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(items[0])),
        });
        message.success("VLAN 已更新");
      } else {
        const result = await submitBatch(items, async (item) => {
          await apiFetch("/api/vlans", {
            method: "POST",
            body: JSON.stringify(toPayload(item)),
          });
        });
        if (result.ok) {
          message.success(`已新增 ${result.count} 个 VLAN`);
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

  const remove = async (row: Vlan) => {
    try {
      await apiFetch(`/api/vlans/${row.id}`, { method: "DELETE" });
      message.success("VLAN 已删除");
      await mutate();
      await mutateOptions();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const columns: ColumnsType<Vlan> = [
    {
      title: "VLAN ID",
      dataIndex: "vid",
      width: 100,
      render: (_v, row) => <a onClick={() => void openDetail(row)}>{row.vid}</a>,
    },
    { title: "名称", dataIndex: "name" },
    { title: "供应商", width: 180, render: (_v, row) => row.supplier?.name ?? "—" },
    { title: "客户", width: 160, render: (_v, row) => row.customer?.name ?? "—" },
    { title: "IP 段", width: 80, render: (_v, row) => row._count?.ipBlocks ?? 0 },
    {
      title: "VXLAN",
      width: 160,
      render: (_v, row) =>
        row.vxlan ? `VNI ${row.vxlan.vni}${row.vxlan.name ? ` ${row.vxlan.name}` : ""}` : "—",
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v: string) => <Tag color={colorOf(VLAN_STATUS, v)}>{labelOf(VLAN_STATUS, v)}</Tag>,
    },
    { title: "描述", dataIndex: "description", render: (v) => <Maybe value={v} /> },
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
              title="确认删除该 VLAN？"
              description="仍有关联 IP 段或未释放分配时无法删除。"
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
        title="VLAN 管理"
        description="VLAN 独立台账；同一供应商下 VLAN ID 唯一，客户归属通过资源分配产生。"
        extra={
          <Space wrap>
            <ImportExport
              module="vlans"
              moduleLabel="VLAN"
              exportQuery={buildQuery({ keyword, status, supplierId, customerId })}
              isAdmin={isAdmin}
              onImported={() => {
                void mutate();
                void mutateOptions();
              }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增 VLAN
            </Button>
          </Space>
        }
      />

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            placeholder="搜索 VLAN ID / 名称 / 描述 / 供应商"
            style={{ width: 260 }}
            onSearch={(v) => {
              setKeyword(v);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 110 }}
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={VLAN_STATUS}
          />
          <PartySelect
            kind="supplier"
            parties={options?.suppliers}
            placeholder="供应商"
            style={{ width: 180 }}
            value={supplierId}
            onChange={(v) => {
              setSupplierId(v);
              setPage(1);
            }}
          />
          <PartySelect
            kind="customer"
            parties={options?.customers}
            placeholder="客户"
            style={{ width: 180 }}
            value={customerId}
            onChange={(v) => {
              setCustomerId(v);
              setPage(1);
            }}
          />
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
          刷新
        </Button>
      </div>

      <Table<Vlan>
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data?.items ?? []}
        columns={columns}
        scroll={{ x: 1200 }}
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
        locale={{ emptyText: error ? errorMessage(error) : "暂无 VLAN" }}
      />

      <CrudDrawer
        open={drawerOpen}
        title={editing ? `编辑 VLAN：${editing.vid} ${editing.name}` : "批量新增 VLAN"}
        onClose={() => setDrawerOpen(false)}
        onSave={() => void submit()}
        saving={saving}
        width={760}
      >
        <Form<{ items: VlanForm[] }> form={form} layout="vertical" requiredMark>
          {editing && editing.supplierId === null ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="该历史 VLAN 尚未关联供应商，请补全后保存。"
            />
          ) : null}
          <BatchEntryList
            form={form}
            batch={!editing}
            defaultItem={defaults()}
            renderItem={(field) => (
              <>
                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item
                    name={[field.name, "vid"]}
                    label="VLAN ID"
                    rules={[{ required: true, message: "请输入 VLAN ID" }]}
                    style={{ width: 140 }}
                  >
                    <InputNumber min={1} max={4094} precision={0} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "name"]}
                    label="名称"
                    rules={[{ required: true, message: "请输入 VLAN 名称" }]}
                    style={{ flex: 1 }}
                  >
                    <Input maxLength={100} />
                  </Form.Item>
                  <Form.Item name={[field.name, "status"]} label="状态" style={{ width: 120 }}>
                    <Select options={VLAN_STATUS} />
                  </Form.Item>
                </Space>
                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item
                    name={[field.name, "supplierId"]}
                    label="供应商"
                    rules={[{ required: true, message: "请选择供应商" }]}
                    style={{ flex: 1 }}
                  >
                    <PartySelect kind="supplier" parties={options?.suppliers} />
                  </Form.Item>
                  {!editing ? (
                    <Form.Item
                      name={[field.name, "customerId"]}
                      label="绑定客户（可选）"
                      style={{ flex: 1 }}
                    >
                      <CustomerBindingField />
                    </Form.Item>
                  ) : null}
                  <Form.Item name={[field.name, "description"]} label="描述" style={{ flex: 2 }}>
                    <Input maxLength={500} />
                  </Form.Item>
                </Space>
              </>
            )}
          />
        </Form>
      </CrudDrawer>

      <Drawer
        open={detailOpen}
        title={detail ? `VLAN 详情：${detail.vid} ${detail.name}` : "VLAN 详情"}
        width={620}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading && !detail}
      >
        {detail ? (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="VLAN ID">{detail.vid}</Descriptions.Item>
            <Descriptions.Item label="状态">{labelOf(VLAN_STATUS, detail.status)}</Descriptions.Item>
            <Descriptions.Item label="名称" span={2}>
              {detail.name}
            </Descriptions.Item>
            <Descriptions.Item label="供应商">{detail.supplier?.name ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="客户">{detail.customer?.name ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="关联 IP 段">{detail._count?.ipBlocks ?? 0}</Descriptions.Item>
            <Descriptions.Item label="关联 VXLAN">
              {detail.vxlan
                ? `VNI ${detail.vxlan.vni}${detail.vxlan.name ? ` ${detail.vxlan.name}` : ""}`
                : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="描述" span={2}>
              {detail.description ?? "—"}
            </Descriptions.Item>
          </Descriptions>
        ) : null}
      </Drawer>
    </div>
  );
}
