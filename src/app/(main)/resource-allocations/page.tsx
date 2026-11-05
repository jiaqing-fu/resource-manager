"use client";

import { useState, type Key } from "react";
import useSWR from "swr";
import dayjs, { type Dayjs } from "dayjs";
import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
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
import type {
  IpReleaseRecord,
  ListResult,
  OtherReleaseRecord,
  RackAllocationItem,
  RackReleaseRecord,
  ResourceAllocation,
  ResourceAllocationItem,
} from "@/lib/types";

type AllocationRow = ResourceAllocation & { currentResourceName?: string };

function allocationContent(row: AllocationRow): string {
  if (row.resourceType === "rack" && row.uStart !== null && row.uEnd !== null) {
    return `[${row.uStart}-${row.uEnd}]U`;
  }
  if (row.resourceType === "ipRange" && row.ipRangeStart && row.ipRangeEnd) {
    return `${row.ipRangeStart}-${row.ipRangeEnd}`;
  }
  if (row.resourceType === "broadband" && row.allocatedMbps !== null) {
    return `${row.allocatedMbps} Mbps`;
  }
  return "—";
}

function AllocationItemsPanel({
  allocation,
  version,
  onRelease,
}: {
  allocation: AllocationRow;
  version: number;
  onRelease: (addresses: string[]) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [status, setStatus] = useState<string | undefined>();
  const [keyword, setKeyword] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);

  const { data, isLoading, error } = useSWR<ListResult<ResourceAllocationItem>>(
    `/api/resource-allocations/${allocation.id}/items${buildQuery({
      keyword,
      status,
      page,
      pageSize,
      version,
    })}`,
  );

  const items = data?.items ?? [];
  const selectedActive = items.filter(
    (item) => selectedKeys.includes(item.id) && item.releasedAt === null,
  );

  const columns: ColumnsType<ResourceAllocationItem> = [
    { title: "IP 地址", dataIndex: "address", width: 150 },
    {
      title: "DNS / 备注",
      width: 180,
      render: (_v, row) => (
        <Maybe value={row.ipAddress?.dnsName ?? null} />
      ),
    },
    {
      title: "状态",
      width: 90,
      render: (_v, row) => (
        <Tag color={row.releasedAt ? "default" : "green"}>
          {row.releasedAt ? "已释放" : "有效"}
        </Tag>
      ),
    },
    {
      title: "释放日期",
      width: 110,
      render: (_v, row) =>
        row.releasedAt ? dayjs(row.releasedAt).format("YYYY-MM-DD") : "—",
    },
    {
      title: "释放批次",
      width: 140,
      render: (_v, row) =>
        row.releaseBatchId ? (
          <Typography.Text code copyable={{ text: row.releaseBatchId }}>
            {row.releaseBatchId.slice(0, 8)}
          </Typography.Text>
        ) : (
          "—"
        ),
    },
    {
      title: "操作人",
      width: 100,
      render: (_v, row) => <Maybe value={row.releasedByName} />,
    },
    {
      title: "释放备注",
      render: (_v, row) => <Maybe value={row.releaseNote} />,
    },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 8 }}>
        <Select
          allowClear
          size="small"
          placeholder="明细状态"
          style={{ width: 110 }}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
            setSelectedKeys([]);
          }}
          options={[
            { value: "active", label: "有效" },
            { value: "released", label: "已释放" },
          ]}
        />
        <DebouncedSearchInput
          value={keyword}
          placeholder="搜索 IP / 操作人 / 备注"
          style={{ width: 220 }}
          onSearch={(value) => {
            setKeyword(value);
            setPage(1);
            setSelectedKeys([]);
          }}
        />
        <Button
          danger
          size="small"
          disabled={selectedActive.length === 0}
          onClick={() => onRelease(selectedActive.map((item) => item.address))}
        >
          释放选中 IP（{selectedActive.length}）
        </Button>
        <Typography.Text type="secondary">
          勾选需要释放的 IP，可跨任意间隔批量释放。
        </Typography.Text>
      </Space>
      <Table<ResourceAllocationItem>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={items}
        columns={columns}
        scroll={{ x: 900 }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: setSelectedKeys,
          getCheckboxProps: (row) => ({ disabled: row.releasedAt !== null }),
        }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          size: "small",
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100, 200],
          showTotal: (total) => `共 ${total} 个 IP`,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage);
            setPageSize(nextSize);
            setSelectedKeys([]);
          },
        }}
        locale={{ emptyText: error ? errorMessage(error) : "暂无 IP 明细" }}
      />
    </div>
  );
}

