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
import { ImportExport } from "@/components/ImportExport";
import { LineTerminationsEditor, type TerminationFormValue } from "@/components/LineTerminationsEditor";
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
  IP_ADDRESS_STATUS,
  LINE_STATUS,
  LINE_TYPES,
  colorOf,
  labelOf,
} from "@/lib/enums";
import type { IpAddress, Line, LineTermination, ListResult } from "@/lib/types";

type LineForm = {
  code: string;
  name: string;
  type: string;
  status: string;
  supplierId?: string | null;
  bandwidthMbps?: number | null;
  monthlyFeeYuan?: number | null;
  circuitNo?: string;
  installDate?: Dayjs | null;
  expireDate?: Dayjs | null;
  description?: string;
  terminations?: TerminationFormValue[];
};

function formatBandwidth(mbps: number | null): string {
  if (mbps === null || mbps === undefined) return "—";
  if (mbps >= 1000) return `${Number((mbps / 1000).toFixed(2))} Gbps`;
  return `${mbps} Mbps`;
}

function formatFee(cents: number | null): string {
  if (cents === null || cents === undefined) return "—";
  return `¥${(cents / 100).toFixed(2)}`;
}

function endpointText(t: LineTermination | undefined): string {
  if (!t) return "—";
  const rack = t.rack
    ? `${t.rack.location ? `${t.rack.location} / ` : ""}${t.rack.code}${
        t.rack.uStart !== undefined && t.rack.uEnd !== undefined
          ? ` [${t.rack.uStart}-${t.rack.uEnd}]U`
          : ""
      }`
    : null;
  const parts = [rack, t.device?.name, t.port].filter(Boolean);
  return parts.length ? parts.join(" / ") : "已填写";
}

const defaults = (): LineForm => ({
  code: "",
  name: "",
  type: "internet",
  status: "active",
  terminations: [{ side: "A" }],
});

