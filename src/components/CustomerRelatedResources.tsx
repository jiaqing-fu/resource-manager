"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Button, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { Maybe } from "@/components/Tags";
import { apiFetch, buildQuery, errorMessage } from "@/lib/client";
import { allocationDisplayName } from "@/lib/allocation-display";
import {
  ALLOCATION_RESOURCE_TYPES,
  BROADBAND_STATUS,
  DEVICE_ROLES,
  DEVICE_STATUS,
  DEVICE_TYPES,
  IP_ADDRESS_STATUS,
  IP_BLOCK_STATUS,
  LINE_STATUS,
  LINE_TYPES,
  RACK_STATUS,
  TEST_DISPLAY_STATUS,
  VLAN_STATUS,
  VXLAN_STATUS,
  colorOf,
  labelOf,
  type Option,
} from "@/lib/enums";
import type {
  Broadband,
  Counts,
  CustomerTest,
  Device,
  IpAddress,
  IpBlock,
  Line,
  ListResult,
  Rack,
  ResourceAllocation,
  Vlan,
  Vxlan,
} from "@/lib/types";

type AllocationRow = ResourceAllocation & { currentResourceName?: string };

type RelatedRow = {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  status?: { label: string; color?: string };
  supplier?: string | null;
  extra?: ReactNode;
};

type RelatedPage = { total: number; rows: RelatedRow[] };

const RELATED_CATEGORIES = [
  {
    key: "allocations",
    label: "资源分配",
    unit: "条",
    color: "gold",
    href: "/resource-allocations",
  },
  { key: "ipAddresses", label: "IP 地址", unit: "个", color: "blue", href: "/ip/addresses" },
  { key: "ipBlocks", label: "IP 段", unit: "个", color: "blue", href: "/ip/blocks" },
  { key: "vlans", label: "VLAN", unit: "个", color: "cyan", href: "/vlans" },
  { key: "vxlans", label: "VXLAN", unit: "个", color: "cyan", href: "/vxlans" },
  { key: "broadbands", label: "宽带", unit: "条", color: "orange", href: "/broadbands" },
  { key: "lines", label: "线路", unit: "条", color: "cyan", href: "/lines" },
  { key: "racks", label: "机柜", unit: "个", color: "geekblue", href: "/racks" },
  { key: "devices", label: "设备", unit: "台", color: "purple", href: "/devices" },
  {
    key: "customerTests",
    label: "测试",
    unit: "条",
    color: "orange",
    href: "/customer-tests",
  },
] as const;

type RelatedCategory = (typeof RELATED_CATEGORIES)[number];
type RelatedKey = RelatedCategory["key"];

function formatDate(value: string | null | undefined): string {
  return value ? dayjs(value).format("YYYY-MM-DD") : "—";
}

function resourceStatus(
  options: Option[],
  value: unknown,
): RelatedRow["status"] {
  if (value === null || value === undefined || value === "") return undefined;
  return { label: labelOf(options, value), color: colorOf(options, value) };
}

function toAllocationRow(row: AllocationRow): RelatedRow {
  return {
    id: row.id,
    title:
      row.currentResourceName ??
      allocationDisplayName({
        ...row,
        rack: row.rack ?? null,
        ipBlock: row.ipBlock ?? null,
        ipAddress: row.ipAddress ?? null,
        vlan: row.vlan ?? null,
        vxlan: row.vxlan ?? null,
        broadband: row.broadband ?? null,
        line: row.line ?? null,
        device: row.device ?? null,
      }),
    subtitle: labelOf(ALLOCATION_RESOURCE_TYPES, row.resourceType),
    status: row.releasedAt
      ? { label: "已释放", color: "default" }
      : { label: "有效", color: "green" },
    supplier: row.supplierName,
    extra: (
      <Space size={8} wrap>
        <span>分配 {formatDate(row.allocatedAt)}</span>
        {row.releasedAt ? <span>释放 {formatDate(row.releasedAt)}</span> : null}
        {row.notes ? <span>{row.notes}</span> : null}
      </Space>
    ),
  };
}

