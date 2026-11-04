"use client";

import { useState } from "react";
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
import { SystemEndpointsEditor, type EndpointFormValue } from "@/components/SystemEndpointsEditor";
import { Maybe } from "@/components/Tags";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { BatchEntryList } from "@/components/batch/BatchEntryList";
import { submitBatch } from "@/components/batch/submitBatch";
import { useOptions } from "@/components/OptionsProvider";
import { useSessionUser } from "@/components/SessionContext";
import { useInitialParams } from "@/components/useInitialParams";
import { apiFetch, buildQuery, errorMessage } from "@/lib/client";
import {
  CRITICALITIES,
  ENVIRONMENTS,
  PROTOCOLS,
  SYSTEM_STATUS,
  colorOf,
  labelOf,
} from "@/lib/enums";
import type { BusinessSystem, ListResult, SystemEndpoint } from "@/lib/types";

type SystemForm = {
  name?: string;
  code?: string;
  owner?: string;
  department?: string;
  environment: string;
  criticality: string;
  status: string;
  url?: string;
  domain?: string;
  onlineDate?: Dayjs | null;
  description?: string;
  endpoints?: EndpointFormValue[];
};

function endpointAddress(endpoint: SystemEndpoint): string {
  return endpoint.ipAddress?.address ?? endpoint.ipText ?? "—";
}

const defaults = (): SystemForm => ({
  environment: "prod",
  criticality: "normal",
  status: "active",
  endpoints: [],
});

