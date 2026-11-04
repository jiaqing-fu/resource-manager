"use client";

import { useState } from "react";
import useSWR from "swr";
import dayjs, { type Dayjs } from "dayjs";
import {
  App,
  Button,
  DatePicker,
  Form,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { PartySelect } from "@/components/PartySelect";
import { Maybe } from "@/components/Tags";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { AllocationWorkbench } from "@/components/allocations/AllocationWorkbench";
import { useOptions } from "@/components/OptionsProvider";
import { useInitialParams } from "@/components/useInitialParams";
import { apiFetch, buildQuery, errorMessage } from "@/lib/client";
import {
  ALLOCATION_RESOURCE_TYPES,
  ALLOCATION_STATUS,
  colorOf,
  labelOf,
} from "@/lib/enums";
import type { ListResult, ResourceAllocation } from "@/lib/types";

type AllocationRow = ResourceAllocation & { currentResourceName?: string };

function allocationContent(row: AllocationRow): string {
  if (row.resourceType === "rack" && row.uStart !== null && row.uEnd !== null) {
    return `[${row.uStart}-${row.uEnd}]U`;
  }
  if (row.resourceType === "broadband" && row.allocatedMbps !== null) {
    return `${row.allocatedMbps} Mbps`;
  }
  return "—";
}

export default function ResourceAllocationsPage() {
  const { message } = App.useApp();
  const { data: options, mutate: mutateOptions } = useOptions();
  const initial = useInitialParams("keyword,customerId,resourceType,status");
  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [customerId, setCustomerId] = useState<string | undefined>(initial.customerId);
  const [resourceType, setResourceType] = useState<string | undefined>(initial.resourceType);
  const [status, setStatus] = useState<string | undefined>(initial.status);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, error, isLoading, mutate } = useSWR<ListResult<AllocationRow>>(
    `/api/resource-allocations${buildQuery({
      keyword,
      customerId,
      resourceType,
      status,
      page,
      pageSize,
    })}`,
  );

  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchKey, setWorkbenchKey] = useState(0);

  const [releaseForm] = Form.useForm<{ releasedAt?: Dayjs | null }>();
  const [releasing, setReleasing] = useState<AllocationRow | null>(null);
  const [releaseSaving, setReleaseSaving] = useState(false);

  const openCreate = () => {
    setWorkbenchKey((key) => key + 1);
    setWorkbenchOpen(true);
  };

  const openRelease = (row: AllocationRow) => {
    setReleasing(row);
    releaseForm.resetFields();
    releaseForm.setFieldsValue({ releasedAt: dayjs() });
  };

  const doRelease = async (values: { releasedAt?: Dayjs | null }) => {
    if (!releasing) return;
    setReleaseSaving(true);
    try {
      await apiFetch(`/api/resource-allocations/${releasing.id}/release`, {
        method: "POST",
        body: JSON.stringify({
          releasedAt: values.releasedAt ? values.releasedAt.format("YYYY-MM-DD") : null,
        }),
      });
      message.success("资源已释放");
      setReleasing(null);
      await mutate();
      await mutateOptions();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setReleaseSaving(false);
    }
  };

  const columns: ColumnsType<AllocationRow> = [
    { title: "客户", width: 180, render: (_v, row) => row.customer?.name ?? "—" },
    {
      title: "资源类型",
      dataIndex: "resourceType",
      width: 120,
      render: (v: string) => labelOf(ALLOCATION_RESOURCE_TYPES, v),
    },
    {
      title: "资源名称",
      render: (_v, row) => row.currentResourceName ?? row.resourceName,
    },
    {
      title: "分配内容",
      width: 120,
      render: (_v, row) => allocationContent(row),
    },
    {
      title: "供应商快照",
      width: 160,
      render: (_v, row) => <Maybe value={row.supplierName} />,
    },
    {
      title: "分配日期",
      dataIndex: "allocatedAt",
      width: 120,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD"),
    },
    {
      title: "释放日期",
      dataIndex: "releasedAt",
      width: 120,
      render: (v: string | null) => (v ? dayjs(v).format("YYYY-MM-DD") : "—"),
    },
    {
      title: "状态",
      width: 100,
      render: (_v, row) => {
        const value = row.releasedAt ? "released" : "active";
        return (
          <Tag color={colorOf(ALLOCATION_STATUS, value)}>
            {labelOf(ALLOCATION_STATUS, value)}
          </Tag>
        );
      },
    },
    { title: "备注", dataIndex: "notes", render: (v) => <Maybe value={v} /> },
    {
      title: "操作",
      width: 120,
      fixed: "right",
      render: (_v, row) =>
        row.releasedAt === null ? (
          <Popconfirm
            title="确认释放该资源？"
            description="释放后历史保留，资源可重新分配。"
            onConfirm={() => openRelease(row)}
          >
            <Button type="link" size="small">
              释放
            </Button>
          </Popconfirm>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="资源分配"
        description="多客户批量增减 8 类资源；机柜按子区间分配且分配互斥，宽带可超分，释放后历史永久保留。"
        extra={
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增分配
            </Button>
          </Space>
        }
      />

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            placeholder="搜索客户 / 资源名称 / 备注"
            style={{ width: 260 }}
            onSearch={(v) => {
              setKeyword(v);
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
          <Select
            allowClear
            placeholder="资源类型"
            style={{ width: 140 }}
            value={resourceType}
            onChange={(v) => {
              setResourceType(v);
              setPage(1);
            }}
            options={ALLOCATION_RESOURCE_TYPES}
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
            options={ALLOCATION_STATUS}
          />
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
          刷新
        </Button>
      </div>

      <Table<AllocationRow>
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
        locale={{ emptyText: error ? errorMessage(error) : "暂无分配记录" }}
      />

      <AllocationWorkbench
        key={workbenchKey}
        open={workbenchOpen}
        onClose={() => setWorkbenchOpen(false)}
        customers={options?.customers ?? []}
        initialCustomerId={customerId}
        onSaved={async () => {
          await mutate();
          await mutateOptions();
        }}
      />

      <Modal
        open={releasing !== null}
        title={`释放资源：${releasing?.currentResourceName ?? releasing?.resourceName ?? ""}`}
        onCancel={() => setReleasing(null)}
        onOk={() => releaseForm.submit()}
        confirmLoading={releaseSaving}
        destroyOnHidden
      >
        <Form form={releaseForm} layout="vertical" onFinish={(values) => void doRelease(values)}>
          <Form.Item name="releasedAt" label="释放日期">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