function toIpAddressRow(row: IpAddress): RelatedRow {
  const isRange = row.block?.kind === "range";
  const blockText = row.block
    ? isRange
      ? `${row.block.rangeStart ?? "?"}-${row.block.rangeEnd ?? "?"}`
      : row.block.cidr
    : null;
  return {
    id: row.id,
    title: (
      <Space size={6}>
        <Typography.Text code>{row.address}</Typography.Text>
        {row.isPrimary ? <Tag color="gold">主 IP</Tag> : null}
      </Space>
    ),
    subtitle: row.dnsName || row.description,
    status: resourceStatus(IP_ADDRESS_STATUS, row.status),
    supplier: row.supplier?.name,
    extra: (
      <Space size={8} wrap>
        {blockText ? (
          <span>
            {isRange ? "IP 区间" : "网段"} {blockText}
          </span>
        ) : null}
        {row.device ? <span>设备 {row.device.name}</span> : null}
        {row.line ? <span>线路 {row.line.code}</span> : null}
        {row.rack ? <span>机柜 {row.rack.code}</span> : null}
      </Space>
    ),
  };
}

function toIpBlockRow(row: IpBlock, customerId: string): RelatedRow {
  const allocations = row.allocations ?? [];
  const ranges = allocations
    .filter(
      (allocation) =>
        allocation.resourceType === "ipRange" &&
        allocation.ipRangeStart &&
        allocation.ipRangeEnd,
    )
    .map((allocation) => `${allocation.ipRangeStart}-${allocation.ipRangeEnd}`);
  const whole =
    row.customerId === customerId ||
    allocations.some((allocation) => allocation.resourceType === "ipBlock");
  const relation = ranges.length
    ? `本客户区间 ${ranges.join("、")}`
    : whole
      ? "整段分配"
      : "存在区间分配";
  const ipCount = row._count?.ipAddresses ?? 0;
  return {
    id: row.id,
    title: <Typography.Text code>{row.cidr}</Typography.Text>,
    subtitle:
      row.kind === "range"
        ? "IP 区间"
        : row.parent
          ? `父网段 ${row.parent.cidr}`
          : "CIDR 网段",
    status: resourceStatus(IP_BLOCK_STATUS, row.status),
    supplier: row.supplier?.name,
    extra: (
      <Space size={8} wrap>
        <span>
          {row.kind === "range" ? `区间内 ${ipCount} 个 IP` : `${ipCount} 个 IP`}
        </span>
        <span>{relation}</span>
        {row.vlan ? <span>VLAN {row.vlan.vid}</span> : null}
      </Space>
    ),
  };
}

function toVlanRow(row: Vlan): RelatedRow {
  return {
    id: row.id,
    title: `VLAN ${row.vid}${row.name ? ` ${row.name}` : ""}`,
    subtitle: row.description,
    status: resourceStatus(VLAN_STATUS, row.status),
    supplier: row.supplier?.name,
    extra: (
      <Space size={8} wrap>
        <span>{row._count?.ipBlocks ?? 0} 个 IP 段</span>
        {row.vxlan ? (
          <span>VXLAN {row.vxlan.vni}</span>
        ) : (
          <span>未关联 VXLAN</span>
        )}
      </Space>
    ),
  };
}

function toVxlanRow(row: Vxlan): RelatedRow {
  return {
    id: row.id,
    title: `VXLAN ${row.vni}${row.name ? ` ${row.name}` : ""}`,
    subtitle: row.description,
    status: resourceStatus(VXLAN_STATUS, row.status),
    supplier: row.supplier?.name,
    extra: row.vlan ? (
      <span>
        VLAN {row.vlan.vid} {row.vlan.name}
      </span>
    ) : (
      <span>未关联 VLAN</span>
    ),
  };
}

function toBroadbandRow(row: Broadband, customerId: string): RelatedRow {
  const mine = (row.allocations ?? []).filter(
    (allocation) => allocation.customerId === customerId,
  );
  const allocated = mine.reduce(
    (sum, allocation) => sum + (allocation.allocatedMbps ?? 0),
    0,
  );
  const sharedCount = row.customerNames?.length ?? 0;
  return {
    id: row.id,
    title: row.name,
    subtitle: row.account || row.installAddress,
    status: resourceStatus(BROADBAND_STATUS, row.status),
    supplier: row.supplier?.name,
    extra: (
      <Space size={8} wrap>
        <span>总带宽 {row.bandwidthMbps ?? "—"} Mbps</span>
        <span>本客户 {allocated} Mbps</span>
        {sharedCount > 1 ? <span>共享 {sharedCount} 个客户</span> : null}
        {row.expireDate ? <span>到期 {formatDate(row.expireDate)}</span> : null}
      </Space>
    ),
  };
}

