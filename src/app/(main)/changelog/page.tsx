"use client";

import { useState } from "react";
import useSWR from "swr";
import type { Dayjs } from "dayjs";
import {
  Alert,
  Button,
  DatePicker,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { useSessionUser } from "@/components/SessionContext";
import { useInitialParams } from "@/components/useInitialParams";
import { buildQuery, errorMessage } from "@/lib/client";
import { CHANGE_ACTIONS, colorOf, labelOf } from "@/lib/enums";
import { formatDateTime } from "@/lib/dates";
import type { ChangeLog, ListResult } from "@/lib/types";

const RESOURCES = [
  { value: "supplier", label: "供应商" },
  { value: "suppliers", label: "供应商（导入）" },
  { value: "customer", label: "客户" },
  { value: "customers", label: "客户（导入）" },
  { value: "salesperson", label: "业务员" },
  { value: "datacenter", label: "机房（已停用）" },
  { value: "datacenters", label: "机房（已停用，导入）" },
  { value: "rack", label: "机柜" },
  { value: "racks", label: "机柜（导入）" },
  { value: "vlan", label: "VLAN" },
  { value: "vlans", label: "VLAN（导入）" },
  { value: "vxlan", label: "VXLAN" },
  { value: "vxlans", label: "VXLAN（导入）" },
  { value: "ipBlock", label: "IP 段" },
  { value: "ip-blocks", label: "IP 段（导入）" },
  { value: "ipAddress", label: "IP 地址" },
  { value: "ip-addresses", label: "IP 地址（导入）" },
  { value: "device", label: "设备" },
  { value: "devices", label: "设备（导入）" },
  { value: "rosDevice", label: "设备（历史）" },
  { value: "ros-devices", label: "设备（历史导入）" },
  { value: "line", label: "线路" },
  { value: "lines", label: "线路（导入）" },
  { value: "broadband", label: "宽带" },
  { value: "broadbands", label: "宽带（导入）" },
  { value: "resourceAllocation", label: "资源分配" },
  { value: "businessSystem", label: "业务系统" },
  { value: "business-systems", label: "业务系统（导入）" },
  { value: "customerTest", label: "客户测试" },
  { value: "customer-tests", label: "客户测试（导入）" },
  { value: "user", label: "用户" },
  { value: "notification", label: "通知" },
];

function labelForResource(value: string): string {
  return RESOURCES.find((r) => r.value === value)?.label ?? value;
}

function pretty(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

export default function ChangeLogPage() {
  const user = useSessionUser();
  const isAdmin = user.role === "ADMIN";
  const initial = useInitialParams("keyword");
  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [resource, setResource] = useState<string | undefined>();
  const [action, setAction] = useState<string | undefined>();
  const [username, setUsername] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, error, isLoading, mutate } = useSWR<ListResult<ChangeLog>>(
    isAdmin
      ? `/api/changelog${buildQuery({
          keyword,
          resource,
          action,
          username,
          from: range?.[0]?.format("YYYY-MM-DD"),
          to: range?.[1]?.format("YYYY-MM-DD"),
          page,
          pageSize,
        })}`
      : null,
  );

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="变更记录" />
        <Alert type="warning" showIcon message="仅管理员可以查看全局变更记录。" />
      </div>
    );
  }

  const columns: ColumnsType<ChangeLog> = [
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 170,
      render: (v: string) => formatDateTime(v),
    },
    { title: "操作人", dataIndex: "username", width: 120 },
    {
      title: "动作",
      dataIndex: "action",
      width: 100,
      render: (v: string) => (
        <Tag color={colorOf(CHANGE_ACTIONS, v)}>{labelOf(CHANGE_ACTIONS, v)}</Tag>
      ),
    },
    {
      title: "对象",
      dataIndex: "resource",
      width: 150,
      render: (v: string) => labelForResource(v),
    },
    { title: "摘要", dataIndex: "summary" },
    {
      title: "记录 ID",
      dataIndex: "recordId",
      width: 220,
      render: (v: string) => <span className="rm-muted rm-mono">{v}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="变更记录"
        description="记录关键对象的创建、修改、删除、资源分配/释放与整批导入，不保留字段级审计。展开行可查看修改前后数据。"
      />

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            placeholder="搜索摘要 / 操作人 / 记录 ID"
            style={{ width: 250 }}
            onSearch={(v) => {
              setKeyword(v);
              setPage(1);
            }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="对象"
            style={{ width: 170 }}
            value={resource}
            onChange={(v) => {
              setResource(v);
              setPage(1);
            }}
            options={RESOURCES}
          />
          <Select
            allowClear
            placeholder="动作"
            style={{ width: 110 }}
            value={action}
            onChange={(v) => {
              setAction(v);
              setPage(1);
            }}
            options={CHANGE_ACTIONS}
          />
          <DebouncedSearchInput
            value={username ?? ""}
            placeholder="操作人"
            style={{ width: 130 }}
            onSearch={(v) => {
              setUsername(v || undefined);
              setPage(1);
            }}
          />
          <DatePicker.RangePicker
            value={range}
            style={{ width: 250 }}
            onChange={(v) => {
              setRange(v as [Dayjs | null, Dayjs | null] | null);
              setPage(1);
            }}
          />
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
          刷新
        </Button>
      </div>

      <Table<ChangeLog>
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data?.items ?? []}
        columns={columns}
        scroll={{ x: 1100 }}
        expandable={{
          rowExpandable: (row) => Boolean(row.before || row.after),
          expandedRowRender: (row) => (
            <Space size={16} align="start" style={{ width: "100%" }} wrap>
              <div style={{ flex: 1, minWidth: 300 }}>
                <Typography.Text strong>修改前</Typography.Text>
                <pre className="rm-json">{pretty(row.before)}</pre>
              </div>
              <div style={{ flex: 1, minWidth: 300 }}>
                <Typography.Text strong>修改后</Typography.Text>
                <pre className="rm-json">{pretty(row.after)}</pre>
              </div>
            </Space>
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
          },
        }}
        locale={{ emptyText: error ? errorMessage(error) : "暂无变更记录" }}
      />
    </div>
  );
}
