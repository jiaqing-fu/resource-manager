"use client";

import { useMemo, useState } from "react";
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
import { VXLAN_STATUS, colorOf, labelOf } from "@/lib/enums";
import type { ListResult, Vxlan } from "@/lib/types";

type VxlanForm = {
  vni?: number;
  name?: string;
  status: string;
  description?: string;
  vlanId?: string | null;
  supplierId?: string | null;
};

const defaults = (): VxlanForm => ({ status: "active" });

export default function VxlansPage() {
  const user = useSessionUser();
  const isAdmin = user.role === "ADMIN";
  const { message } = App.useApp();
  const { data: options, mutate: mutateOptions } = useOptions();
  const initial = useInitialParams("keyword,supplierId,customerId,vlanId");
  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [status, setStatus] = useState<string | undefined>();
  const [supplierId, setSupplierId] = useState<string | undefined>(initial.supplierId);
  const [customerId, setCustomerId] = useState<string | undefined>(initial.customerId);
  const [vlanId, setVlanId] = useState<string | undefined>(initial.vlanId);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, error, isLoading, mutate } = useSWR<ListResult<Vxlan>>(
    `/api/vxlans${buildQuery({ keyword, status, supplierId, customerId, vlanId, page, pageSize })}`,
  );

  const [form] = Form.useForm<{ items: VxlanForm[] }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Vxlan | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<Vxlan | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const vlanOptions = useMemo(() => {
    const occupied = new Set(
      (options?.vxlans ?? [])
        .filter((v) => v.vlanId && v.id !== editing?.id)
        .map((v) => v.vlanId as string),
    );
    return (options?.vlans ?? [])
      .filter((v) => !occupied.has(v.id) || v.id === editing?.vlanId)
      .map((v) => ({
        value: v.id,
        label: `VLAN ${v.vid} ${v.name}`,
        supplierId: v.supplierId,
      }));
  }, [options?.vlans, options?.vxlans, editing?.id, editing?.vlanId]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ items: [defaults()] });
    setDrawerOpen(true);
  };

  const openEdit = (row: Vxlan) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      items: [
        {
          vni: row.vni,
          name: row.name ?? undefined,
          status: row.status,
          description: row.description ?? undefined,
          vlanId: row.vlanId,
          supplierId: row.supplierId,
        },
      ],
    });
    setDrawerOpen(true);
  };

  const openDetail = async (row: Vxlan) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await apiFetch<Vxlan>(`/api/vxlans/${row.id}`));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const toPayload = (values: VxlanForm) => ({
    vni: values.vni,
    name: values.name?.trim() || null,
    status: values.status,
    description: values.description?.trim() || null,
    vlanId: values.vlanId || null,
    supplierId: values.supplierId || null,
  });

  const submit = async () => {
    let values: { items: VxlanForm[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const items = values.items ?? [];
    if (!editing) {
      const seen = new Set<number>();
      for (let i = 0; i < items.length; i += 1) {
        const vni = items[i].vni;
        if (vni === undefined || vni === null) continue;
        if (seen.has(vni)) {
          message.error(`第 ${i + 1} 条 VNI「${vni}」在本次提交中重复`);
          return;
        }
        seen.add(vni);
      }
    }
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/vxlans/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(items[0])),
        });
        message.success("VXLAN 已更新");
      } else {
        const result = await submitBatch(items, async (item) => {
          await apiFetch("/api/vxlans", {
            method: "POST",
            body: JSON.stringify(toPayload(item)),
          });
        });
        if (result.ok) {
          message.success(`已新增 ${result.count} 个 VXLAN`);
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

  const remove = async (row: Vxlan) => {
    try {
      await apiFetch(`/api/vxlans/${row.id}`, { method: "DELETE" });
      message.success("VXLAN 已删除");
      await mutate();
      await mutateOptions();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const supplierRule = (index: number) => ({
    validator: async () => {
      const row = form.getFieldValue(["items", index]) as VxlanForm | undefined;
      if (row?.supplierId) return;
      const vlan = (options?.vlans ?? []).find((v) => v.id === row?.vlanId);
      if (vlan?.supplierId) return;
      throw new Error("请选择供应商（或选择已关联供应商的 VLAN）");
    },
  });

  const columns: ColumnsType<Vxlan> = [
    {
      title: "VNI",
      dataIndex: "vni",
      width: 110,
      render: (_v, row) => <a onClick={() => void openDetail(row)}>{row.vni}</a>,
    },
    { title: "名称", dataIndex: "name", render: (v) => <Maybe value={v} /> },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v: string) => <Tag color={colorOf(VXLAN_STATUS, v)}>{labelOf(VXLAN_STATUS, v)}</Tag>,
    },
    {
      title: "关联 VLAN",
      width: 200,
      render: (_v, row) =>
        row.vlan ? `VLAN ${row.vlan.vid} ${row.vlan.name}` : "—",
    },
    { title: "供应商", width: 180, render: (_v, row) => row.supplier?.name ?? "—" },
    { title: "客户", width: 160, render: (_v, row) => row.customer?.name ?? "—" },
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
              title="确认删除该 VXLAN？"
              description="删除 VXLAN 不会删除其关联 VLAN；有未释放分配时无法删除。"
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
        title="VXLAN 管理"
        description="VXLAN 独立台账；VNI 全局唯一，可关联一个 VLAN，客户归属通过资源分配产生。"
        extra={
          <Space wrap>
            <ImportExport
              module="vxlans"
              moduleLabel="VXLAN"
              exportQuery={buildQuery({ keyword, status, supplierId, customerId, vlanId })}
              isAdmin={isAdmin}
              onImported={() => {
                void mutate();
                void mutateOptions();
              }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增 VXLAN
            </Button>
          </Space>
        }
      />

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            placeholder="搜索 VNI / 名称 / VLAN / 供应商"
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
            options={VXLAN_STATUS}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="关联 VLAN"
            style={{ width: 200 }}
            value={vlanId}
            onChange={(v) => {
              setVlanId(v);
              setPage(1);
            }}
            options={(options?.vlans ?? []).map((v) => ({
              value: v.id,
              label: `VLAN ${v.vid} ${v.name}`,
            }))}
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

      <Table<Vxlan>
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
        locale={{ emptyText: error ? errorMessage(error) : "暂无 VXLAN" }}
      />

      <CrudDrawer
        open={drawerOpen}
        title={editing ? `编辑 VXLAN：${editing.vni}` : "批量新增 VXLAN"}
        onClose={() => setDrawerOpen(false)}
        onSave={() => void submit()}
        saving={saving}
        width={780}
      >
        <Form<{ items: VxlanForm[] }> form={form} layout="vertical" requiredMark>
          {editing && editing.supplierId === null ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="该历史 VXLAN 尚未关联供应商，请补全后保存。"
            />
          ) : null}
          <BatchEntryList
            form={form}
            batch={!editing}
            defaultItem={defaults()}
            renderItem={(field, index) => (
              <>
                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item
                    name={[field.name, "vni"]}
                    label="VNI"
                    rules={[{ required: true, message: "请输入 VNI" }]}
                    style={{ width: 150 }}
                  >
                    <InputNumber min={1} max={16777215} precision={0} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name={[field.name, "name"]} label="名称" style={{ flex: 1 }}>
                    <Input maxLength={100} />
                  </Form.Item>
                  <Form.Item name={[field.name, "status"]} label="状态" style={{ width: 120 }}>
                    <Select options={VXLAN_STATUS} />
                  </Form.Item>
                </Space>
                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "vlanId"]} label="关联 VLAN" style={{ flex: 1 }}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      options={vlanOptions}
                      onChange={(v: string | undefined) => {
                        const vlan = vlanOptions.find((item) => item.value === v);
                        if (vlan?.supplierId) {
                          form.setFieldValue(["items", index, "supplierId"], vlan.supplierId);
                        }
                      }}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "supplierId"]}
                    label="供应商"
                    rules={[supplierRule(index)]}
                    style={{ flex: 1 }}
                  >
                    <PartySelect kind="supplier" parties={options?.suppliers} />
                  </Form.Item>
                </Space>
                <Form.Item name={[field.name, "description"]} label="描述">
                  <Input maxLength={500} />
                </Form.Item>
              </>
            )}
          />
        </Form>
      </CrudDrawer>

      <Drawer
        open={detailOpen}
        title={detail ? `VXLAN 详情：VNI ${detail.vni}` : "VXLAN 详情"}
        width={620}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading && !detail}
      >
        {detail ? (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="VNI">{detail.vni}</Descriptions.Item>
            <Descriptions.Item label="状态">{labelOf(VXLAN_STATUS, detail.status)}</Descriptions.Item>
            <Descriptions.Item label="名称" span={2}>
              <Maybe value={detail.name} />
            </Descriptions.Item>
            <Descriptions.Item label="关联 VLAN" span={2}>
              {detail.vlan ? `VLAN ${detail.vlan.vid} ${detail.vlan.name}` : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="供应商">{detail.supplier?.name ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="客户">{detail.customer?.name ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="描述" span={2}>
              {detail.description ?? "—"}
            </Descriptions.Item>
          </Descriptions>
        ) : null}
      </Drawer>
    </div>
  );
}
