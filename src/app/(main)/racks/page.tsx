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
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
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
import { PartySelect } from "@/components/PartySelect";
import { RackElevation } from "@/components/RackElevation";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { Maybe } from "@/components/Tags";
import { BatchEntryList } from "@/components/batch/BatchEntryList";
import { submitBatch } from "@/components/batch/submitBatch";
import { useOptions } from "@/components/OptionsProvider";
import { useSessionUser } from "@/components/SessionContext";
import { useInitialParams } from "@/components/useInitialParams";
import { apiFetch, buildQuery, errorMessage } from "@/lib/client";
import { DEVICE_STATUS, RACK_STATUS, labelOf } from "@/lib/enums";
import { rangesOverlap } from "@/lib/ranges";
import type { Device, ListResult, Rack } from "@/lib/types";

type RackAllocation = NonNullable<Rack["allocations"]>[number];

type RackForm = {
  code: string;
  location?: string;
  status: string;
  width: number;
  uStart: number;
  uEnd: number;
  power?: string;
  serial?: string;
  supplierId?: string | null;
  notes?: string;
};

const defaults = (): RackForm => ({
  code: "",
  status: "active",
  width: 19,
  uStart: 1,
  uEnd: 42,
});

function toForm(row: Rack): RackForm {
  return {
    code: row.code,
    location: row.location ?? undefined,
    status: row.status,
    width: row.width,
    uStart: row.uStart,
    uEnd: row.uEnd,
    power: row.power ?? undefined,
    serial: row.serial ?? undefined,
    supplierId: row.supplierId,
    notes: row.notes ?? undefined,
  };
}

function toPayload(item: RackForm) {
  return {
    ...item,
    code: item.code.trim(),
    location: item.location?.trim() || null,
    power: item.power?.trim() || null,
    serial: item.serial?.trim() || null,
    supplierId: item.supplierId || null,
    notes: item.notes?.trim() || null,
  };
}