function toLineRow(row: Line): RelatedRow {
  return {
    id: row.id,
    title: `${row.code} ${row.name}`,
    subtitle: row.circuitNo || row.description,
    status: resourceStatus(LINE_STATUS, row.status),
    supplier: row.supplier?.name,
    extra: (
      <Space size={8} wrap>
        <span>{labelOf(LINE_TYPES, row.type)}</span>
        {row.bandwidthMbps ? <span>{row.bandwidthMbps} Mbps</span> : null}
        {row.expireDate ? <span>到期 {formatDate(row.expireDate)}</span> : null}
      </Space>
    ),
  };
}

function toRackRow(row: Rack, customerId: string): RelatedRow {
  const mine = (row.allocations ?? []).filter(
    (allocation) => allocation.customerId === customerId,
  );
  const sharedCount = row.customerNames?.length ?? 0;
  return {
    id: row.id,
    title: row.code,
    subtitle: [row.location, `${row.uStart}-${row.uEnd}U`]
      .filter(Boolean)
      .join(" · "),
    status: resourceStatus(RACK_STATUS, row.status),
    supplier: row.supplier?.name,
    extra: (
      <Space size={8} wrap>
        <span>
          已用 {row.usedU ?? 0}/{row.maxU ?? 0}U
        </span>
        <span>本客户 {mine.length} 条分配</span>
        {sharedCount > 1 ? <span>共享 {sharedCount} 个客户</span> : null}
      </Space>
    ),
  };
}

function toDeviceRow(row: Device): RelatedRow {
  const primaryIp = row.ipAddresses?.[0]?.address;
  return {
    id: row.id,
    title: row.name,
    subtitle: [row.manufacturer, row.model, row.serialNo]
      .filter(Boolean)
      .join(" · "),
    status: resourceStatus(DEVICE_STATUS, row.status),
    supplier: row.supplier?.name,
    extra: (
      <Space size={8} wrap>
        <span>{labelOf(DEVICE_TYPES, row.type)}</span>
        <span>{labelOf(DEVICE_ROLES, row.role)}</span>
        {row.rack ? (
          <span>
            机柜 {row.rack.code}
            {row.uStart !== null ? ` U${row.uStart}` : ""}
          </span>
        ) : (
          <span>未上架</span>
        )}
        {primaryIp ? <span>主 IP {primaryIp}</span> : null}
      </Space>
    ),
  };
}

function toCustomerTestRow(row: CustomerTest): RelatedRow {
  return {
    id: row.id,
    title: `#${row.seqNo} ${row.companyName}`,
    subtitle: row.content || row.salesperson,
    status: resourceStatus(TEST_DISPLAY_STATUS, row.displayStatus),
    supplier: null,
    extra: (
      <Space size={8} wrap>
        <span>
          {formatDate(row.startAt)} ~ {formatDate(row.endAt)}
        </span>
        <span>{row.accepted ? "已验收" : "未验收"}</span>
        <span>{row.converted ? "已转化" : "未转化"}</span>
      </Space>
    ),
  };
}

async function loadRelatedPage(
  key: RelatedKey,
  customerId: string,
  page: number,
  pageSize: number,
): Promise<RelatedPage> {
  const query = buildQuery({ customerId, page, pageSize });
  switch (key) {
    case "allocations": {
      const res = await apiFetch<ListResult<AllocationRow>>(
        `/api/resource-allocations${query}`,
      );
      return { total: res.total, rows: res.items.map(toAllocationRow) };
    }
    case "ipAddresses": {
      const res = await apiFetch<ListResult<IpAddress>>(
        `/api/ip-addresses${query}`,
      );
      return { total: res.total, rows: res.items.map(toIpAddressRow) };
    }
    case "ipBlocks": {
      const res = await apiFetch<ListResult<IpBlock>>(
        `/api/ip-blocks${query}`,
      );
      return {
        total: res.total,
        rows: res.items.map((row) => toIpBlockRow(row, customerId)),
      };
    }
    case "vlans": {
      const res = await apiFetch<ListResult<Vlan>>(`/api/vlans${query}`);
      return { total: res.total, rows: res.items.map(toVlanRow) };
    }
    case "vxlans": {
      const res = await apiFetch<ListResult<Vxlan>>(`/api/vxlans${query}`);
      return { total: res.total, rows: res.items.map(toVxlanRow) };
    }
    case "broadbands": {
      const res = await apiFetch<ListResult<Broadband>>(
        `/api/broadbands${query}`,
      );
      return {
        total: res.total,
        rows: res.items.map((row) => toBroadbandRow(row, customerId)),
      };
    }
    case "lines": {
      const res = await apiFetch<ListResult<Line>>(`/api/lines${query}`);
      return { total: res.total, rows: res.items.map(toLineRow) };
    }
    case "racks": {
      const res = await apiFetch<ListResult<Rack>>(`/api/racks${query}`);
      return {
        total: res.total,
        rows: res.items.map((row) => toRackRow(row, customerId)),
      };
    }
    case "devices": {
      const res = await apiFetch<ListResult<Device>>(`/api/devices${query}`);
      return { total: res.total, rows: res.items.map(toDeviceRow) };
    }
    case "customerTests": {
      const res = await apiFetch<ListResult<CustomerTest>>(
        `/api/customer-tests${query}`,
      );
      return { total: res.total, rows: res.items.map(toCustomerTestRow) };
    }
    default: {
      const exhaustive: never = key;
      throw new Error(`未知关联资源分类：${exhaustive}`);
    }
  }
}

