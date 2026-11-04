"use client";

import { useState } from "react";
import useSWR from "swr";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  App,
  Button,
  Collapse,
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
import { BroadbandReuseChart } from "@/components/BroadbandReuseChart";
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
import { addDays, diffDays, todayStr } from "@/lib/dates";
import { BROADBAND_STATUS, colorOf, labelOf } from "@/lib/enums";
import type { Broadband, ListResult } from "@/lib/types";

type BroadbandForm = {
  name: string;
  supplierId?: string | null;
  bandwidthMbps?: number | null;
  status: string;
  expireDate?: Dayjs | null;
  account?: string;
  password?: string;
  installAddress?: string;
  rackId?: string | null;
  deviceId?: string | null;
  lineId?: string | null;
  ipAddressId?: string | null;
  monthlyFeeYuan?: number | null;
  contractNo?: string;
  description?: string;
  notes?: string;
};

const defaults = (): BroadbandForm => ({ name: "", status: "active" });

function formatFee(cents: number | null): string {
  if (cents === null || cents === undefined) return "—";
  return `¥${(cents / 100).toFixed(2)}`;
}

export default function BroadbandsPage() {
  const user = useSessionUser();
  const isAdmin = user.role === "ADMIN";
  const { message } = App.useApp();
  const { data: options, mutate: mutateOptions } = useOptions();
  const initial = useInitialParams("keyword,supplierId,customerId");
  const today = todayStr();
  const expireCutoff = addDays(today, 30);

  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [status, setStatus] = useState<string | undefined>();
  const [supplierId, setSupplierId] = useState<string | undefined>(initial.supplierId);
  const [customerId, setCustomerId] = useState<string | undefined>(initial.customerId);
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const filters = {
    keyword,
    status,
    supplierId,
    customerId,
    expireBefore: expiringOnly ? expireCutoff : undefined,
    page,
    pageSize,
  };
  const { data, error, isLoading, mutate } = useSWR<ListResult<Broadband>>(
    `/api/broadbands${buildQuery(filters)}`,
  );

  const [form] = Form.useForm<{ items: BroadbandForm[] }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Broadband | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<Broadband | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ items: [defaults()] });
    setDrawerOpen(true);
  };

  const toForm = (row: Broadband): BroadbandForm => ({
    name: row.name,
    supplierId: row.supplierId,
    bandwidthMbps: row.bandwidthMbps,
    status: row.status,
    expireDate: row.expireDate ? dayjs(row.expireDate) : null,
    account: row.account ?? undefined,
    password: row.password ?? undefined,
    installAddress: row.installAddress ?? undefined,
    rackId: row.rackId,
    deviceId: row.deviceId,
    lineId: row.lineId,
    ipAddressId: row.ipAddressId,
    monthlyFeeYuan:
      row.monthlyFeeCents === null || row.monthlyFeeCents === undefined
        ? null
        : row.monthlyFeeCents / 100,
    contractNo: row.contractNo ?? undefined,
    description: row.description ?? undefined,
    notes: row.notes ?? undefined,
  });

  const openEdit = (row: Broadband) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({ items: [toForm(row)] });
    setDrawerOpen(true);
  };

  const openDetail = async (row: Broadband) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await apiFetch<Broadband>(`/api/broadbands/${row.id}`));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const toPayload = (values: BroadbandForm) => ({
    name: values.name.trim(),
    supplierId: values.supplierId || null,
    bandwidthMbps: values.bandwidthMbps ?? null,
    status: values.status,
    expireDate: values.expireDate ? values.expireDate.format("YYYY-MM-DD") : null,
    account: values.account?.trim() || null,
    password: values.password?.trim() || null,
    installAddress: values.installAddress?.trim() || null,
    rackId: values.rackId ?? null,
    deviceId: values.deviceId ?? null,
    lineId: values.lineId ?? null,
    ipAddressId: values.ipAddressId ?? null,
    monthlyFeeCents:
      values.monthlyFeeYuan === null || values.monthlyFeeYuan === undefined
        ? null
        : Math.round(values.monthlyFeeYuan * 100),
    contractNo: values.contractNo?.trim() || null,
    description: values.description?.trim() || null,
    notes: values.notes?.trim() || null,
  });

  const submit = async () => {
    let values: { items: BroadbandForm[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const items = values.items ?? [];
    if (!editing) {
      const seen = new Set<string>();
      for (let i = 0; i < items.length; i += 1) {
        const name = items[i].name?.trim();
        if (!name) continue;
        if (seen.has(name)) {
          message.error(`第 ${i + 1} 条宽带名称「${name}」在本次提交中重复`);
          return;
        }
        seen.add(name);
      }
    }
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/broadbands/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(items[0])),
        });
        message.success("宽带已更新");
      } else {
        const result = await submitBatch(items, async (item) => {
          await apiFetch("/api/broadbands", {
            method: "POST",
            body: JSON.stringify(toPayload(item)),
          });
        });
        if (result.ok) {
          message.success(`已新增 ${result.count} 条宽带`);
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

  const remove = async (row: Broadband) => {
    try {
      await apiFetch(`/api/broadbands/${row.id}`, { method: "DELETE" });
      message.success("宽带已删除");
      await mutate();
      await mutateOptions();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const columns: ColumnsType<Broadband> = [
    {
      title: "名称 / 编号",
      dataIndex: "name",
      width: 180,
      render: (_v, row) => <a onClick={() => void openDetail(row)}>{row.name}</a>,
    },
    { title: "供应商", width: 160, render: (_v, row) => row.supplier?.name ?? "—" },
    {
      title: "客户",
      width: 150,
      render: (_v, row) =>
        row.customerSummary ? (
          <Tooltip
            title={row.customerNames?.length ? row.customerNames.join("、") : undefined}
          >
            {row.customerSummary}
          </Tooltip>
        ) : (
          "—"
        ),
    },
    {
      title: "带宽",
      dataIndex: "bandwidthMbps",
      width: 110,
      render: (v: number | null) => (v === null || v === undefined ? "—" : `${v} Mbps`),
    },
    {
      title: "已分配",
      width: 105,
      render: (_v, row) => `${row.allocatedMbps ?? 0} Mbps`,
    },
    {
      title: "复用率",
      width: 100,
      render: (_v, row) => {
        const reuse = row.reusePercent;
        if (reuse === null || reuse === undefined) return "—";
        return (
          <span className={reuse > 100 ? "rm-danger" : undefined}>
            {reuse.toFixed(1)}%
          </span>
        );
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v: string) => (
        <Tag color={colorOf(BROADBAND_STATUS, v)}>{labelOf(BROADBAND_STATUS, v)}</Tag>
      ),
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
      title: "安装地址",
      dataIndex: "installAddress",
      width: 200,
      render: (v) => <Maybe value={v} />,
    },
    {
      title: "关联资源",
      width: 220,
      render: (_v, row) => (
        <div className="rm-muted" style={{ fontSize: 12 }}>
          <div>机柜：{row.rack ? `${row.rack.location ? `${row.rack.location} / ` : ""}${row.rack.code}` : "—"}</div>
          <div>设备：{row.device?.name ?? "—"}　线路：{row.line?.code ?? "—"}</div>
          <div>IP：{row.ipAddress?.address ?? "—"}</div>
        </div>
      ),
    },
    { title: "月费", width: 100, render: (_v, row) => formatFee(row.monthlyFeeCents) },
    { title: "合同号", width: 140, render: (_v, row) => <Maybe value={row.contractNo} /> },
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
              title="确认删除该宽带？"
              description="有未释放分配时无法删除。"
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
        title="宽带管理"
        description="宽带链路、账号与安装信息；供应商必填，到期前 30 天高亮提醒。"
        extra={
          <Space wrap>
            <ImportExport
              module="broadbands"
              moduleLabel="宽带"
              exportQuery={buildQuery(filters)}
              isAdmin={isAdmin}
              onImported={() => {
                void mutate();
                void mutateOptions();
              }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增宽带
            </Button>
          </Space>
        }
      />

      <Collapse
        style={{ marginBottom: 14 }}
        defaultActiveKey={["reuse"]}
        items={[
          {
            key: "reuse",
            label: "宽带复用率柱状图（全部宽带，不受筛选与分页影响）",
            children: <BroadbandReuseChart />,
          },
        ]}
      />

      {expiringOnly ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message={`当前只显示到期日在 ${expireCutoff} 之前（未来 30 天内到期或已过期）的宽带。`}
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
            placeholder="搜索名称 / 账号 / 地址 / 合同号"
            style={{ width: 280 }}
            onSearch={(v) => {
              setKeyword(v);
              setPage(1);
            }}
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
            options={BROADBAND_STATUS}
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

      <Table<Broadband>
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data?.items ?? []}
        columns={columns}
        scroll={{ x: 1600 }}
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
        locale={{ emptyText: error ? errorMessage(error) : "暂无宽带" }}
      />

      <CrudDrawer
        open={drawerOpen}
        title={editing ? `编辑宽带：${editing.name}` : "批量新增宽带"}
        onClose={() => setDrawerOpen(false)}
        onSave={() => void submit()}
        saving={saving}
        width={900}
      >
        <Form<{ items: BroadbandForm[] }> form={form} layout="vertical" requiredMark>
          {editing && editing.supplierId === null ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="该历史宽带尚未关联供应商，请补全后保存。"
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
                    name={[field.name, "name"]}
                    label="名称 / 编号"
                    rules={[{ required: true, message: "请输入宽带名称或编号" }]}
                    style={{ flex: 2 }}
                  >
                    <Input maxLength={100} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "supplierId"]}
                    label="供应商"
                    rules={[{ required: true, message: "请选择供应商" }]}
                    style={{ flex: 1 }}
                  >
                    <PartySelect kind="supplier" parties={options?.suppliers} />
                  </Form.Item>
                  <Form.Item name={[field.name, "status"]} label="状态" style={{ width: 130 }}>
                    <Select options={BROADBAND_STATUS} />
                  </Form.Item>
                </Space>

                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "bandwidthMbps"]} label="带宽（Mbps）" style={{ flex: 1 }}>
                    <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name={[field.name, "expireDate"]} label="到期日" style={{ flex: 1 }}>
                    <DatePicker style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name={[field.name, "monthlyFeeYuan"]} label="月费（元）" style={{ flex: 1 }}>
                    <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name={[field.name, "contractNo"]} label="合同号" style={{ flex: 1 }}>
                    <Input maxLength={100} />
                  </Form.Item>
                </Space>

                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "account"]} label="宽带账号" style={{ flex: 1 }}>
                    <Input maxLength={200} />
                  </Form.Item>
                  <Form.Item name={[field.name, "password"]} label="密码" style={{ flex: 1 }}>
                    <Input.Password maxLength={200} autoComplete="new-password" />
                  </Form.Item>
                  <Form.Item name={[field.name, "installAddress"]} label="安装地址" style={{ flex: 2 }}>
                    <Input maxLength={500} />
                  </Form.Item>
                </Space>

                <Typography.Title level={5} style={{ marginTop: 4 }}>
                  关联资源
                </Typography.Title>
                <Space size={12} style={{ display: "flex" }} align="start" wrap>
                  <Form.Item name={[field.name, "rackId"]} label="机柜" style={{ width: 190 }}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      options={(options?.racks ?? []).map((r) => ({
                        value: r.id,
                        label: `${r.location ? `${r.location} / ` : ""}${r.code} [${r.uStart}-${r.uEnd}]U`,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, "deviceId"]} label="设备" style={{ width: 180 }}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      options={(options?.devices ?? []).map((d) => ({ value: d.id, label: d.name }))}
                      onChange={(v: string | undefined) => {
                        const device = (options?.devices ?? []).find((d) => d.id === v);
                        if (device?.rackId) {
                          form.setFieldValue(["items", field.name, "rackId"], device.rackId);
                        }
                      }}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, "lineId"]} label="线路" style={{ width: 200 }}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      options={(options?.lines ?? []).map((l) => ({
                        value: l.id,
                        label: `${l.code} ${l.name}`,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, "ipAddressId"]} label="IP 地址" style={{ width: 180 }}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      options={(options?.ipAddresses ?? []).map((ip) => ({
                        value: ip.id,
                        label: ip.address,
                      }))}
                    />
                  </Form.Item>
                </Space>

                <Form.Item name={[field.name, "description"]} label="描述">
                  <Input.TextArea rows={2} maxLength={1000} />
                </Form.Item>
                <Form.Item name={[field.name, "notes"]} label="备注">
                  <Input.TextArea rows={2} maxLength={2000} />
                </Form.Item>
              </>
            )}
          />
        </Form>
      </CrudDrawer>

      <Drawer
        open={detailOpen}
        title={detail ? `宽带详情：${detail.name}` : "宽带详情"}
        width={720}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading && !detail}
      >
        {detail ? (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="名称/编号" span={2}>
              {detail.name}
            </Descriptions.Item>
            <Descriptions.Item label="供应商">{detail.supplier?.name ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="客户">
              <Tooltip
                title={
                  detail.customerNames?.length ? detail.customerNames.join("、") : undefined
                }
              >
                {detail.customerSummary ?? "—"}
              </Tooltip>
            </Descriptions.Item>
            <Descriptions.Item label="带宽">
              {detail.bandwidthMbps === null ? "—" : `${detail.bandwidthMbps} Mbps`}
            </Descriptions.Item>
            <Descriptions.Item label="已分配 MBPS">
              {detail.allocatedMbps ?? 0} Mbps
            </Descriptions.Item>
            <Descriptions.Item label="复用率">
              {detail.reusePercent === null || detail.reusePercent === undefined ? (
                "—"
              ) : (
                <span className={detail.reusePercent > 100 ? "rm-danger" : undefined}>
                  {detail.reusePercent.toFixed(1)}%
                </span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              {labelOf(BROADBAND_STATUS, detail.status)}
            </Descriptions.Item>
            <Descriptions.Item label="到期日">
              <Maybe value={detail.expireDate} />
            </Descriptions.Item>
            <Descriptions.Item label="月费">{formatFee(detail.monthlyFeeCents)}</Descriptions.Item>
            <Descriptions.Item label="合同号">
              <Maybe value={detail.contractNo} />
            </Descriptions.Item>
            <Descriptions.Item label="安装地址">
              <Maybe value={detail.installAddress} />
            </Descriptions.Item>
            <Descriptions.Item label="宽带账号">
              <Maybe value={detail.account} />
            </Descriptions.Item>
            <Descriptions.Item label="密码">
              {detail.password ? (
                <Input.Password value={detail.password} readOnly />
              ) : (
                "—"
              )}
            </Descriptions.Item>
            <Descriptions.Item label="关联机柜">
              {detail.rack
                ? `${detail.rack.location ? `${detail.rack.location} / ` : ""}${detail.rack.code} [${detail.rack.uStart ?? "?"}-${detail.rack.uEnd ?? "?"}]U`
                : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="关联设备">{detail.device?.name ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="关联线路">
              {detail.line ? `${detail.line.code} ${detail.line.name}` : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="关联 IP">
              {detail.ipAddress?.address ?? "—"}
            </Descriptions.Item>
            <Descriptions.Item label="描述" span={2}>
              {detail.description ?? "—"}
            </Descriptions.Item>
            <Descriptions.Item label="备注" span={2}>
              {detail.notes ?? "—"}
            </Descriptions.Item>
          </Descriptions>
        ) : null}
        {detail ? (
          <>
            <Typography.Title level={5} style={{ marginTop: 20 }}>
              当前有效分配
            </Typography.Title>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.allocations ?? []}
              locale={{ emptyText: "暂无有效分配" }}
              columns={[
                {
                  title: "客户",
                  render: (_v, row) => row.customer?.name ?? "—",
                },
                {
                  title: "分配 MBPS",
                  width: 110,
                  render: (_v, row) =>
                    row.allocatedMbps === null ? "—" : `${row.allocatedMbps} Mbps`,
                },
                {
                  title: "分配日期",
                  width: 115,
                  render: (_v, row) => dayjs(row.allocatedAt).format("YYYY-MM-DD"),
                },
                {
                  title: "备注",
                  render: (_v, row) => <Maybe value={row.notes} />,
                },
              ]}
            />
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