export default function RacksPage() {
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

  const filters = { keyword, status, supplierId, customerId, page, pageSize };
  const { data, error, isLoading, mutate } = useSWR<ListResult<Rack>>(
    `/api/racks${buildQuery(filters)}`,
  );

  const [form] = Form.useForm<{ items: RackForm[] }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Rack | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Rack | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ items: [defaults()] });
    setDrawerOpen(true);
  };

  const openEdit = (row: Rack) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({ items: [toForm(row)] });
    setDrawerOpen(true);
  };

  const openDetail = async (row: Rack) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await apiFetch<Rack>(`/api/racks/${row.id}`));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const submit = async () => {
    let values: { items: RackForm[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const items = values.items ?? [];
    if (!editing) {
      const byCode = new Map<
        string,
        Array<{ index: number; uStart: number; uEnd: number }>
      >();
      for (let i = 0; i < items.length; i += 1) {
        const code = items[i].code?.trim();
        if (!code) continue;
        const item = {
          index: i,
          uStart: Number(items[i].uStart),
          uEnd: Number(items[i].uEnd),
        };
        const siblings = byCode.get(code) ?? [];
        const conflict = siblings.find((other) =>
          rangesOverlap(item.uStart, item.uEnd, other.uStart, other.uEnd),
        );
        if (conflict) {
          message.error(
            `第 ${conflict.index + 1} 条与第 ${i + 1} 条机柜编号「${code}」的 U 区间重叠`,
          );
          return;
        }
        siblings.push(item);
        byCode.set(code, siblings);
      }
    }
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/racks/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(items[0])),
        });
        message.success("机柜已更新");
      } else {
        const result = await submitBatch(items, async (item) => {
          await apiFetch("/api/racks", {
            method: "POST",
            body: JSON.stringify(toPayload(item)),
          });
        });
        if (result.ok) {
          message.success(`已新增 ${result.count} 台机柜`);
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

  const remove = async (row: Rack) => {
    try {
      await apiFetch(`/api/racks/${row.id}`, { method: "DELETE" });
      message.success("机柜已删除");
      await mutate();
      await mutateOptions();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const columns: ColumnsType<Rack> = [
    {
      title: "机柜编号",
      dataIndex: "code",
      render: (_v, row) => <a onClick={() => void openDetail(row)}>{row.code}</a>,
    },
    { title: "位置", dataIndex: "location", width: 160, render: (v) => <Maybe value={v} /> },
    {
      title: "规格",
      width: 170,
      render: (_v, row) => (
        <Space size={4}>
          <Tag>{row.width}″</Tag>
          <Tag>
            {row.uStart}-{row.uEnd}U
          </Tag>
        </Space>
      ),
    },
    {
      title: "使用率",
      width: 180,
      render: (_v, row) => {
        const used = row.occupiedU ?? 0;
        const capacity = row.uEnd - row.uStart + 1;
        const percent = capacity > 0 ? Math.round((used / capacity) * 100) : 0;
        return (
          <Progress
            percent={percent}
            size="small"
            format={() => `${used}/${capacity}U`}
            status={percent >= 90 ? "exception" : "normal"}
          />
        );
      },
    },
    {
      title: "供应商",
      width: 150,
      render: (_v, row) => <Maybe value={row.supplier?.name} />,
    },
    {
      title: "客户",
      width: 150,
      render: (_v, row) => {
        const names = row.customerNames ?? [];
        if (!row.customerSummary) return "—";
        return names.length > 1 ? (
          <Tooltip title={names.join("、")}>
            <span>{row.customerSummary}</span>
          </Tooltip>
        ) : (
          row.customerSummary
        );
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v: string) => (
        <Tag
          color={
            v === "active" ? "green" : v === "planned" ? "blue" : v === "reserved" ? "orange" : "default"
          }
        >
          {labelOf(RACK_STATUS, v)}
        </Tag>
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
              title="确认删除该机柜？"
              description="机柜内仍有设备、IP 或线路端点时无法删除。"
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
        title="机柜管理"
        description="一条记录代表物理机柜的一段 U 区间；同编号可拆分多条记录，区间不能重叠。"
        extra={
          <Space wrap>
            <ImportExport
              module="racks"
              moduleLabel="机柜"
              exportQuery={buildQuery({ keyword, status, supplierId, customerId })}
              isAdmin={isAdmin}
              onImported={() => {
                void mutate();
                void mutateOptions();
              }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增机柜
            </Button>
          </Space>
        }
      />

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            placeholder="搜索编号 / 位置 / 序列号 / 供应商 / 客户"
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
            options={RACK_STATUS}
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

      <Table<Rack>
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
        locale={{ emptyText: error ? errorMessage(error) : "暂无机柜" }}
      />

      <CrudDrawer
        open={drawerOpen}
        width={820}
        title={editing ? `编辑机柜：${editing.code}` : "批量新增机柜"}
        onClose={() => setDrawerOpen(false)}
        onSave={() => void submit()}
        saving={saving}
      >
        <Form<{ items: RackForm[] }> form={form} layout="vertical" requiredMark>
          <Typography.Paragraph type="secondary">
            一条记录代表一个 U 区间。同一机柜编号可拆分多条记录（如 A10 的 [1-2]U 与 [3-4]U），
            同编号记录的区间不能重叠。
          </Typography.Paragraph>
          {editing && editing.supplierId === null ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="该历史机柜尚未关联供应商，请补全后保存。"
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
                    name={[field.name, "code"]}
                    label="机柜编号"
                    rules={[{ required: true, message: "请输入机柜编号" }]}
                    style={{ flex: 1 }}
                  >
                    <Input maxLength={50} />
                  </Form.Item>
                  <Form.Item name={[field.name, "location"]} label="位置" style={{ flex: 1 }}>
                    <Input maxLength={100} placeholder="如：A 排东侧" />
                  </Form.Item>
                  <Form.Item name={[field.name, "status"]} label="状态" style={{ width: 120 }}>
                    <Select options={RACK_STATUS} />
                  </Form.Item>
                </Space>
                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "width"]} label="宽度" style={{ width: 140 }}>
                    <Select
                      options={[
                        { value: 19, label: "19 英寸" },
                        { value: 23, label: "23 英寸" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "uStart"]}
                    label="起始 U 位"
                    rules={[{ required: true, message: "请输入起始 U 位" }]}
                    style={{ width: 120 }}
                  >
                    <InputNumber min={1} max={100} precision={0} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "uEnd"]}
                    label="结束 U 位"
                    rules={[
                      { required: true, message: "请输入结束 U 位" },
                      {
                        validator: async (_, value) => {
                          const start = form.getFieldValue(["items", field.name, "uStart"]);
                          if (
                            value !== undefined &&
                            value !== null &&
                            start !== undefined &&
                            start !== null &&
                            Number(value) < Number(start)
                          ) {
                            throw new Error("结束 U 位不能小于起始 U 位");
                          }
                        },
                      },
                    ]}
                    style={{ width: 120 }}
                  >
                    <InputNumber min={1} max={100} precision={0} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name={[field.name, "power"]} label="供电" style={{ flex: 1 }}>
                    <Input maxLength={50} />
                  </Form.Item>
                  <Form.Item name={[field.name, "serial"]} label="序列号" style={{ flex: 1 }}>
                    <Input maxLength={100} />
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
        title={
          detail
            ? `机柜详情：${detail.location ? `${detail.location} / ` : ""}${detail.code}`
            : "机柜详情"
        }
        width={860}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading && !detail}
      >
        {detail ? (
          <>
            <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="U 区间">
                {detail.uStart}-{detail.uEnd}U
              </Descriptions.Item>
              <Descriptions.Item label="区间容量">{detail.uEnd - detail.uStart + 1}U</Descriptions.Item>
              <Descriptions.Item label="宽度">{detail.width} 英寸</Descriptions.Item>
              <Descriptions.Item label="状态">{labelOf(RACK_STATUS, detail.status)}</Descriptions.Item>
              <Descriptions.Item label="已用前面板">{detail.usedUFront ?? 0}U</Descriptions.Item>
              <Descriptions.Item label="已用后面板">{detail.usedURear ?? 0}U</Descriptions.Item>
              <Descriptions.Item label="占用 U 位">{detail.occupiedU ?? 0}U</Descriptions.Item>
              <Descriptions.Item label="供应商">{detail.supplier?.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="客户">{detail.customerSummary ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="位置">{detail.location ?? "—"}</Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5}>U 位图</Typography.Title>
            <RackElevation rackId={detail.id} />

            <Typography.Title level={5} style={{ marginTop: 18 }}>
              当前分配（{detail.allocations?.length ?? 0}）
            </Typography.Title>
            <Table<RackAllocation>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.allocations ?? []}
              locale={{ emptyText: "暂无有效分配" }}
              columns={[
                {
                  title: "客户",
                  render: (_v, allocation) => allocation.customer?.name ?? "—",
                },
                {
                  title: "U 区间",
                  width: 120,
                  render: (_v, allocation) =>
                    allocation.uStart !== null && allocation.uEnd !== null
                      ? `${allocation.uStart}-${allocation.uEnd}U`
                      : "—",
                },
                {
                  title: "分配日期",
                  dataIndex: "allocatedAt",
                  width: 130,
                  render: (value: string) => value.slice(0, 10),
                },
                {
                  title: "备注",
                  dataIndex: "notes",
                  render: (value: string | null) => value ?? "—",
                },
              ]}
            />

            <Typography.Title level={5} style={{ marginTop: 18 }}>
              设备（{detail.devices?.length ?? 0}）
            </Typography.Title>
            <Table<Device>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.devices ?? []}
              locale={{ emptyText: "暂无设备" }}
              columns={[
                { title: "设备名称", dataIndex: "name" },
                {
                  title: "U 位",
                  width: 120,
                  render: (_v, d) =>
                    d.uStart
                      ? `${d.uStart}-${d.uStart + d.uHeight - 1}U（${d.face === "front" ? "前" : "后"}）`
                      : "—",
                },
                {
                  title: "类型",
                  dataIndex: "type",
                  width: 100,
                  render: (v: string) => {
                    const map: Record<string, string> = {
                      router: "路由器",
                      switch: "交换机",
                      firewall: "防火墙",
                      ap: "无线 AP",
                      other: "其他",
                    };
                    return map[v] ?? v;
                  },
                },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 100,
                  render: (v: string) => <Tag>{labelOf(DEVICE_STATUS, v)}</Tag>,
                },
              ]}
            />
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