const RELATED_COLUMNS: ColumnsType<RelatedRow> = [
  {
    title: "资源",
    dataIndex: "title",
    render: (_value, row) => (
      <div>
        <div>{row.title}</div>
        {row.subtitle ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.subtitle}
          </Typography.Text>
        ) : null}
      </div>
    ),
  },
  {
    title: "状态",
    width: 100,
    render: (_value, row) =>
      row.status ? (
        <Tag color={row.status.color}>{row.status.label}</Tag>
      ) : (
        <span className="rm-muted">—</span>
      ),
  },
  {
    title: "供应商",
    width: 150,
    render: (_value, row) => <Maybe value={row.supplier} />,
  },
  {
    title: "补充",
    render: (_value, row) =>
      row.extra ? row.extra : <span className="rm-muted">—</span>,
  },
];

export function CustomerRelatedResources({
  customerId,
  counts,
}: {
  customerId: string;
  counts?: Counts;
}) {
  const [active, setActive] = useState<RelatedKey | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const request = active
    ? {
        key: ["customer-related", customerId, active, page, pageSize] as const,
        load: () => loadRelatedPage(active, customerId, page, pageSize),
      }
    : null;

  const { data, error, isLoading, isValidating, mutate } =
    useSWR<RelatedPage>(request?.key ?? null, request?.load ?? null, {
      keepPreviousData: false,
    });

  const activeCategory = RELATED_CATEGORIES.find(
    (category) => category.key === active,
  );

  const selectCategory = (key: RelatedKey) => {
    setActive(key);
    setPage(1);
  };

  return (
    <div>
      <Space wrap size={[6, 6]}>
        {RELATED_CATEGORIES.map((category) => {
          const selected = active === category.key;
          return (
            <Tag
              key={category.key}
              color={category.color}
              role="button"
              tabIndex={0}
              onClick={() => selectCategory(category.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectCategory(category.key);
                }
              }}
              style={{
                cursor: "pointer",
                fontWeight: selected ? 600 : undefined,
                boxShadow: selected
                  ? "0 0 0 2px rgba(22, 119, 255, 0.25)"
                  : undefined,
              }}
            >
              {counts?.[category.key] ?? 0} {category.unit} {category.label}
            </Tag>
          );
        })}
      </Space>

      {active && activeCategory ? (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 8,
            }}
          >
            <Typography.Text strong>
              {activeCategory.label}（
              {data?.total ?? counts?.[activeCategory.key] ?? 0}）
            </Typography.Text>
            <Space size={8}>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={isValidating}
                onClick={() => void mutate()}
              >
                刷新
              </Button>
              <Link
                href={`${activeCategory.href}?customerId=${customerId}`}
              >
                在资源列表中查看
              </Link>
            </Space>
          </div>
          <Table<RelatedRow>
            rowKey="id"
            size="small"
            loading={isLoading}
            dataSource={data?.rows ?? []}
            columns={RELATED_COLUMNS}
            scroll={{ x: 760 }}
            pagination={{
              current: page,
              pageSize,
              total: data?.total ?? 0,
              size: "small",
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50],
              showTotal: (total) => `共 ${total} 条`,
              onChange: (nextPage, nextSize) => {
                setPage(nextPage);
                setPageSize(nextSize);
              },
            }}
            locale={{
              emptyText: error ? errorMessage(error) : "暂无关联资源",
            }}
          />
        </div>
      ) : (
        <Typography.Text
          type="secondary"
          style={{ display: "block", marginTop: 12 }}
        >
          点击上方分类查看该客户的关联资源。
        </Typography.Text>
      )}
    </div>
  );
}