function RackAllocationItemsPanel({
  allocation,
  version,
  onRelease,
}: {
  allocation: AllocationRow;
  version: number;
  onRelease: (units: number[]) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [status, setStatus] = useState<string | undefined>();
  const [keyword, setKeyword] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);

  const { data, isLoading, error } = useSWR<ListResult<RackAllocationItem>>(
    `/api/resource-allocations/${allocation.id}/rack-items${buildQuery({
      keyword,
      status,
      page,
      pageSize,
      version,
    })}`,
  );

  const items = data?.items ?? [];
  const selectedActive = items.filter(
    (item) => selectedKeys.includes(item.id) && item.releasedAt === null,
  );

  const columns: ColumnsType<RackAllocationItem> = [
    {
      title: "U 位",
      width: 100,
      render: (_v, row) => `U${row.uNumber}`,
    },
    {
      title: "状态",
      width: 90,
      render: (_v, row) => (
        <Tag color={row.releasedAt ? "default" : "green"}>
          {row.releasedAt ? "已释放" : "有效"}
        </Tag>
      ),
    },
    {
      title: "释放日期",
      width: 110,
      render: (_v, row) =>
        row.releasedAt ? dayjs(row.releasedAt).format("YYYY-MM-DD") : "—",
    },
    {
      title: "释放批次",
      width: 140,
      render: (_v, row) =>
        row.releaseBatchId ? (
          <Typography.Text code copyable={{ text: row.releaseBatchId }}>
            {row.releaseBatchId.slice(0, 8)}
          </Typography.Text>
        ) : (
          "—"
        ),
    },
    {
      title: "操作人",
      width: 100,
      render: (_v, row) => <Maybe value={row.releasedByName} />,
    },
    {
      title: "释放备注",
      render: (_v, row) => <Maybe value={row.releaseNote} />,
    },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 8 }}>
        <Select
          allowClear
          size="small"
          placeholder="明细状态"
          style={{ width: 110 }}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
            setSelectedKeys([]);
          }}
          options={[
            { value: "active", label: "有效" },
            { value: "released", label: "已释放" },
          ]}
        />
        <DebouncedSearchInput
          value={keyword}
          placeholder="搜索 U 位 / 操作人 / 备注"
          style={{ width: 220 }}
          onSearch={(value) => {
            setKeyword(value);
            setPage(1);
            setSelectedKeys([]);
          }}
        />
        <Button
          danger
          size="small"
          disabled={selectedActive.length === 0}
          onClick={() => onRelease(selectedActive.map((item) => item.uNumber))}
        >
          释放选中 U（{selectedActive.length}）
        </Button>
        <Typography.Text type="secondary">
          勾选需要释放的 U 位，可跨任意间隔批量释放。
        </Typography.Text>
      </Space>
      <Table<RackAllocationItem>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={items}
        columns={columns}
        scroll={{ x: 720 }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: setSelectedKeys,
          getCheckboxProps: (row) => ({ disabled: row.releasedAt !== null }),
        }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          size: "small",
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100, 200],
          showTotal: (total) => `共 ${total} 个 U 位`,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage);
            setPageSize(nextSize);
            setSelectedKeys([]);
          },
        }}
        locale={{ emptyText: error ? errorMessage(error) : "暂无 U 位明细" }}
      />
    </div>
  );
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

  const [releaseForm] = Form.useForm<{
    releasedAt?: Dayjs | null;
    ipList?: string;
    uList?: string;
    releaseNote?: string;
  }>();
  const [releasing, setReleasing] = useState<AllocationRow | null>(null);
  const [releaseSaving, setReleaseSaving] = useState(false);
  const [itemsVersion, setItemsVersion] = useState(0);
  const [activeTab, setActiveTab] = useState("allocations");
  const [selectedIds, setSelectedIds] = useState<Key[]>([]);
  const [batchReleasing, setBatchReleasing] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchForm] = Form.useForm<{
    releasedAt?: Dayjs | null;
    releaseNote?: string;
  }>();
  const [recordKind, setRecordKind] = useState<"ip" | "rack" | "other">("ip");
  const [recordsKeyword, setRecordsKeyword] = useState("");
  const [recordsCustomerId, setRecordsCustomerId] = useState<string | undefined>();
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsPageSize, setRecordsPageSize] = useState(20);

  type ReleaseRecordRow =
    | IpReleaseRecord
    | RackReleaseRecord
    | OtherReleaseRecord;

  const {
    data: records,
    error: recordsError,
    isLoading: recordsLoading,
    mutate: mutateRecords,
  } = useSWR<ListResult<ReleaseRecordRow>>(
    activeTab === "records"
      ? `/api/resource-allocations/${
          recordKind === "ip"
            ? "release-records"
            : recordKind === "rack"
              ? "rack-release-records"
              : "other-release-records"
        }${buildQuery({
          keyword: recordsKeyword,
          customerId: recordsCustomerId,
          page: recordsPage,
          pageSize: recordsPageSize,
          _v: itemsVersion,
        })}`
      : null,
  );

  const openCreate = () => {
    setWorkbenchKey((key) => key + 1);
    setWorkbenchOpen(true);
  };

  const openRelease = (
    row: AllocationRow,
    addresses?: string[],
    units?: number[],
  ) => {
    setReleasing(row);
    releaseForm.resetFields();
    releaseForm.setFieldsValue({
      releasedAt: dayjs(),
      ipList: addresses && addresses.length > 0 ? addresses.join(",") : "",
      uList: units && units.length > 0 ? units.join(",") : "",
      releaseNote: "",
    });
  };

  const doRelease = async (values: {
    releasedAt?: Dayjs | null;
    ipList?: string;
    uList?: string;
    releaseNote?: string;
  }) => {
    if (!releasing) return;
    setReleaseSaving(true);
    try {
      const result = await apiFetch<{
        releasedCount: number;
        remainingCount: number;
        parentReleased: boolean;
      }>(`/api/resource-allocations/${releasing.id}/release`, {
        method: "POST",
        body: JSON.stringify({
          releasedAt: values.releasedAt ? values.releasedAt.format("YYYY-MM-DD") : null,
          ipList: values.ipList?.trim() || null,
          uList: values.uList?.trim() || null,
          releaseNote: values.releaseNote?.trim() || null,
        }),
      });
      const unit = releasing.resourceType === "rack" ? "个 U 位" : "个 IP";
      message.success(
        result.releasedCount > 0
          ? result.parentReleased
            ? `已释放 ${result.releasedCount} ${unit}，该分配已全部释放`
            : `已释放 ${result.releasedCount} ${unit}，剩余 ${result.remainingCount} 个`
          : "资源已释放",
      );
      setReleasing(null);
      setItemsVersion((value) => value + 1);
      await mutate();
      await mutateOptions();
      await mutateRecords();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setReleaseSaving(false);
    }
  };

  const openBatchRelease = () => {
    batchForm.resetFields();
    batchForm.setFieldsValue({ releasedAt: dayjs(), releaseNote: "" });
    setBatchReleasing(true);
  };

  const doBatchRelease = async (values: {
    releasedAt?: Dayjs | null;
    releaseNote?: string;
  }) => {
    if (selectedIds.length === 0) return;
    setBatchSaving(true);
    try {
      const result = await apiFetch<{
        released: number;
        totalUnits: number;
      }>("/api/resource-allocations/batch-release", {
        method: "POST",
        body: JSON.stringify({
          ids: selectedIds,
          releasedAt: values.releasedAt
            ? values.releasedAt.format("YYYY-MM-DD")
            : null,
          releaseNote: values.releaseNote?.trim() || null,
        }),
      });
      message.success(
        `已释放 ${result.released} 条分配记录${
          result.totalUnits > 0 ? `，共 ${result.totalUnits} 个明细` : ""
        }`,
      );
      setBatchReleasing(false);
      setSelectedIds([]);
      setItemsVersion((value) => value + 1);
      await mutate();
      await mutateOptions();
      await mutateRecords();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setBatchSaving(false);
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
      title: "释放备注",
      width: 160,
      render: (_v, row) =>
        row.releasedAt ? <Maybe value={row.releaseNote} /> : "—",
    },
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

  const recordColumns: ColumnsType<ReleaseRecordRow> = [
    {
      title: "释放时间",
      dataIndex: "releasedAt",
      width: 150,
      render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm"),
    },
    {
      title:
        recordKind === "ip"
          ? "IP 地址"
          : recordKind === "rack"
            ? "U 位"
            : "资源类型",
      width: 140,
      render: (_v, row) =>
        "address" in row
          ? row.address
          : "uNumber" in row
            ? `U${row.uNumber}`
            : labelOf(ALLOCATION_RESOURCE_TYPES, row.resourceType),
    },
    {
      title: "客户",
      width: 160,
      render: (_v, row) => row.allocation.customer?.name ?? "—",
    },
    {
      title: "分配记录",
      render: (_v, row) => row.allocation.resourceName,
    },
    {
      title: "释放批次",
      width: 150,
      render: (_v, row) =>
        row.releaseBatchId ? (
          <Typography.Text code copyable={{ text: row.releaseBatchId }}>
            {row.releaseBatchId.slice(0, 8)}
          </Typography.Text>
        ) : (
          "—"
        ),
    },
    {
      title: "操作人",
      width: 110,
      render: (_v, row) => <Maybe value={row.releasedByName} />,
    },
    {
      title: "释放备注",
      render: (_v, row) => <Maybe value={row.releaseNote} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="资源分配"
        description="多客户批量增减 9 类资源；IP 分配以单个 IP、机柜分配以单个 U 位为占用单元，支持任意区间/集合分配、部分释放与批量释放，释放记录永久保留。"
        extra={
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增分配
            </Button>
          </Space>
        }
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "allocations",
            label: `分配记录${data ? ` (${data.total})` : ""}`,
            children: (
              <>
                <div className="rm-toolbar">
                  <div className="rm-toolbar-filters">
                    <DebouncedSearchInput
                      value={keyword}
                      placeholder="搜索客户 / 资源名称 / 备注 / 区间内 IP"
                      style={{ width: 280 }}
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
                  <Space>
                    <Button
                      danger
                      disabled={selectedIds.length === 0}
                      onClick={openBatchRelease}
                    >
                      批量释放（{selectedIds.length}）
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
                      刷新
                    </Button>
                  </Space>
                </div>

                <Table<AllocationRow>
                  rowKey="id"
                  size="middle"
                  loading={isLoading}
                  dataSource={data?.items ?? []}
                  columns={columns}
                  scroll={{ x: 1560 }}
                  rowSelection={{
                    selectedRowKeys: selectedIds,
                    onChange: setSelectedIds,
                    getCheckboxProps: (row) => ({
                      disabled: row.releasedAt !== null,
                    }),
                  }}
                  expandable={{
                    rowExpandable: (row) =>
                      row.resourceType === "ipRange" ||
                      row.resourceType === "rack",
                    expandedRowRender: (row) =>
                      row.resourceType === "rack" ? (
                        <RackAllocationItemsPanel
                          allocation={row}
                          version={itemsVersion}
                          onRelease={(units) => openRelease(row, undefined, units)}
                        />
                      ) : (
                        <AllocationItemsPanel
                          allocation={row}
                          version={itemsVersion}
                          onRelease={(addresses) => openRelease(row, addresses)}
                        />
                      ),
                  }}
                  pagination={{
                    current: page,
                    pageSize,
                    total: data?.total ?? 0,
                    showSizeChanger: true,
                    showTotal: (t) => `共 ${t} 条`,
                    onChange: (p, ps) => {
                      setPage(p);
                      setPageSize(ps);
                      setSelectedIds([]);
                    },
                  }}
                  locale={{ emptyText: error ? errorMessage(error) : "暂无分配记录" }}
                />
              </>
            ),
          },
          {
            key: "records",
            label: "释放记录",
            children: (
              <>
                <div className="rm-toolbar">
                  <div className="rm-toolbar-filters">
                    <Segmented
                      value={recordKind}
                      options={[
                        { label: "IP 记录", value: "ip" },
                        { label: "机柜 U 位记录", value: "rack" },
                        { label: "其他资源", value: "other" },
                      ]}
                      onChange={(value) => {
                        setRecordKind(value as "ip" | "rack");
                        setRecordsKeyword("");
                        setRecordsPage(1);
                      }}
                    />
                    <DebouncedSearchInput
                      value={recordsKeyword}
                      placeholder={
                        recordKind === "ip"
                          ? "搜索 IP / 客户 / 分配记录 / 批次"
                          : recordKind === "rack"
                            ? "搜索 U 位 / 客户 / 分配记录 / 批次"
                            : "搜索资源 / 客户 / 分配记录 / 批次"
                      }
                      style={{ width: 280 }}
                      onSearch={(v) => {
                        setRecordsKeyword(v);
                        setRecordsPage(1);
                      }}
                    />
                    <PartySelect
                      kind="customer"
                      parties={options?.customers}
                      placeholder="客户"
                      style={{ width: 180 }}
                      value={recordsCustomerId}
                      onChange={(v) => {
                        setRecordsCustomerId(v);
                        setRecordsPage(1);
                      }}
                    />
                  </div>
                  <Button icon={<ReloadOutlined />} onClick={() => void mutateRecords()}>
                    刷新
                  </Button>
                </div>
                <Table<ReleaseRecordRow>
                  rowKey="id"
                  size="middle"
                  loading={recordsLoading}
                  dataSource={records?.items ?? []}
                  columns={recordColumns}
                  scroll={{ x: 1200 }}
                  pagination={{
                    current: recordsPage,
                    pageSize: recordsPageSize,
                    total: records?.total ?? 0,
                    showSizeChanger: true,
                    showTotal: (t) => `共 ${t} 条`,
                    onChange: (p, ps) => {
                      setRecordsPage(p);
                      setRecordsPageSize(ps);
                    },
                  }}
                  locale={{
                    emptyText: recordsError
                      ? errorMessage(recordsError)
                      : "暂无释放记录",
                  }}
                />
              </>
            ),
          },
        ]}
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
          {releasing?.resourceType === "ipRange" ? (
            <Form.Item
              name="ipList"
              label="仅释放部分 IP（可选）"
              extra="支持单个 IP 与起止区间，用逗号、空格或换行分隔；留空则释放该分配下全部有效 IP。"
            >
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 6 }}
                placeholder="例如 192.168.168.1, 192.168.168.3-192.168.168.10"
              />
            </Form.Item>
          ) : null}
          {releasing?.resourceType === "rack" ? (
            <Form.Item
              name="uList"
              label="仅释放部分 U 位（可选）"
              extra="支持单个 U 位与起止区间，用逗号、空格或换行分隔；留空则释放该分配下全部有效 U 位。"
            >
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 6 }}
                placeholder="例如 1, 3, 5-8"
              />
            </Form.Item>
          ) : null}
          <Form.Item name="releaseNote" label="释放备注（可选）">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={batchReleasing}
        title={`批量释放 ${selectedIds.length} 条分配记录`}
        onCancel={() => setBatchReleasing(false)}
        onOk={() => batchForm.submit()}
        confirmLoading={batchSaving}
        okText="确认批量释放"
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <Form form={batchForm} layout="vertical" onFinish={(values) => void doBatchRelease(values)}>
          <Form.Item name="releasedAt" label="释放日期">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="releaseNote" label="释放备注（可选）">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={2000} />
          </Form.Item>
          <Typography.Text type="secondary">
            将整条释放选中的分配记录；IP 区间与机柜分配会释放其下全部有效明细，并共用同一释放批次。
          </Typography.Text>
        </Form>
      </Modal>
    </div>
  );
}
