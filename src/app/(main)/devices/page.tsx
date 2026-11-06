"use client";

import { useState } from "react";
import useSWR from "swr";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  App,
  Button,
  DatePicker,
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
import { addDays, diffDays, todayStr } from "@/lib/dates";
import {
  DEVICE_FACES,
  DEVICE_ROLES,
  DEVICE_STATUS,
  DEVICE_TYPES,
  IP_ADDRESS_STATUS,
  colorOf,
  labelOf,
} from "@/lib/enums";
import type { Device, ListResult } from "@/lib/types";

type DeviceForm = {
  name: string;
  type: string;
  role: string;
  status: string;
  manufacturer?: string;
  model?: string;
  serialNo?: string;
  assetTag?: string;
  osVersion?: string;
  mac?: string;
  rackId?: string | null;
  uStart?: number | null;
  uHeight: number;
  face: string;
  supplierId?: string | null;
  customerId?: string | null;
  owner?: string;
  lastInventoryAt?: Dayjs | null;
  purchaseDate?: Dayjs | null;
  warrantyEnd?: Dayjs | null;
  notes?: string;
};

export default function DevicesPage() {
  const user = useSessionUser();
  const isAdmin = user.role === "ADMIN";
  const { message } = App.useApp();
  const { data: options, mutate: mutateOptions } = useOptions();
  const initial = useInitialParams("keyword,warranty,rackId,supplierId,customerId");
  const today = todayStr();
  const warrantyCutoff = addDays(today, 30);

  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [type, setType] = useState<string | undefined>();
  const [role, setRole] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [supplierId, setSupplierId] = useState<string | undefined>(initial.supplierId);
  const [customerId, setCustomerId] = useState<string | undefined>(initial.customerId);
  const [rackId, setRackId] = useState<string | undefined>(initial.rackId);
  const [warrantyOnly, setWarrantyOnly] = useState(initial.warranty === "1");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const filters = {
    keyword,
    type,
    role,
    status,
    rackId,
    supplierId,
    customerId,
    warrantyBefore: warrantyOnly ? warrantyCutoff : undefined,
    page,
    pageSize,
  };
  const { data, error, isLoading, mutate } = useSWR<ListResult<Device>>(
    `/api/devices${buildQuery(filters)}`,
  );

  const [form] = Form.useForm<{ items: DeviceForm[] }>();
  const watchedItems = Form.useWatch("items", form) as DeviceForm[] | undefined;
  const selectedRackFor = (index: number) => {
    const id = watchedItems?.[index]?.rackId;
    return (options?.racks ?? []).find((rack) => rack.id === id);
  };
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<Device | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const defaults = (): DeviceForm => ({
    name: "",
    type: "router",
    role: "access",
    status: "active",
    uHeight: 1,
    face: "front",
    lastInventoryAt: dayjs(today),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ items: [defaults()] });
    setDrawerOpen(true);
  };

  const toForm = (row: Device): DeviceForm => ({
    name: row.name,
    type: row.type,
    role: row.role,
    status: row.status,
    manufacturer: row.manufacturer ?? undefined,
    model: row.model ?? undefined,
    serialNo: row.serialNo ?? undefined,
    assetTag: row.assetTag ?? undefined,
    osVersion: row.osVersion ?? undefined,
    mac: row.mac ?? undefined,
    rackId: row.rackId,
    uStart: row.uStart,
    uHeight: row.uHeight,
    face: row.face,
    supplierId: row.supplierId,
    owner: row.owner ?? undefined,
    lastInventoryAt: row.lastInventoryAt ? dayjs(row.lastInventoryAt) : null,
    purchaseDate: row.purchaseDate ? dayjs(row.purchaseDate) : null,
    warrantyEnd: row.warrantyEnd ? dayjs(row.warrantyEnd) : null,
    notes: row.notes ?? undefined,
  });

  const openEdit = (row: Device) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({ items: [toForm(row)] });
    setDrawerOpen(true);
  };

  const openDetail = async (row: Device) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await apiFetch<Device>(`/api/devices/${row.id}`));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const toPayload = (values: DeviceForm) => ({
    name: values.name.trim(),
    type: values.type,
    role: values.role,
    status: values.status,
    manufacturer: values.manufacturer?.trim() || null,
    model: values.model?.trim() || null,
    serialNo: values.serialNo?.trim() || null,
    assetTag: values.assetTag?.trim() || null,
    osVersion: values.osVersion?.trim() || null,
    mac: values.mac?.trim() || null,
    rackId: values.rackId ?? null,
    uStart: values.rackId ? (values.uStart ?? null) : null,
    uHeight: values.uHeight,
    face: values.face,
    supplierId: values.supplierId ?? null,
    customerId: values.customerId || null,
    owner: values.owner?.trim() || null,
    lastInventoryAt: values.lastInventoryAt ? values.lastInventoryAt.format("YYYY-MM-DD") : null,
    purchaseDate: values.purchaseDate ? values.purchaseDate.format("YYYY-MM-DD") : null,
    warrantyEnd: values.warrantyEnd ? values.warrantyEnd.format("YYYY-MM-DD") : null,
    notes: values.notes?.trim() || null,
  });

  const submit = async () => {
    let values: { items: DeviceForm[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const items = values.items ?? [];
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/devices/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(items[0])),
        });
        message.success("设备已更新");
      } else {
        const result = await submitBatch(items, async (item) => {
          await apiFetch("/api/devices", {
            method: "POST",
            body: JSON.stringify(toPayload(item)),
          });
        });
        if (result.ok) {
          message.success(`已新增 ${result.count} 台设备`);
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

  const remove = async (row: Device) => {
    try {
      await apiFetch(`/api/devices/${row.id}`, { method: "DELETE" });
      message.success("设备已删除");
      await mutate();
      await mutateOptions();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const supplierRule = (index: number) => ({
    validator: async () => {
      const row = form.getFieldValue(["items", index]) as DeviceForm | undefined;
      if (row?.supplierId) return;
      const rack = (options?.racks ?? []).find((r) => r.id === row?.rackId);
      if (rack?.supplierId) return;
      throw new Error("请选择供应商（或选择已关联供应商的机柜）");
    },
  });

  const columns: ColumnsType<Device> = [
    {
      title: "设备名称",
      dataIndex: "name",
      width: 180,
      render: (_v, row) => (
        <div>
          <a onClick={() => void openDetail(row)}>{row.name}</a>
          <div className="rm-muted rm-mono">{row.serialNo ?? "—"}</div>
        </div>
      ),
    },
    {
      title: "类型 / 角色",
      width: 130,
      render: (_v, row) => (
        <div>
          <div>{labelOf(DEVICE_TYPES, row.type)}</div>
          <div className="rm-muted">{labelOf(DEVICE_ROLES, row.role)}</div>
        </div>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v: string) => (
        <Tag color={colorOf(DEVICE_STATUS, v)}>{labelOf(DEVICE_STATUS, v)}</Tag>
      ),
    },
    {
      title: "位置 / 机柜 / U 位",
      width: 200,
      render: (_v, row) => (
        <div>
          <div>{row.rack?.location ?? "—"}</div>
          <div className="rm-muted">
            {row.rack
              ? `${row.rack.code} [${row.rack.uStart}-${row.rack.uEnd}]U`
              : "—"}
            {row.uStart
              ? ` · ${row.uStart}-${row.uStart + row.uHeight - 1}U（${row.face === "front" ? "前" : "后"}）`
              : ""}
          </div>
        </div>
      ),
    },
    {
      title: "管理 IP",
      width: 150,
      render: (_v, row) => (
        <span className="rm-mono">{row.ipAddresses?.[0]?.address ?? "—"}</span>
      ),
    },
    {
      title: "品牌 / 型号",
      width: 170,
      render: (_v, row) => (
        <div>
          <div>{row.manufacturer ?? "—"}</div>
          <div className="rm-muted">{row.model ?? "—"}</div>
        </div>
      ),
    },
    { title: "供应商", width: 160, render: (_v, row) => row.supplier?.name ?? "—" },
    { title: "客户", width: 140, render: (_v, row) => row.customer?.name ?? "—" },
    {
      title: "保修截止",
      width: 130,
      render: (_v, row) => {
        if (!row.warrantyEnd) return "—";
        const left = diffDays(today, row.warrantyEnd);
        return (
          <div>
            <span className={left < 0 ? "rm-danger" : left <= 30 ? "rm-warn" : ""}>
              {row.warrantyEnd}
            </span>
            <div className="rm-muted">
              {left < 0 ? `已过期 ${-left} 天` : `剩余 ${left} 天`}
            </div>
          </div>
        );
      },
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
              title="确认删除该设备？"
              description="仍关联 IP 或线路端点时无法删除。"
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

  const rackOptions = (options?.racks ?? []).map((r) => ({
    value: r.id,
    label: `${r.location ? `${r.location} / ` : ""}${r.code} [${r.uStart}-${r.uEnd}]U`,
    supplierId: r.supplierId,
    uStart: r.uStart,
    uEnd: r.uEnd,
  }));

  return (
    <div>
      <PageHeader
        title="设备管理"
        description="网络设备台账：结构化类型与角色、机柜 U 位、主管理 IP、采购与保修信息。"
        extra={
          <Space wrap>
            <ImportExport
              module="devices"
              moduleLabel="设备"
              exportQuery={buildQuery({
                keyword,
                type,
                role,
                status,
                rackId,
                supplierId,
                customerId,
                warrantyBefore: warrantyOnly ? warrantyCutoff : undefined,
              })}
              isAdmin={isAdmin}
              onImported={() => {
                void mutate();
                void mutateOptions();
              }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增设备
            </Button>
          </Space>
        }
      />

      {warrantyOnly ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message={`当前只显示保修截止日在 ${warrantyCutoff} 之前（未来 30 天内到期或已过期）的设备。`}
          action={
            <Button size="small" onClick={() => setWarrantyOnly(false)}>
              清除筛选
            </Button>
          }
        />
      ) : null}

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            placeholder="搜索名称 / SN / 型号 / MAC / 机柜"
            style={{ width: 260 }}
            onSearch={(v) => {
              setKeyword(v);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="类型"
            style={{ width: 110 }}
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            options={DEVICE_TYPES}
          />
          <Select
            allowClear
            placeholder="角色"
            style={{ width: 110 }}
            value={role}
            onChange={(v) => {
              setRole(v);
              setPage(1);
            }}
            options={DEVICE_ROLES}
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
            options={DEVICE_STATUS}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="机柜"
            style={{ width: 180 }}
            value={rackId}
            onChange={(v) => {
              setRackId(v);
              setPage(1);
            }}
            options={rackOptions}
          />
          <PartySelect
            kind="supplier"
            parties={options?.suppliers}
            placeholder="供应商"
            style={{ width: 165 }}
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
            style={{ width: 165 }}
            value={customerId}
            onChange={(v) => {
              setCustomerId(v);
              setPage(1);
            }}
          />
          <Button
            type={warrantyOnly ? "primary" : "default"}
            danger={warrantyOnly}
            onClick={() => {
              setWarrantyOnly((v) => !v);
              setPage(1);
            }}
          >
            30 天内保修到期
          </Button>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
          刷新
        </Button>
      </div>

      <Table<Device>
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data?.items ?? []}
        columns={columns}
        scroll={{ x: 1400 }}
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
        locale={{ emptyText: error ? errorMessage(error) : "暂无设备" }}
      />

      <CrudDrawer
        open={drawerOpen}
        title={editing ? `编辑设备：${editing.name}` : "批量新增设备"}
        onClose={() => setDrawerOpen(false)}
        onSave={() => void submit()}
        saving={saving}
        width={880}
      >
        <Form<{ items: DeviceForm[] }> form={form} layout="vertical" requiredMark>
          {editing && editing.supplierId === null ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="该历史设备尚未关联供应商，请补全后保存。"
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
                    name={[field.name, "name"]}
                    label="设备名称"
                    rules={[{ required: true, message: "请输入设备名称" }]}
                    style={{ flex: 1 }}
                  >
                    <Input maxLength={100} />
                  </Form.Item>
                  <Form.Item name={[field.name, "type"]} label="类型" style={{ flex: 1 }}>
                    <Select options={DEVICE_TYPES} />
                  </Form.Item>
                  <Form.Item name={[field.name, "role"]} label="角色" style={{ flex: 1 }}>
                    <Select options={DEVICE_ROLES} />
                  </Form.Item>
                  <Form.Item name={[field.name, "status"]} label="状态" style={{ flex: 1 }}>
                    <Select options={DEVICE_STATUS} />
                  </Form.Item>
                </Space>

                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "manufacturer"]} label="品牌" style={{ flex: 1 }}>
                    <Input maxLength={100} />
                  </Form.Item>
                  <Form.Item name={[field.name, "model"]} label="型号" style={{ flex: 1 }}>
                    <Input maxLength={100} />
                  </Form.Item>
                  <Form.Item name={[field.name, "serialNo"]} label="序列号" style={{ flex: 1 }}>
                    <Input maxLength={100} />
                  </Form.Item>
                  <Form.Item name={[field.name, "assetTag"]} label="资产标签" style={{ flex: 1 }}>
                    <Input maxLength={100} />
                  </Form.Item>
                </Space>

                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "osVersion"]} label="系统版本" style={{ flex: 1 }}>
                    <Input maxLength={50} placeholder="如 7.16.2" />
                  </Form.Item>
                  <Form.Item name={[field.name, "mac"]} label="MAC 地址" style={{ flex: 1 }}>
                    <Input maxLength={50} />
                  </Form.Item>
                  <Form.Item name={[field.name, "owner"]} label="负责人" style={{ flex: 1 }}>
                    <Input maxLength={50} />
                  </Form.Item>
                </Space>

                <Typography.Title level={5} style={{ marginTop: 4 }}>
                  位置与 U 位
                </Typography.Title>
                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "rackId"]} label="机柜" style={{ flex: 1 }}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      options={rackOptions}
                      onChange={(v: string | undefined) => {
                        const rack = rackOptions.find((r) => r.value === v);
                        if (rack?.supplierId) {
                          form.setFieldValue(["items", index, "supplierId"], rack.supplierId);
                        }
                        form.setFieldValue(
                          ["items", index, "uStart"],
                          rack ? rack.uStart : null,
                        );
                      }}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, "uStart"]} label="起始 U 位" style={{ flex: 1 }}>
                    <InputNumber
                      min={selectedRackFor(index)?.uStart ?? 1}
                      max={selectedRackFor(index)?.uEnd ?? 100}
                      precision={0}
                      style={{ width: "100%" }}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, "uHeight"]} label="高度（U）" style={{ flex: 1 }}>
                    <InputNumber min={1} max={100} precision={0} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name={[field.name, "face"]} label="安装面" style={{ flex: 1 }}>
                    <Select options={DEVICE_FACES} />
                  </Form.Item>
                </Space>

                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item
                    name={[field.name, "supplierId"]}
                    label="供应商"
                    rules={[supplierRule(index)]}
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
                </Space>

                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "lastInventoryAt"]} label="最近盘点" style={{ flex: 1 }}>
                    <DatePicker style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name={[field.name, "purchaseDate"]} label="采购日期" style={{ flex: 1 }}>
                    <DatePicker style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name={[field.name, "warrantyEnd"]} label="保修截止" style={{ flex: 1 }}>
                    <DatePicker style={{ width: "100%" }} />
                  </Form.Item>
                </Space>
                <Form.Item name={[field.name, "notes"]} label="备注">
                  <Input.TextArea rows={2} maxLength={1000} />
                </Form.Item>
              </>
            )}
          />
        </Form>
      </CrudDrawer>

      <Drawer
        open={detailOpen}
        title={detail ? `设备详情：${detail.name}` : "设备详情"}
        width={760}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading && !detail}
      >
        {detail ? (
          <>
            <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="类型">{labelOf(DEVICE_TYPES, detail.type)}</Descriptions.Item>
              <Descriptions.Item label="角色">{labelOf(DEVICE_ROLES, detail.role)}</Descriptions.Item>
              <Descriptions.Item label="状态">{labelOf(DEVICE_STATUS, detail.status)}</Descriptions.Item>
              <Descriptions.Item label="品牌">{detail.manufacturer ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="型号">{detail.model ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="序列号">{detail.serialNo ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="系统版本">{detail.osVersion ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="MAC">{detail.mac ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="负责人">{detail.owner ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="位置">{detail.rack?.location ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="机柜">
                {detail.rack
                  ? `${detail.rack.code} [${detail.rack.uStart}-${detail.rack.uEnd}]U`
                  : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="U 位">
                {detail.uStart
                  ? `${detail.uStart}-${detail.uStart + detail.uHeight - 1}U（${detail.face === "front" ? "前面板" : "后面板"}）`
                  : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="供应商">{detail.supplier?.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="客户">{detail.customer?.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="盘点日期">
                <Maybe value={detail.lastInventoryAt} />
              </Descriptions.Item>
              <Descriptions.Item label="采购日期">
                <Maybe value={detail.purchaseDate} />
              </Descriptions.Item>
              <Descriptions.Item label="保修截止">
                <Maybe value={detail.warrantyEnd} />
              </Descriptions.Item>
              <Descriptions.Item label="备注" span={3}>
                {detail.notes ?? "—"}
              </Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5}>关联 IP（{detail.ipAddresses?.length ?? 0}）</Typography.Title>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.ipAddresses ?? []}
              locale={{ emptyText: "暂无 IP" }}
              columns={[
                { title: "IP", dataIndex: "address", className: "rm-mono" },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 100,
                  render: (v: string) => labelOf(IP_ADDRESS_STATUS, v),
                },
                { title: "DNS", dataIndex: "dnsName", render: (v) => <Maybe value={v} /> },
                {
                  title: "主 IP",
                  dataIndex: "isPrimary",
                  width: 80,
                  render: (v: boolean) => (v ? <Tag color="gold">主</Tag> : "—"),
                },
              ]}
            />

            <Typography.Title level={5} style={{ marginTop: 18 }}>
              线路端点（{detail.terminations?.length ?? 0}）
            </Typography.Title>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.terminations ?? []}
              locale={{ emptyText: "暂无线路端点" }}
              columns={[
                {
                  title: "线路",
                  render: (_v, t) => `${t.line.code} ${t.line.name}`,
                },
                {
                  title: "端",
                  dataIndex: "side",
                  width: 80,
                  render: (v: string) => `${v} 端`,
                },
                { title: "端口", dataIndex: "port", width: 100, render: (v) => <Maybe value={v} /> },
              ]}
            />
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