export default function BusinessSystemsPage() {
  const user = useSessionUser();
  const isAdmin = user.role === "ADMIN";
  const { message } = App.useApp();
  const { mutate: mutateOptions } = useOptions();
  const initial = useInitialParams("keyword");

  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [environment, setEnvironment] = useState<string | undefined>();
  const [criticality, setCriticality] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const filters = { keyword, environment, criticality, status, page, pageSize };
  const { data, error, isLoading, mutate } = useSWR<ListResult<BusinessSystem>>(
    `/api/business-systems${buildQuery(filters)}`,
  );

  const [form] = Form.useForm<{ items: SystemForm[] }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<BusinessSystem | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<BusinessSystem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ items: [defaults()] });
    setDrawerOpen(true);
  };

  const openEdit = (row: BusinessSystem) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      items: [
        {
          name: row.name,
          code: row.code ?? undefined,
          owner: row.owner,
          department: row.department ?? undefined,
          environment: row.environment,
          criticality: row.criticality,
          status: row.status,
          url: row.url ?? undefined,
          domain: row.domain ?? undefined,
          onlineDate: row.onlineDate ? dayjs(row.onlineDate) : null,
          description: row.description ?? undefined,
          endpoints: (row.endpoints ?? []).map((e) => ({
            ipAddressId: e.ipAddressId,
            ipText: e.ipText ?? undefined,
            protocol: e.protocol,
            port: e.port,
            isPrimary: e.isPrimary,
            description: e.description ?? undefined,
          })),
        },
      ],
    });
    setDrawerOpen(true);
  };

  const openDetail = (row: BusinessSystem) => {
    setDetail(row);
    setDetailOpen(true);
  };

  const toPayload = (values: SystemForm) => ({
    name: values.name?.trim(),
    code: values.code?.trim() || null,
    owner: values.owner?.trim(),
    department: values.department?.trim() || null,
    environment: values.environment,
    criticality: values.criticality,
    status: values.status,
    url: values.url?.trim() || null,
    domain: values.domain?.trim() || null,
    onlineDate: values.onlineDate ? values.onlineDate.format("YYYY-MM-DD") : null,
    description: values.description?.trim() || null,
    endpoints: (values.endpoints ?? []).map((e) => ({
      ipAddressId: e.ipAddressId ?? null,
      ipText: e.ipText?.trim() || null,
      protocol: e.protocol,
      port: e.port ?? null,
      isPrimary: Boolean(e.isPrimary),
      description: e.description?.trim() || null,
    })),
  });

  const submit = async () => {
    let values: { items: SystemForm[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const items = values.items ?? [];
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/business-systems/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(items[0])),
        });
        message.success("业务系统已更新");
      } else {
        const result = await submitBatch(items, async (item) => {
          await apiFetch("/api/business-systems", {
            method: "POST",
            body: JSON.stringify(toPayload(item)),
          });
        });
        if (result.ok) {
          message.success(`已新增 ${result.count} 个业务系统`);
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

  const remove = async (row: BusinessSystem) => {
    try {
      await apiFetch(`/api/business-systems/${row.id}`, { method: "DELETE" });
      message.success("业务系统已删除");
      await mutate();
      await mutateOptions();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const columns: ColumnsType<BusinessSystem> = [
    {
      title: "系统名称 / 编号",
      width: 210,
      render: (_v, row) => (
        <div>
          <a onClick={() => openDetail(row)}>{row.name}</a>
          <div className="rm-muted rm-mono">{row.code ?? "—"}</div>
        </div>
      ),
    },
    {
      title: "负责人 / 部门",
      width: 150,
      render: (_v, row) => (
        <div>
          <div>{row.owner}</div>
          <div className="rm-muted">{row.department ?? "—"}</div>
        </div>
      ),
    },
    {
      title: "环境",
      dataIndex: "environment",
      width: 90,
      render: (v: string) => (
        <Tag color={colorOf(ENVIRONMENTS, v)}>{labelOf(ENVIRONMENTS, v)}</Tag>
      ),
    },
    {
      title: "重要性",
      dataIndex: "criticality",
      width: 90,
      render: (v: string) => (
        <Tag color={colorOf(CRITICALITIES, v)}>{labelOf(CRITICALITIES, v)}</Tag>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v: string) => (
        <Tag color={colorOf(SYSTEM_STATUS, v)}>{labelOf(SYSTEM_STATUS, v)}</Tag>
      ),
    },
    {
      title: "主要端点",
      width: 220,
      render: (_v, row) => {
        const endpoints = row.endpoints ?? [];
        const primary = endpoints.find((e) => e.isPrimary) ?? endpoints[0];
        if (!primary) return <span className="rm-muted">暂无端点</span>;
        return (
          <div>
            <span className="rm-mono">{endpointAddress(primary)}</span>
            <span className="rm-muted">
              :{primary.port ?? "—"} / {labelOf(PROTOCOLS, primary.protocol)}
            </span>
            {endpoints.length > 1 ? (
              <span className="rm-muted">（共 {endpoints.length} 个）</span>
            ) : null}
          </div>
        );
      },
    },
    {
      title: "域名 / URL",
      render: (_v, row) => (
        <div>
          <div>{row.domain ?? "—"}</div>
          <div className="rm-muted">{row.url ?? "—"}</div>
        </div>
      ),
    },
    {
      title: "操作",
      width: 170,
      fixed: "right",
      render: (_v, row) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(row)}>
            详情
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          {isAdmin ? (
            <Popconfirm
              title="确认删除该业务系统？"
              description="其访问端点将一并删除。"
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
        title="业务系统登记"
        description="业务系统主数据与访问端点；端点可关联 IP 台账或填写独立 IP 文本，支持多协议、多端口。"
        extra={
          <Space wrap>
            <ImportExport
              module="business-systems"
              moduleLabel="业务系统"
              exportQuery={buildQuery({ keyword, environment, criticality, status })}
              isAdmin={isAdmin}
              onImported={() => {
                void mutate();
                void mutateOptions();
              }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增业务系统
            </Button>
          </Space>
        }
      />

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            placeholder="搜索名称 / 编号 / 负责人 / 域名 / 端点"
            style={{ width: 280 }}
            onSearch={(v) => {
              setKeyword(v);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="环境"
            style={{ width: 110 }}
            value={environment}
            onChange={(v) => {
              setEnvironment(v);
              setPage(1);
            }}
            options={ENVIRONMENTS}
          />
          <Select
            allowClear
            placeholder="重要性"
            style={{ width: 110 }}
            value={criticality}
            onChange={(v) => {
              setCriticality(v);
              setPage(1);
            }}
            options={CRITICALITIES}
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
            options={SYSTEM_STATUS}
          />
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
          刷新
        </Button>
      </div>

      <Table<BusinessSystem>
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data?.items ?? []}
        columns={columns}
        scroll={{ x: 1250 }}
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
        locale={{ emptyText: error ? errorMessage(error) : "暂无业务系统" }}
      />

      <CrudDrawer
        open={drawerOpen}
        title={editing ? `编辑业务系统：${editing.name}` : "批量新增业务系统"}
        onClose={() => setDrawerOpen(false)}
        onSave={() => void submit()}
        saving={saving}
        width={900}
      >
        <Form<{ items: SystemForm[] }> form={form} layout="vertical" requiredMark>
          <BatchEntryList
            form={form}
            batch={!editing}
            defaultItem={defaults()}
            renderItem={(field) => (
              <>
                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item
                    name={[field.name, "name"]}
                    label="系统名称"
                    rules={[{ required: true, message: "请输入系统名称" }]}
                    style={{ flex: 2 }}
                  >
                    <Input maxLength={100} />
                  </Form.Item>
                  <Form.Item name={[field.name, "code"]} label="系统编号（可空）" style={{ flex: 1 }}>
                    <Input maxLength={50} />
                  </Form.Item>
                </Space>

                <Space size={12} style={{ display: "flex" }} align="start" wrap>
                  <Form.Item
                    name={[field.name, "owner"]}
                    label="负责人"
                    rules={[{ required: true, message: "请输入负责人" }]}
                    style={{ flex: 1, minWidth: 120 }}
                  >
                    <Input maxLength={50} />
                  </Form.Item>
                  <Form.Item name={[field.name, "department"]} label="所属部门" style={{ flex: 1, minWidth: 120 }}>
                    <Input maxLength={100} />
                  </Form.Item>
                  <Form.Item name={[field.name, "environment"]} label="环境" style={{ flex: 1, minWidth: 100 }}>
                    <Select options={ENVIRONMENTS} />
                  </Form.Item>
                  <Form.Item name={[field.name, "criticality"]} label="重要性" style={{ flex: 1, minWidth: 100 }}>
                    <Select options={CRITICALITIES} />
                  </Form.Item>
                  <Form.Item name={[field.name, "status"]} label="状态" style={{ flex: 1, minWidth: 100 }}>
                    <Select options={SYSTEM_STATUS} />
                  </Form.Item>
                </Space>

                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "domain"]} label="域名" style={{ flex: 1 }}>
                    <Input maxLength={200} />
                  </Form.Item>
                  <Form.Item name={[field.name, "url"]} label="访问 URL" style={{ flex: 2 }}>
                    <Input maxLength={500} />
                  </Form.Item>
                  <Form.Item name={[field.name, "onlineDate"]} label="上线日期" style={{ flex: 1 }}>
                    <DatePicker style={{ width: "100%" }} />
                  </Form.Item>
                </Space>

                <Typography.Title level={5} style={{ marginTop: 4 }}>
                  访问端点
                </Typography.Title>
                <SystemEndpointsEditor path={[field.name]} />

                <Form.Item name={[field.name, "description"]} label="描述" style={{ marginTop: 16 }}>
                  <Input.TextArea rows={2} maxLength={1000} />
                </Form.Item>
              </>
            )}
          />
        </Form>
      </CrudDrawer>

      <Drawer
        open={detailOpen}
        title={detail ? `业务系统详情：${detail.name}` : "业务系统详情"}
        width={700}
        onClose={() => setDetailOpen(false)}
      >
        {detail ? (
          <>
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="编号">
                <Maybe value={detail.code} />
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={colorOf(SYSTEM_STATUS, detail.status)}>
                  {labelOf(SYSTEM_STATUS, detail.status)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="负责人">{detail.owner}</Descriptions.Item>
              <Descriptions.Item label="部门">
                <Maybe value={detail.department} />
              </Descriptions.Item>
              <Descriptions.Item label="环境">
                {labelOf(ENVIRONMENTS, detail.environment)}
              </Descriptions.Item>
              <Descriptions.Item label="重要性">
                {labelOf(CRITICALITIES, detail.criticality)}
              </Descriptions.Item>
              <Descriptions.Item label="域名">
                <Maybe value={detail.domain} />
              </Descriptions.Item>
              <Descriptions.Item label="上线日期">
                <Maybe value={detail.onlineDate} />
              </Descriptions.Item>
              <Descriptions.Item label="URL" span={2}>
                <Maybe value={detail.url} />
              </Descriptions.Item>
              <Descriptions.Item label="描述" span={2}>
                {detail.description ?? "—"}
              </Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5}>
              访问端点（{detail.endpoints?.length ?? 0}）
            </Typography.Title>
            <Table<SystemEndpoint>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.endpoints ?? []}
              locale={{ emptyText: "暂无端点" }}
              columns={[
                {
                  title: "IP",
                  render: (_v, e) => <span className="rm-mono">{endpointAddress(e)}</span>,
                },
                {
                  title: "协议",
                  dataIndex: "protocol",
                  width: 90,
                  render: (v: string) => labelOf(PROTOCOLS, v),
                },
                { title: "端口", dataIndex: "port", width: 90, render: (v) => <Maybe value={v} /> },
                {
                  title: "主端点",
                  dataIndex: "isPrimary",
                  width: 80,
                  render: (v: boolean) => (v ? <Tag color="blue">主</Tag> : "—"),
                },
                { title: "说明", dataIndex: "description", render: (v) => <Maybe value={v} /> },
              ]}
            />
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