export default function LinesPage() {
  const user = useSessionUser();
  const isAdmin = user.role === "ADMIN";
  const { message } = App.useApp();
  const { data: options, mutate: mutateOptions } = useOptions();
  const initial = useInitialParams("keyword,expiring,supplierId,customerId");
  const today = todayStr();
  const expireCutoff = addDays(today, 30);

  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [type, setType] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [supplierId, setSupplierId] = useState<string | undefined>(initial.supplierId);
  const [customerId, setCustomerId] = useState<string | undefined>(initial.customerId);
  const [expiringOnly, setExpiringOnly] = useState(initial.expiring === "1");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const filters = {
    keyword,
    type,
    status,
    supplierId,
    customerId,
    expireBefore: expiringOnly ? expireCutoff : undefined,
    page,
    pageSize,
  };
  const { data, error, isLoading, mutate } = useSWR<ListResult<Line>>(
    `/api/lines${buildQuery(filters)}`,
  );

  const [form] = Form.useForm<{ items: LineForm[] }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Line | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<Line | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ items: [defaults()] });
    setDrawerOpen(true);
  };

  const toForm = (row: Line): LineForm => ({
    code: row.code,
    name: row.name,
    type: row.type,
    status: row.status,
    supplierId: row.supplierId,
    bandwidthMbps: row.bandwidthMbps,
    monthlyFeeYuan:
      row.monthlyFeeCents === null || row.monthlyFeeCents === undefined
        ? null
        : row.monthlyFeeCents / 100,
    circuitNo: row.circuitNo ?? undefined,
    installDate: row.installDate ? dayjs(row.installDate) : null,
    expireDate: row.expireDate ? dayjs(row.expireDate) : null,
    description: row.description ?? undefined,
    terminations: (row.terminations ?? []).map((t) => ({
      side: t.side,
      rackId: t.rackId,
      deviceId: t.deviceId,
      port: t.port ?? undefined,
      description: t.description ?? undefined,
    })),
  });

  const openEdit = (row: Line) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({ items: [toForm(row)] });
    setDrawerOpen(true);
  };

  const openDetail = async (row: Line) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await apiFetch<Line>(`/api/lines/${row.id}`));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const toPayload = (values: LineForm) => ({
    code: values.code.trim(),
    name: values.name.trim(),
    type: values.type,
    status: values.status,
    supplierId: values.supplierId ?? null,
    bandwidthMbps: values.bandwidthMbps ?? null,
    monthlyFeeCents:
      values.monthlyFeeYuan === null || values.monthlyFeeYuan === undefined
        ? null
        : Math.round(values.monthlyFeeYuan * 100),
    circuitNo: values.circuitNo?.trim() || null,
    installDate: values.installDate ? values.installDate.format("YYYY-MM-DD") : null,
    expireDate: values.expireDate ? values.expireDate.format("YYYY-MM-DD") : null,
    description: values.description?.trim() || null,
    terminations: (values.terminations ?? []).map((t) => ({
      side: t.side,
      rackId: t.rackId ?? null,
      deviceId: t.deviceId ?? null,
      port: t.port?.trim() || null,
      description: t.description?.trim() || null,
    })),
  });

  const submit = async () => {
    let values: { items: LineForm[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const items = values.items ?? [];
    if (!editing) {
      const seen = new Set<string>();
      for (let i = 0; i < items.length; i += 1) {
        const code = items[i].code?.trim();
        if (!code) continue;
        if (seen.has(code)) {
          message.error(`第 ${i + 1} 条线路编号「${code}」在本次提交中重复`);
          return;
        }
        seen.add(code);
      }
    }
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/lines/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(items[0])),
        });
        message.success("线路已更新");
      } else {
        const result = await submitBatch(items, async (item) => {
          await apiFetch("/api/lines", {
            method: "POST",
            body: JSON.stringify(toPayload(item)),
          });
        });
        if (result.ok) {
          message.success(`已新增 ${result.count} 条线路`);
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

  const remove = async (row: Line) => {
    try {
      await apiFetch(`/api/lines/${row.id}`, { method: "DELETE" });
      message.success("线路已删除");
      await mutate();
      await mutateOptions();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const columns: ColumnsType<Line> = [
    {
      title: "线路编号 / 名称",
      width: 200,
      render: (_v, row) => (
        <div>
          <a className="rm-mono" onClick={() => void openDetail(row)}>
            {row.code}
          </a>
          <div className="rm-muted">{row.name}</div>
        </div>
      ),
    },
    {
      title: "类型",
      dataIndex: "type",
      width: 100,
      render: (v: string) => labelOf(LINE_TYPES, v),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v: string) => (
        <Tag color={colorOf(LINE_STATUS, v)}>{labelOf(LINE_STATUS, v)}</Tag>
      ),
    },
    { title: "供应商", width: 160, render: (_v, row) => row.supplier?.name ?? "—" },
    { title: "客户", width: 140, render: (_v, row) => row.customer?.name ?? "—" },
    {
      title: "带宽 / 月租",
      width: 130,
      render: (_v, row) => (
        <div>
          <div>{formatBandwidth(row.bandwidthMbps)}</div>
          <div className="rm-muted">{formatFee(row.monthlyFeeCents)}</div>
        </div>
      ),
    },
    {
      title: "A / Z 端",
      width: 240,
      render: (_v, row) => {
        const a = row.terminations?.find((t) => t.side === "A");
        const z = row.terminations?.find((t) => t.side === "Z");
        return (
          <div>
            <div>
              <Tag>A</Tag>
              {endpointText(a)}
            </div>
            <div>
              <Tag>Z</Tag>
              {endpointText(z)}
            </div>
          </div>
        );
      },
    },
    {
      title: "到期日",
      width: 130,
      render: (_v, row) => {
        if (!row.expireDate) return "—";
        const left = diffDays(today, row.expireDate);
        return (
          <div>
            <span className={left < 0 ? "rm-danger" : left <= 30 ? "rm-warn" : ""}>
              {row.expireDate}
            </span>
            <div className="rm-muted">
              {left < 0 ? `已过期 ${-left} 天` : `剩余 ${left} 天`}
            </div>
          </div>
        );
      },
    },
    {
      title: "关联 IP",
      width: 80,
      render: (_v, row) => row._count?.ipAddresses ?? 0,
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
              title="确认删除该线路？"
              description="仍有关联 IP 或宽带时无法删除。"
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
        title="线路管理"
        description="线路主数据与 A/Z 端结构化落位；月租以元填写、数据库按分存储，到期前 30 天高亮提醒。"
        extra={
          <Space wrap>
            <ImportExport
              module="lines"
              moduleLabel="线路"
              exportQuery={buildQuery({
                keyword,
                type,
                status,
                supplierId,
                customerId,
                expireBefore: expiringOnly ? expireCutoff : undefined,
              })}
              isAdmin={isAdmin}
              onImported={() => {
                void mutate();
                void mutateOptions();
              }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增线路
            </Button>
          </Space>
        }
      />

      {expiringOnly ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message={`当前只显示到期日在 ${expireCutoff} 之前（未来 30 天内到期或已过期）的线路。`}
          action={
            <Button size="small" onClick={() => setExpiringOnly(false)}>
              清除筛选
            </Button>
          }
        />
      ) : null}

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            placeholder="搜索编号 / 名称 / 电路号 / 端点"
            style={{ width: 260 }}
            onSearch={(v) => {
              setKeyword(v);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="类型"
            style={{ width: 120 }}
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            options={LINE_TYPES}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 120 }}
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={LINE_STATUS}
          />
          <PartySelect
            kind="supplier"
            parties={options?.suppliers}
            placeholder="供应商"
            style={{ width: 175 }}
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
            style={{ width: 175 }}
            value={customerId}
            onChange={(v) => {
              setCustomerId(v);
              setPage(1);
            }}
          />
          <Button
            type={expiringOnly ? "primary" : "default"}
            danger={expiringOnly}
            onClick={() => {
              setExpiringOnly((v) => !v);
              setPage(1);
            }}
          >
            30 天内到期
          </Button>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
          刷新
        </Button>
      </div>

      <Table<Line>
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data?.items ?? []}
        columns={columns}
        scroll={{ x: 1350 }}
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
        locale={{ emptyText: error ? errorMessage(error) : "暂无线路" }}
      />

      <CrudDrawer
        open={drawerOpen}
        title={editing ? `编辑线路：${editing.code}` : "批量新增线路"}
        onClose={() => setDrawerOpen(false)}
        onSave={() => void submit()}
        saving={saving}
        width={860}
      >
        <Form<{ items: LineForm[] }> form={form} layout="vertical" requiredMark>
          {editing && editing.supplierId === null ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="该历史线路尚未关联供应商，请补全后保存。"
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
                    label="线路编号"
                    rules={[{ required: true, message: "请输入线路编号" }]}
                    style={{ flex: 1 }}
                  >
                    <Input maxLength={100} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "name"]}
                    label="线路名称"
                    rules={[{ required: true, message: "请输入线路名称" }]}
                    style={{ flex: 2 }}
                  >
                    <Input maxLength={100} />
                  </Form.Item>
                </Space>

                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "type"]} label="类型" style={{ flex: 1 }}>
                    <Select options={LINE_TYPES} />
                  </Form.Item>
                  <Form.Item name={[field.name, "status"]} label="状态" style={{ flex: 1 }}>
                    <Select options={LINE_STATUS} />
                  </Form.Item>
                  <Form.Item name={[field.name, "bandwidthMbps"]} label="带宽（Mbps）" style={{ flex: 1 }}>
                    <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name={[field.name, "monthlyFeeYuan"]} label="月租（元）" style={{ flex: 1 }}>
                    <InputNumber min={0} precision={2} style={{ width: "100%" }} />
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
                  <Form.Item name={[field.name, "circuitNo"]} label="电路号" style={{ flex: 1 }}>
                    <Input maxLength={100} />
                  </Form.Item>
                  <Form.Item name={[field.name, "installDate"]} label="开通日期" style={{ flex: 1 }}>
                    <DatePicker style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name={[field.name, "expireDate"]} label="到期日期" style={{ flex: 1 }}>
                    <DatePicker style={{ width: "100%" }} />
                  </Form.Item>
                </Space>

                <Typography.Title level={5} style={{ marginTop: 4 }}>
                  A / Z 端点
                </Typography.Title>
                <LineTerminationsEditor path={[field.name]} />

                <Form.Item name={[field.name, "description"]} label="描述">
                  <Input.TextArea rows={2} maxLength={1000} />
                </Form.Item>
              </>
            )}
          />
        </Form>
      </CrudDrawer>

      <Drawer
        open={detailOpen}
        title={detail ? `线路详情：${detail.code} ${detail.name}` : "线路详情"}
        width={780}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading && !detail}
      >
        {detail ? (
          <>
            <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="类型">{labelOf(LINE_TYPES, detail.type)}</Descriptions.Item>
              <Descriptions.Item label="状态">{labelOf(LINE_STATUS, detail.status)}</Descriptions.Item>
              <Descriptions.Item label="电路号">
                <Maybe value={detail.circuitNo} />
              </Descriptions.Item>
              <Descriptions.Item label="供应商">{detail.supplier?.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="客户">{detail.customer?.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="带宽">{formatBandwidth(detail.bandwidthMbps)}</Descriptions.Item>
              <Descriptions.Item label="月租">{formatFee(detail.monthlyFeeCents)}</Descriptions.Item>
              <Descriptions.Item label="开通日期">
                <Maybe value={detail.installDate} />
              </Descriptions.Item>
              <Descriptions.Item label="到期日期">
                <Maybe value={detail.expireDate} />
              </Descriptions.Item>
              <Descriptions.Item label="描述" span={3}>
                {detail.description ?? "—"}
              </Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5}>A / Z 端点（{detail.terminations?.length ?? 0}）</Typography.Title>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.terminations ?? []}
              locale={{ emptyText: "暂无端点" }}
              columns={[
                { title: "端", dataIndex: "side", width: 70, render: (v: string) => `${v} 端` },
                { title: "位置", render: (_v, t) => t.rack?.location ?? "—" },
                {
                  title: "机柜",
                  render: (_v, t) =>
                    t.rack
                      ? `${t.rack.code} [${t.rack.uStart ?? "?"}-${t.rack.uEnd ?? "?"}]U`
                      : "—",
                },
                { title: "设备", render: (_v, t) => t.device?.name ?? "—" },
                { title: "端口", dataIndex: "port", width: 100, render: (v) => <Maybe value={v} /> },
                { title: "说明", dataIndex: "description", render: (v) => <Maybe value={v} /> },
              ]}
            />

            <Typography.Title level={5} style={{ marginTop: 18 }}>
              关联 IP（{detail.ipAddresses?.length ?? 0}）
            </Typography.Title>
            <Table<IpAddress>
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
                {
                  title: "主 IP",
                  dataIndex: "isPrimary",
                  width: 80,
                  render: (v: boolean) => (v ? <Tag color="gold">主</Tag> : "—"),
                },
              ]}
            />
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
