"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import dayjs, { type Dayjs } from "dayjs";
import {
  App,
  Button,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
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
  StarFilled,
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
import {
  IP_ADDRESS_ROLES,
  IP_ADDRESS_STATUS,
  colorOf,
  labelOf,
} from "@/lib/enums";
import type { IpAddress, ListResult } from "@/lib/types";

type IpForm = {
  address?: string;
  blockId?: string | null;
  status: string;
  role: string;
  supplierId?: string | null;
  rackId?: string | null;
  deviceId?: string | null;
  lineId?: string | null;
  isPrimary: boolean;
  dnsName?: string;
  description?: string;
  assignedAt?: Dayjs | null;
};

const defaults = (preset: Partial<IpForm> = {}): IpForm => ({
  status: "active",
  role: "other",
  isPrimary: false,
  ...preset,
});

const rackLabel = (rack: {
  code: string;
  location?: string | null;
  uStart?: number;
  uEnd?: number;
}) =>
  `${rack.location ? `${rack.location} / ` : ""}${rack.code}${
    rack.uStart !== undefined && rack.uEnd !== undefined
      ? ` [${rack.uStart}-${rack.uEnd}]U`
      : ""
  }`;

function IpAddressFields({ index }: { index: number }) {
  const form = Form.useFormInstance();
  const { data: options } = useOptions();
  const deviceId = Form.useWatch(["items", index, "deviceId"], form);

  const blockOptions = (options?.ipBlocks ?? []).map((b) => ({
    value: b.id,
    label: b.kind === "range" ? `${b.cidr}（区间）` : b.cidr,
    supplierId: b.supplierId,
  }));
  const deviceOptions = (options?.devices ?? []).map((d) => ({
    value: d.id,
    label: d.name,
    supplierId: d.supplierId,
    rackId: d.rackId,
  }));
  const lineOptions = (options?.lines ?? []).map((l) => ({
    value: l.id,
    label: `${l.code} ${l.name}`,
    supplierId: l.supplierId,
  }));
  const rackOptions = (options?.racks ?? []).map((r) => ({
    value: r.id,
    label: rackLabel(r),
    supplierId: r.supplierId,
  }));

  const fillSupplier = (
    source: { supplierId: string | null } | undefined,
    overwrite = false,
  ) => {
    if (!source?.supplierId) return;
    const current = form.getFieldValue(["items", index, "supplierId"]);
    if (overwrite || !current) {
      form.setFieldValue(["items", index, "supplierId"], source.supplierId);
    }
  };

  return (
    <>
      <Space size={12} style={{ display: "flex" }} align="start">
        <Form.Item
          name={[index, "address"]}
          label="IP 地址"
          rules={[{ required: true, message: "请输入 IP 地址" }]}
          style={{ flex: 1 }}
        >
          <Input className="rm-mono" placeholder="192.168.1.10 或 2001:db8::1" maxLength={100} />
        </Form.Item>
        <Form.Item name={[index, "blockId"]} label="所属网段（可空，自动带出供应商）" style={{ flex: 1 }}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            options={blockOptions}
            onChange={(v: string | undefined) => {
              fillSupplier(blockOptions.find((b) => b.value === v));
            }}
          />
        </Form.Item>
      </Space>
      <Space size={12} style={{ display: "flex" }} align="start">
        <Form.Item name={[index, "status"]} label="状态" style={{ flex: 1 }}>
          <Select options={IP_ADDRESS_STATUS} />
        </Form.Item>
        <Form.Item name={[index, "role"]} label="角色" style={{ flex: 1 }}>
          <Select options={IP_ADDRESS_ROLES} />
        </Form.Item>
        <Form.Item name={[index, "assignedAt"]} label="分配日期" style={{ flex: 1 }}>
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          name={[index, "isPrimary"]}
          label="设备主 IP"
          valuePropName="checked"
          tooltip="勾选后成为该设备的唯一主管理 IP；必须关联设备。"
          style={{ flex: 1 }}
        >
          <Switch
            disabled={!deviceId}
            checkedChildren="主用"
            unCheckedChildren="普通"
          />
        </Form.Item>
      </Space>
      <Space size={12} style={{ display: "flex" }} align="start">
        <Form.Item
          name={[index, "supplierId"]}
          label="供应商"
          rules={[
            {
              validator: async () => {
                const row = form.getFieldValue(["items", index]) as IpForm | undefined;
                if (row?.supplierId) return;
                if (blockOptions.find((b) => b.value === row?.blockId)?.supplierId) return;
                const device = deviceOptions.find((d) => d.value === row?.deviceId);
                if (device?.supplierId) return;
                if (device?.rackId) {
                  const deviceRack = options?.racks.find((r) => r.id === device.rackId);
                  if (deviceRack?.supplierId) return;
                }
                if (rackOptions.find((r) => r.value === row?.rackId)?.supplierId) return;
                if (lineOptions.find((l) => l.value === row?.lineId)?.supplierId) return;
                throw new Error("请选择供应商（或选择已关联供应商的网段/设备/机柜/线路）");
              },
            },
          ]}
          style={{ flex: 1 }}
        >
          <PartySelect kind="supplier" parties={options?.suppliers} />
        </Form.Item>
        <Form.Item name={[index, "rackId"]} label="机柜" style={{ flex: 1 }}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            options={rackOptions}
            onChange={(v: string | undefined) => {
              fillSupplier(rackOptions.find((r) => r.value === v));
            }}
          />
        </Form.Item>
      </Space>
      <Space size={12} style={{ display: "flex" }} align="start">
        <Form.Item name={[index, "deviceId"]} label="设备" style={{ flex: 1 }}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            options={deviceOptions}
            onChange={(v: string | undefined) => {
              const device = deviceOptions.find((d) => d.value === v);
              if (!v) {
                form.setFieldValue(["items", index, "isPrimary"], false);
                return;
              }
              if (device?.rackId) {
                form.setFieldValue(["items", index, "rackId"], device.rackId);
              }
              fillSupplier(device);
            }}
          />
        </Form.Item>
        <Form.Item name={[index, "lineId"]} label="关联线路" style={{ flex: 1 }}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            options={lineOptions}
            onChange={(v: string | undefined) => {
              fillSupplier(lineOptions.find((l) => l.value === v));
            }}
          />
        </Form.Item>
      </Space>
      <Form.Item name={[index, "dnsName"]} label="DNS 名称">
        <Input maxLength={200} />
      </Form.Item>
      <Form.Item name={[index, "description"]} label="描述">
        <Input.TextArea rows={2} maxLength={500} />
      </Form.Item>
    </>
  );
}

export default function IpAddressesPage() {
  const user = useSessionUser();
  const isAdmin = user.role === "ADMIN";
  const { message } = App.useApp();
  const { data: options, mutate: mutateOptions } = useOptions();
  const initial = useInitialParams("keyword,blockId,deviceId,lineId,create");

  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [status, setStatus] = useState<string | undefined>();
  const [role, setRole] = useState<string | undefined>();
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [blockId, setBlockId] = useState<string | undefined>(initial.blockId);
  const [deviceId, setDeviceId] = useState<string | undefined>(initial.deviceId);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const filters = {
    keyword,
    blockId,
    status,
    role,
    supplierId,
    customerId,
    deviceId,
    page,
    pageSize,
  };
  const { data, error, isLoading, mutate } = useSWR<ListResult<IpAddress>>(
    `/api/ip-addresses${buildQuery(filters)}`,
  );

  const [form] = Form.useForm<{ items: IpForm[] }>();
  const [editing, setEditing] = useState<IpAddress | null>(null);
  const [saving, setSaving] = useState(false);
  const [drawerOpenState, setDrawerOpenState] = useState<boolean | undefined>();
  const [createConsumed, setCreateConsumed] = useState(false);
  const drawerOpen = drawerOpenState ?? (initial.create === "1" && !createConsumed);

  const [detail, setDetail] = useState<IpAddress | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const openCreate = (preset: Partial<IpForm> = {}) => {
    setEditing(null);
    setCreateConsumed(true);
    setDrawerOpenState(true);
    form.resetFields();
    form.setFieldsValue({
      items: [
        defaults({
          blockId: initial.blockId ?? null,
          deviceId: initial.deviceId ?? null,
          lineId: initial.lineId ?? null,
          ...preset,
        }),
      ],
    });
  };

  const closeDrawer = () => {
    setCreateConsumed(true);
    setDrawerOpenState(false);
  };

  // 从 IP 段/设备/线路页跳转过来时直接打开新增抽屉。
  useEffect(() => {
    if (initial.create !== "1" || createConsumed) return;
    form.setFieldsValue({
      items: [
        defaults({
          blockId: initial.blockId ?? null,
          deviceId: initial.deviceId ?? null,
          lineId: initial.lineId ?? null,
        }),
      ],
    });
  }, [form, initial, createConsumed]);

  const openEdit = (row: IpAddress) => {
    setEditing(row);
    setCreateConsumed(true);
    form.resetFields();
    form.setFieldsValue({
      items: [
        {
          address: row.address,
          blockId: row.blockId,
          status: row.status,
          role: row.role,
          supplierId: row.supplierId,
          rackId: row.rackId,
          deviceId: row.deviceId,
          lineId: row.lineId,
          isPrimary: row.isPrimary,
          dnsName: row.dnsName ?? undefined,
          description: row.description ?? undefined,
          assignedAt: row.assignedAt ? dayjs(row.assignedAt) : null,
        },
      ],
    });
    setDrawerOpenState(true);
  };

  const openDetail = async (row: IpAddress) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await apiFetch<IpAddress>(`/api/ip-addresses/${row.id}`));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const toPayload = (values: IpForm) => ({
    address: values.address?.trim(),
    blockId: values.blockId ?? null,
    status: values.status,
    role: values.role,
    supplierId: values.supplierId ?? null,
    rackId: values.rackId ?? null,
    deviceId: values.deviceId ?? null,
    lineId: values.lineId ?? null,
    isPrimary: Boolean(values.isPrimary),
    dnsName: values.dnsName?.trim() || null,
    description: values.description?.trim() || null,
    assignedAt: values.assignedAt ? values.assignedAt.format("YYYY-MM-DD") : null,
  });

  const submit = async () => {
    let values: { items: IpForm[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const items = values.items ?? [];
    if (!editing) {
      const seen = new Set<string>();
      for (let i = 0; i < items.length; i += 1) {
        const address = items[i].address?.trim();
        if (!address) continue;
        if (seen.has(address)) {
          message.error(`第 ${i + 1} 条 IP「${address}」在本次提交中重复`);
          return;
        }
        seen.add(address);
      }
    }
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/ip-addresses/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(items[0])),
        });
        message.success("IP 已更新");
      } else {
        const result = await submitBatch(items, async (item) => {
          await apiFetch("/api/ip-addresses", {
            method: "POST",
            body: JSON.stringify(toPayload(item)),
          });
        });
        if (result.ok) {
          message.success(`已新增 ${result.count} 个 IP`);
        } else {
          message.warning(
            `已成功 ${result.successCount} 条，第 ${result.failedIndex + 1} 条失败：${errorMessage(
              result.error,
            )}`,
          );
        }
      }
      closeDrawer();
      await mutate();
      await mutateOptions();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: IpAddress) => {
    try {
      await apiFetch(`/api/ip-addresses/${row.id}`, { method: "DELETE" });
      message.success("IP 已删除");
      await mutate();
      await mutateOptions();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const columns: ColumnsType<IpAddress> = [
    {
      title: "IP 地址",
      dataIndex: "address",
      width: 210,
      render: (_v, row) => (
        <Space size={4}>
          {row.isPrimary ? (
            <StarFilled style={{ color: "#faad14" }} title="设备主管理 IP" />
          ) : null}
          <a className="rm-mono" onClick={() => void openDetail(row)}>
            {row.address}
          </a>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v: string) => (
        <Tag color={colorOf(IP_ADDRESS_STATUS, v)}>{labelOf(IP_ADDRESS_STATUS, v)}</Tag>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 90,
      render: (v: string) => labelOf(IP_ADDRESS_ROLES, v),
    },
    {
      title: "所属网段",
      width: 200,
      render: (_v, row) => (
        <Space size={4}>
          <span className="rm-mono">{row.block?.cidr ?? "—"}</span>
          {row.block?.kind === "range" ? <Tag color="purple">区间</Tag> : null}
        </Space>
      ),
    },
    {
      title: "供应商",
      width: 150,
      render: (_v, row) => row.supplier?.name ?? "—",
    },
    {
      title: "客户",
      width: 150,
      render: (_v, row) => row.customer?.name ?? "—",
    },
    {
      title: "设备 / 线路",
      width: 170,
      render: (_v, row) => (
        <div>
          <div>{row.device?.name ?? "—"}</div>
          <div className="rm-muted">{row.line ? `线路 ${row.line.code}` : "—"}</div>
        </div>
      ),
    },
    {
      title: "机柜",
      width: 160,
      render: (_v, row) => (row.rack ? rackLabel(row.rack) : "—"),
    },
    {
      title: "DNS / 描述",
      render: (_v, row) => (
        <div>
          <div>{row.dnsName ?? "—"}</div>
          <div className="rm-muted">{row.description ?? "—"}</div>
        </div>
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
              title="确认删除该 IP？"
              description="被业务系统端点引用、存在未释放分配或处于有效 IP 区间分配内时无法删除。"
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

  const blockOptions = (options?.ipBlocks ?? []).map((b) => ({
    value: b.id,
    label: b.kind === "range" ? `${b.cidr}（区间）` : b.cidr,
  }));

  return (
    <div>
      <PageHeader
        title="IP 地址管理"
        description="单个 IP 的状态、角色与指派关系；设备主管理 IP 每台设备仅一个，客户归属通过资源分配产生。IP 区间创建时自动生成的地址也在此统一管理。"
        extra={
          <Space wrap>
            <ImportExport
              module="ip-addresses"
              moduleLabel="IP 地址"
              exportQuery={buildQuery({
                keyword,
                blockId,
                status,
                role,
                supplierId,
                customerId,
                deviceId,
              })}
              isAdmin={isAdmin}
              onImported={() => {
                void mutate();
                void mutateOptions();
              }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
              新增 IP
            </Button>
          </Space>
        }
      />

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            placeholder="搜索 IP / DNS / 描述 / 供应商"
            style={{ width: 240 }}
            onSearch={(v) => {
              setKeyword(v);
              setPage(1);
            }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="所属网段"
            style={{ width: 160 }}
            value={blockId}
            onChange={(v) => {
              setBlockId(v);
              setPage(1);
            }}
            options={blockOptions}
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
            options={IP_ADDRESS_STATUS}
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
            options={IP_ADDRESS_ROLES}
          />
          <PartySelect
            kind="supplier"
            parties={options?.suppliers}
            placeholder="供应商"
            style={{ width: 170 }}
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
            style={{ width: 170 }}
            value={customerId}
            onChange={(v) => {
              setCustomerId(v);
              setPage(1);
            }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="设备"
            style={{ width: 160 }}
            value={deviceId}
            onChange={(v) => {
              setDeviceId(v);
              setPage(1);
            }}
            options={(options?.devices ?? []).map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
          刷新
        </Button>
      </div>

      <Table<IpAddress>
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data?.items ?? []}
        columns={columns}
        scroll={{ x: 1390 }}
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
        locale={{ emptyText: error ? errorMessage(error) : "暂无 IP 地址" }}
      />

      <CrudDrawer
        open={drawerOpen}
        title={editing ? `编辑 IP：${editing.address}` : "批量新增 IP 地址"}
        onClose={closeDrawer}
        onSave={() => void submit()}
        saving={saving}
        width={860}
      >
        <Form<{ items: IpForm[] }> form={form} layout="vertical" requiredMark>
          {editing && editing.supplierId === null ? (
            <div className="rm-muted" style={{ marginBottom: 12 }}>
              该历史 IP 尚未关联供应商，请补全后保存。
            </div>
          ) : null}
          <BatchEntryList
            form={form}
            batch={!editing}
            defaultItem={defaults()}
            renderItem={(field) => <IpAddressFields index={field.name} />}
          />
        </Form>
      </CrudDrawer>

      <Drawer
        open={detailOpen}
        title={detail ? `IP 详情：${detail.address}` : "IP 详情"}
        width={640}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading && !detail}
      >
        {detail ? (
          <>
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="状态">
                {labelOf(IP_ADDRESS_STATUS, detail.status)}
              </Descriptions.Item>
              <Descriptions.Item label="角色">
                {labelOf(IP_ADDRESS_ROLES, detail.role)}
              </Descriptions.Item>
              <Descriptions.Item label="所属网段">
                <Space size={4}>
                  <span className="rm-mono">{detail.block?.cidr ?? "—"}</span>
                  {detail.block?.kind === "range" ? <Tag color="purple">区间</Tag> : null}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="设备主 IP">{detail.isPrimary ? "是" : "否"}</Descriptions.Item>
              <Descriptions.Item label="供应商">{detail.supplier?.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="客户">{detail.customer?.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="机柜">
                {detail.rack ? rackLabel(detail.rack) : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="设备">{detail.device?.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="线路" span={2}>
                {detail.line ? `${detail.line.code} ${detail.line.name ?? ""}` : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="DNS">{detail.dnsName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="分配日期">{detail.assignedAt ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="描述" span={2}>
                {detail.description ?? "—"}
              </Descriptions.Item>
            </Descriptions>
            <Typography.Title level={5}>业务系统端点（{detail.endpoints?.length ?? 0}）</Typography.Title>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.endpoints ?? []}
              locale={{ emptyText: "暂无端点引用" }}
              columns={[
                { title: "业务系统", render: (_v, e) => e.system.name },
                { title: "协议", dataIndex: "protocol", width: 90 },
                { title: "端口", dataIndex: "port", width: 90, render: (v) => <Maybe value={v} /> },
                {
                  title: "主端点",
                  dataIndex: "isPrimary",
                  width: 90,
                  render: (v: boolean) => (v ? <Tag color="blue">主</Tag> : "—"),
                },
              ]}
            />
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
