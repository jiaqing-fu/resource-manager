"use client";

import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Drawer,
  Input,
  InputNumber,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { partyOptions } from "@/components/PartySelect";
import { apiFetch, errorMessage } from "@/lib/client";
import { ALLOCATION_RESOURCE_TYPES, labelOf } from "@/lib/enums";
import {
  ipv4LongToIp,
  ipv4ToLong,
  MAX_RANGE_ALLOCATION_ADDRESSES,
  parseIpRange,
  parseIpv4ListInput,
} from "@/lib/ip";
import {
  MAX_RACK_ALLOCATION_UNITS,
  parseRackUnitListInput,
} from "@/lib/rack";
import { subtractRanges } from "@/lib/ranges";
import type { OptionsData, ResourceAllocation } from "@/lib/types";

const RESOURCE_ORDER = [
  "ipAddress",
  "ipBlock",
  "ipRange",
  "rack",
  "device",
  "vlan",
  "vxlan",
  "broadband",
  "line",
] as const;

type ResourceType = (typeof RESOURCE_ORDER)[number];

type AllocationOption = {
  id: string;
  name: string;
  supplierId: string | null;
  supplierName: string | null;
  customerId: string | null;
  status: string | null;
  location?: string | null;
  uStart?: number;
  uEnd?: number;
  bandwidthMbps?: number | null;
  allocatedMbps?: number;
  reusePercent?: number | null;
  occupiedRanges?: Array<{
    allocationId: string;
    customerId: string;
    customerName: string;
    uStart: number;
    uEnd: number;
  }>;
  freeRanges?: Array<{ start: number; end: number }>;
  blockId?: string;
  blockName?: string;
  kind?: string;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  occupiedIpRanges?: Array<{
    allocationId: string;
    customerId: string;
    customerName: string;
    startIp: string;
    endIp: string;
  }>;
  freeIpRanges?: Array<{ startIp: string; endIp: string }>;
};

type WorkspaceAllocation = ResourceAllocation & { currentResourceName: string };

type WorkspaceData = {
  customerId: string;
  allocations: WorkspaceAllocation[];
  resources: Record<ResourceType, AllocationOption[]>;
};

type DraftCreate = {
  key: string;
  resourceType: ResourceType;
  resourceId?: string;
  uStart?: number | null;
  uEnd?: number | null;
  /** rack 输入的两种方式：连续起止 U，或任意 U 位列表。 */
  uMode?: "range" | "list";
  uList?: string | null;
  /** ipRange 输入的两种方式：连续起止区间，或任意 IP/区间列表。 */
  ipMode?: "range" | "list";
  ipRangeStart?: string | null;
  ipRangeEnd?: string | null;
  ipList?: string | null;
  allocatedMbps?: number | null;
};

type DraftIpSet =
  | {
      ok: true;
      addresses: string[];
      startLong: number;
      endLong: number;
      contiguous: boolean;
    }
  | { ok: false; error: string; empty: boolean };

function parseDraftIpSet(draft: DraftCreate): DraftIpSet {
  if ((draft.ipMode ?? "range") === "list") {
    if (!draft.ipList?.trim()) {
      return { ok: false, error: "请填写 IP 或区间列表", empty: true };
    }
    const parsed = parseIpv4ListInput(draft.ipList);
    if (!parsed.ok) return { ok: false, error: parsed.error, empty: false };
    return { ok: true, ...parsed.value };
  }
  if (!draft.ipRangeStart || !draft.ipRangeEnd) {
    return { ok: false, error: "请填写起始 IP 和结束 IP", empty: true };
  }
  const start = ipv4ToLong(draft.ipRangeStart);
  const end = ipv4ToLong(draft.ipRangeEnd);
  if (start === null || end === null) {
    return { ok: false, error: "起止 IP 必须是合法的 IPv4 地址", empty: false };
  }
  if (start > end) {
    return { ok: false, error: "结束 IP 不能小于起始 IP", empty: false };
  }
  if (end - start + 1 > MAX_RANGE_ALLOCATION_ADDRESSES) {
    return {
      ok: false,
      error: `单次最多分配 ${MAX_RANGE_ALLOCATION_ADDRESSES} 个地址`,
      empty: false,
    };
  }
  return {
    ok: true,
    addresses: Array.from({ length: end - start + 1 }, (_, index) =>
      ipv4LongToIp(start + index),
    ),
    startLong: start,
    endLong: end,
    contiguous: true,
  };
}

type DraftRackSet =
  | {
      ok: true;
      units: number[];
      start: number;
      end: number;
      contiguous: boolean;
    }
  | { ok: false; error: string; empty: boolean };

function parseDraftRackSet(draft: DraftCreate): DraftRackSet {
  if ((draft.uMode ?? "range") === "list") {
    if (!draft.uList?.trim()) {
      return { ok: false, error: "请填写 U 位或区间列表", empty: true };
    }
    const parsed = parseRackUnitListInput(draft.uList);
    return parsed.ok
      ? { ok: true, ...parsed.value }
      : { ok: false, error: parsed.error, empty: false };
  }
  if (draft.uStart === null || draft.uStart === undefined || draft.uEnd === null || draft.uEnd === undefined) {
    return { ok: false, error: "请填写起始 U 位和结束 U 位", empty: true };
  }
  if (
    !Number.isInteger(draft.uStart) ||
    !Number.isInteger(draft.uEnd) ||
    draft.uStart < 1 ||
    draft.uEnd < draft.uStart
  ) {
    return {
      ok: false,
      error: "U 位必须为大于 0 的整数，且结束不能小于起始",
      empty: false,
    };
  }
  if (draft.uEnd - draft.uStart + 1 > MAX_RACK_ALLOCATION_UNITS) {
    return {
      ok: false,
      error: `单次最多分配 ${MAX_RACK_ALLOCATION_UNITS} 个 U 位`,
      empty: false,
    };
  }
  return {
    ok: true,
    units: Array.from(
      { length: draft.uEnd - draft.uStart + 1 },
      (_, index) => draft.uStart! + index,
    ),
    start: draft.uStart,
    end: draft.uEnd,
    contiguous: true,
  };
}

type GroupState = {
  key: string;
  customerId?: string;
  releases: string[];
  creates: DraftCreate[];
};

let localSeq = 0;
function nextLocalKey(prefix: string): string {
  localSeq += 1;
  return `${prefix}-${Date.now()}-${localSeq}`;
}

function rangeText(start: number, end: number): string {
  return `[${start}-${end}]U`;
}

function optionLabel(type: ResourceType, option: AllocationOption): string {
  if (type === "broadband") {
    const total = option.bandwidthMbps ? `${option.bandwidthMbps} Mbps` : "带宽未知";
    const reuse =
      option.reusePercent !== null && option.reusePercent !== undefined
        ? ` · 复用 ${option.reusePercent}%`
        : "";
    return `${option.name} · 总 ${total} · 已分 ${option.allocatedMbps ?? 0}${reuse}`;
  }
  if (type === "rack") return option.name;
  return `${option.name}${option.supplierName ? ` · ${option.supplierName}` : ""}`;
}

function effectiveFreeRanges(
  option: AllocationOption,
  releasedAllocationIds: Set<string>,
): Array<{ start: number; end: number }> {
  if (option.uStart === undefined || option.uEnd === undefined) return [];
  const occupied = (option.occupiedRanges ?? [])
    .filter((range) => !releasedAllocationIds.has(range.allocationId))
    .map((range) => ({ start: range.uStart, end: range.uEnd }));
  return subtractRanges({ start: option.uStart, end: option.uEnd }, occupied);
}

type IpFreeRange = { startIp: string; endIp: string; startLong: number; endLong: number };

function effectiveFreeIpRanges(
  option: AllocationOption,
  releasedAllocationIds: Set<string>,
): IpFreeRange[] {
  if (!option.rangeStart || !option.rangeEnd) return [];
  const block = parseIpRange(`${option.rangeStart}-${option.rangeEnd}`);
  if (!block || block.startLong === null || block.endLong === null) return [];
  const occupied = (option.occupiedIpRanges ?? [])
    .filter((range) => !releasedAllocationIds.has(range.allocationId))
    .flatMap((range) => {
      const parsed = parseIpRange(`${range.startIp}-${range.endIp}`);
      if (!parsed || parsed.startLong === null || parsed.endLong === null) return [];
      return [{ start: parsed.startLong, end: parsed.endLong }];
    });
  return subtractRanges(
    { start: block.startLong, end: block.endLong },
    occupied,
  ).map((range) => ({
    startIp: ipv4LongToIp(range.start),
    endIp: ipv4LongToIp(range.end),
    startLong: range.start,
    endLong: range.end,
  }));
}

function defaultIpRange(free: IpFreeRange[]): { start: string; end: string } | null {
  const first = free[0];
  if (!first) return null;
  const end = Math.min(
    first.endLong,
    first.startLong + MAX_RANGE_ALLOCATION_ADDRESSES - 1,
  );
  return { start: ipv4LongToIp(first.startLong), end: ipv4LongToIp(end) };
}

function ipRangeError(
  type: ResourceType,
  option: AllocationOption | undefined,
  draft: DraftCreate,
  releasedAllocationIds: Set<string>,
): string | null {
  if (type !== "ipRange") return null;
  if (!option) return draft.resourceId ? "IP 段数据不存在，请刷新" : null;
  const set = parseDraftIpSet(draft);
  if (!set.ok) return set.empty ? null : set.error;
  if (!option.rangeStart || !option.rangeEnd) return "所选 IP 段没有可分配范围";
  const block = parseIpRange(`${option.rangeStart}-${option.rangeEnd}`);
  if (!block || block.startLong === null || block.endLong === null) {
    return "所选 IP 段范围不合法";
  }
  const outside = set.addresses.find((address) => {
    const n = ipv4ToLong(address);
    return n === null || n < block.startLong! || n > block.endLong!;
  });
  if (outside) {
    return `IP ${outside} 不在 ${option.name} 内`;
  }
  const occupied = (option.occupiedIpRanges ?? []).find((range) => {
    if (releasedAllocationIds.has(range.allocationId)) return false;
    const parsed = parseIpRange(`${range.startIp}-${range.endIp}`);
    if (!parsed || parsed.startLong === null || parsed.endLong === null) return false;
    return set.addresses.some((address) => {
      const n = ipv4ToLong(address);
      return (
        n !== null && n >= parsed.startLong! && n <= parsed.endLong!
      );
    });
  });
  if (occupied) {
    return `与已有区间分配 ${occupied.startIp}-${occupied.endIp}（${occupied.customerName || "其他客户"}）重叠`;
  }
  return null;
}

function rackUnitError(
  option: AllocationOption | undefined,
  draft: DraftCreate,
  releasedAllocationIds: Set<string>,
): string | null {
  if (!option) return draft.resourceId ? "机柜数据不存在，请刷新" : null;
  const set = parseDraftRackSet(draft);
  if (!set.ok) return set.empty ? null : set.error;
  if (option.uStart === undefined || option.uEnd === undefined) {
    return "所选机柜没有可分配范围";
  }
  const outside = set.units.find(
    (u) => u < option.uStart! || u > option.uEnd!,
  );
  if (outside !== undefined) {
    return `U${outside} 不在 ${option.name} 内`;
  }
  const occupied = (option.occupiedRanges ?? []).find((range) => {
    if (releasedAllocationIds.has(range.allocationId)) return false;
    return set.units.some((u) => u >= range.uStart && u <= range.uEnd);
  });
  if (occupied) {
    return `与已有区间分配 ${rangeText(occupied.uStart, occupied.uEnd)}（${occupied.customerName || "其他客户"}）重叠`;
  }
  return null;
}

function DraftRow({
  type,
  draft,
  options,
  releasedAllocationIds,
  onChange,
  onRemove,
}: {
  type: ResourceType;
  draft: DraftCreate;
  options: AllocationOption[];
  releasedAllocationIds: Set<string>;
  onChange: (patch: Partial<DraftCreate>) => void;
  onRemove: () => void;
}) {
  const option = options.find((item) => item.id === draft.resourceId);
  const freeRanges = option ? effectiveFreeRanges(option, releasedAllocationIds) : [];
  const ipFreeRanges =
    option && type === "ipRange" ? effectiveFreeIpRanges(option, releasedAllocationIds) : [];
  const rangeError = ipRangeError(type, option, draft, releasedAllocationIds);
  const draftIpSet = type === "ipRange" ? parseDraftIpSet(draft) : null;
  const draftRackSet = type === "rack" ? parseDraftRackSet(draft) : null;
  const rackError =
    type === "rack"
      ? rackUnitError(option, draft, releasedAllocationIds)
      : null;

  return (
    <div className="rm-allocation-draft">
      <div className="rm-allocation-draft-fields">
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="选择资源"
          style={{ flex: 1, minWidth: 200 }}
          value={draft.resourceId}
          options={options.map((item) => ({
            value: item.id,
            label: optionLabel(type, item),
          }))}
          onChange={(value) => {
            const next = options.find((item) => item.id === value);
            if (type === "rack" && next) {
              const free = effectiveFreeRanges(next, releasedAllocationIds);
              onChange({
                resourceId: value,
                uMode: "range",
                uStart: free[0]?.start ?? next.uStart ?? null,
                uEnd: free[0]?.end ?? next.uStart ?? null,
                uList: null,
                ipRangeStart: null,
                ipRangeEnd: null,
              });
            } else if (type === "ipRange" && next) {
              const free = effectiveFreeIpRanges(next, releasedAllocationIds);
              const preset = defaultIpRange(free);
              onChange({
                resourceId: value,
                uStart: null,
                uEnd: null,
                uMode: "range",
                uList: null,
                ipMode: "range",
                ipRangeStart: preset?.start ?? null,
                ipRangeEnd: preset?.end ?? null,
                ipList: null,
              });
            } else {
              onChange({
                resourceId: value,
                uStart: null,
                uEnd: null,
                uMode: "range",
                uList: null,
                ipMode: "range",
                ipRangeStart: null,
                ipRangeEnd: null,
                ipList: null,
              });
            }
          }}
        />
        {type === "rack" ? (
          <>
            <Segmented
              size="small"
              value={draft.uMode ?? "range"}
              options={[
                { label: "起止 U", value: "range" },
                { label: "U 位列表", value: "list" },
              ]}
              onChange={(value) => onChange({ uMode: value as "range" | "list" })}
            />
            {(draft.uMode ?? "range") === "range" ? (
              <>
                <InputNumber
                  min={option?.uStart ?? 1}
                  max={option?.uEnd ?? 100}
                  precision={0}
                  placeholder="起始 U"
                  style={{ width: 96 }}
                  value={draft.uStart ?? undefined}
                  onChange={(value) => onChange({ uStart: value ?? null })}
                />
                <InputNumber
                  min={option?.uStart ?? 1}
                  max={option?.uEnd ?? 100}
                  precision={0}
                  placeholder="结束 U"
                  style={{ width: 96 }}
                  value={draft.uEnd ?? undefined}
                  onChange={(value) => onChange({ uEnd: value ?? null })}
                />
              </>
            ) : (
              <Input.TextArea
                autoSize={{ minRows: 1, maxRows: 4 }}
                placeholder="如 1, 3, 5-8"
                style={{ flex: 1, minWidth: 240 }}
                value={draft.uList ?? ""}
                onChange={(event) =>
                  onChange({ uList: event.target.value || null })
                }
              />
            )}
          </>
        ) : null}
        {type === "ipRange" ? (
          <>
            <Segmented
              size="small"
              value={draft.ipMode ?? "range"}
              options={[
                { label: "起止 IP", value: "range" },
                { label: "IP/区间列表", value: "list" },
              ]}
              onChange={(value) =>
                onChange({ ipMode: value as "range" | "list" })
              }
            />
            {(draft.ipMode ?? "range") === "range" ? (
              <>
                <Input
                  placeholder="起始 IP"
                  style={{ width: 150 }}
                  value={draft.ipRangeStart ?? ""}
                  onChange={(event) =>
                    onChange({ ipRangeStart: event.target.value || null })
                  }
                />
                <span>—</span>
                <Input
                  placeholder="结束 IP"
                  style={{ width: 150 }}
                  value={draft.ipRangeEnd ?? ""}
                  onChange={(event) =>
                    onChange({ ipRangeEnd: event.target.value || null })
                  }
                />
              </>
            ) : (
              <Input.TextArea
                autoSize={{ minRows: 1, maxRows: 4 }}
                placeholder="如 10.0.0.1, 10.0.0.3-10.0.0.10"
                style={{ flex: 1, minWidth: 280 }}
                value={draft.ipList ?? ""}
                onChange={(event) =>
                  onChange({ ipList: event.target.value || null })
                }
              />
            )}
          </>
        ) : null}
        {type === "broadband" ? (
          <InputNumber
            min={1}
            precision={0}
            placeholder="分配 MBPS"
            style={{ width: 130 }}
            value={draft.allocatedMbps ?? undefined}
            onChange={(value) => onChange({ allocatedMbps: value ?? null })}
          />
        ) : null}
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          aria-label="删除本行"
          onClick={onRemove}
        />
      </div>
      {type === "rack" && option ? (
        <div className={rackError ? "rm-allocation-hint rm-allocation-error" : "rm-allocation-hint"}>
          {rackError ??
            `可选区间：${
              freeRanges.length > 0
                ? freeRanges.map((r) => rangeText(r.start, r.end)).join("、")
                : "暂无空闲（可先释放已有分配）"
            }；单次最多 ${MAX_RACK_ALLOCATION_UNITS} 个 U 位。${
              draftRackSet?.ok
                ? ` 已选择 ${draftRackSet.units.length} 个 U${
                    draftRackSet.contiguous ? "" : "（非连续）"
                  }。`
                : ""
            }`}
        </div>
      ) : null}
      {type === "ipRange" && option ? (
        <div className={rangeError ? "rm-allocation-hint rm-allocation-error" : "rm-allocation-hint"}>
          {rangeError ??
            `可分配范围：${
              ipFreeRanges.length > 0
                ? ipFreeRanges
                    .slice(0, 3)
                    .map((range) => `${range.startIp}-${range.endIp}`)
                    .join("、") +
                  (ipFreeRanges.length > 3 ? ` 等 ${ipFreeRanges.length} 段` : "")
                : "暂无空闲（可先释放已有分配）"
            }；单次最多 ${MAX_RANGE_ALLOCATION_ADDRESSES} 个地址。${
              draftIpSet?.ok
                ? ` 已选择 ${draftIpSet.addresses.length} 个 IP${
                    draftIpSet.contiguous ? "" : "（非连续）"
                  }。`
                : ""
            }`}
        </div>
      ) : null}
      {type === "broadband" && option ? (
        <div className="rm-allocation-hint">
          总带宽 {option.bandwidthMbps ?? "—"} Mbps，已分配 {option.allocatedMbps ?? 0}{" "}
          Mbps
          {option.reusePercent !== null && option.reusePercent !== undefined
            ? `，当前复用率 ${option.reusePercent}%`
            : ""}
          ；允许输入超过总带宽的 MBPS。
        </div>
      ) : null}
    </div>
  );
}

function ResourceSection({
  type,
  group,
  data,
  canAdd,
  releasedAllocationIds,
  onAddCreate,
  onChangeCreate,
  onRemoveCreate,
  onToggleRelease,
}: {
  type: ResourceType;
  group: GroupState;
  data: WorkspaceData | null;
  canAdd: boolean;
  releasedAllocationIds: Set<string>;
  onAddCreate: () => void;
  onChangeCreate: (draftKey: string, patch: Partial<DraftCreate>) => void;
  onRemoveCreate: (draftKey: string) => void;
  onToggleRelease: (allocationId: string) => void;
}) {
  const label = labelOf(ALLOCATION_RESOURCE_TYPES, type);
  const active = data?.allocations.filter((item) => item.resourceType === type) ?? [];
  const drafts = group.creates.filter((item) => item.resourceType === type);
  const options = data?.resources[type] ?? [];

  return (
    <div className="rm-allocation-section">
      <div className="rm-allocation-section-head">
        <span>
          {label}
          {active.length > 0 ? (
            <Tag style={{ marginLeft: 6 }}>{active.length}</Tag>
          ) : null}
        </span>
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          aria-label={`新增${label}`}
          disabled={!canAdd}
          onClick={onAddCreate}
        />
      </div>
      {active.length === 0 && drafts.length === 0 ? (
        <div className="rm-allocation-empty">暂无</div>
      ) : null}
      {active.map((allocation) => {
        const pending = group.releases.includes(allocation.id);
        return (
          <div
            key={allocation.id}
            className={pending ? "rm-allocation-existing rm-allocation-pending" : "rm-allocation-existing"}
          >
            <div className="rm-allocation-row-main">
              <div className="rm-allocation-name">{allocation.currentResourceName}</div>
              <div className="rm-allocation-meta">
                分配于 {dayjs(allocation.allocatedAt).format("YYYY-MM-DD")}
                {pending ? " · 保存后释放" : ""}
              </div>
            </div>
            <Button
              size="small"
              type="text"
              danger={!pending}
              onClick={() => onToggleRelease(allocation.id)}
            >
              {pending ? "撤销释放" : "释放"}
            </Button>
          </div>
        );
      })}
      {drafts.map((draft) => (
        <DraftRow
          key={draft.key}
          type={type}
          draft={draft}
          options={options}
          releasedAllocationIds={releasedAllocationIds}
          onChange={(patch) => onChangeCreate(draft.key, patch)}
          onRemove={() => onRemoveCreate(draft.key)}
        />
      ))}
    </div>
  );
}

function CustomerGroupCard({
  group,
  index,
  customers,
  usedCustomerIds,
  workspaceRef,
  releasedAllocationIds,
  canRemove,
  onCustomerChange,
  onRemoveGroup,
  onAddCreate,
  onChangeCreate,
  onRemoveCreate,
  onToggleRelease,
}: {
  group: GroupState;
  index: number;
  customers: OptionsData["customers"];
  usedCustomerIds: Set<string>;
  workspaceRef: { current: Map<string, WorkspaceData> };
  releasedAllocationIds: Set<string>;
  canRemove: boolean;
  onCustomerChange: (customerId: string | undefined) => void;
  onRemoveGroup: () => void;
  onAddCreate: (type: ResourceType) => void;
  onChangeCreate: (draftKey: string, patch: Partial<DraftCreate>) => void;
  onRemoveCreate: (draftKey: string) => void;
  onToggleRelease: (allocationId: string) => void;
}) {
  const workspaceKey = group.customerId
    ? `/api/resource-allocations/workspace?customerId=${encodeURIComponent(group.customerId)}`
    : null;
  const { data, error, isLoading } = useSWR<WorkspaceData>(workspaceKey);

  useEffect(() => {
    if (data) workspaceRef.current.set(data.customerId, data);
  }, [data, workspaceRef]);

  const disabledCustomerIds = new Set(
    Array.from(usedCustomerIds).filter((id) => id !== group.customerId),
  );
  const selectOptions = partyOptions(customers).map((option) => ({
    ...option,
    disabled: disabledCustomerIds.has(option.value),
  }));

  return (
    <Card
      size="small"
      className="rm-allocation-group"
      title={
        <Space wrap>
          <span>客户 {index + 1}</span>
          <Select
            showSearch
            allowClear
            optionFilterProp="label"
            placeholder="选择客户"
            style={{ width: 280 }}
            value={group.customerId}
            options={selectOptions}
            onChange={(value) => onCustomerChange(value)}
          />
          {group.customerId ? (
            <Tag color="blue">
              待释放 {group.releases.length} / 新增 {group.creates.length}
            </Tag>
          ) : null}
        </Space>
      }
      extra={
        <Button
          danger
          size="small"
          icon={<DeleteOutlined />}
          disabled={!canRemove}
          onClick={onRemoveGroup}
        >
          删除分组
        </Button>
      }
    >
      {!group.customerId ? (
        <Typography.Text type="secondary">
          选择客户后，将列出该客户的 9 类资源当前分配，可用 + / - 增减后一次保存。
        </Typography.Text>
      ) : error ? (
        <Alert type="error" showIcon message={errorMessage(error)} />
      ) : null}
      {!group.customerId ? (
        <div className="rm-allocation-grid">
          {RESOURCE_ORDER.map((type) => (
            <ResourceSection
              key={type}
              type={type}
              group={group}
              data={null}
              canAdd={false}
              releasedAllocationIds={releasedAllocationIds}
              onAddCreate={() => onAddCreate(type)}
              onChangeCreate={onChangeCreate}
              onRemoveCreate={onRemoveCreate}
              onToggleRelease={onToggleRelease}
            />
          ))}
        </div>
      ) : isLoading && !data ? (
        <Spin />
      ) : data ? (
        <div className="rm-allocation-grid">
          {RESOURCE_ORDER.map((type) => (
            <ResourceSection
              key={type}
              type={type}
              group={group}
              data={data}
              canAdd
              releasedAllocationIds={releasedAllocationIds}
              onAddCreate={() => onAddCreate(type)}
              onChangeCreate={onChangeCreate}
              onRemoveCreate={onRemoveCreate}
              onToggleRelease={onToggleRelease}
            />
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export function AllocationWorkbench({
  open,
  onClose,
  customers,
  initialCustomerId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customers: OptionsData["customers"];
  initialCustomerId?: string;
  onSaved: () => Promise<void> | void;
}) {
  const { message } = App.useApp();
  const { mutate: globalMutate } = useSWRConfig();
  const [groups, setGroups] = useState<GroupState[]>(() => [
    {
      key: nextLocalKey("group"),
      customerId: initialCustomerId,
      releases: [],
      creates: [],
    },
  ]);
  const [allocatedAt, setAllocatedAt] = useState<Dayjs | null>(dayjs());
  const [releasedAt, setReleasedAt] = useState<Dayjs | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const workspaceRef = useRef<Map<string, WorkspaceData>>(new Map());

  const usedCustomerIds = new Set(
    groups.map((group) => group.customerId).filter((id): id is string => Boolean(id)),
  );
  const releasedAllocationIds = new Set(groups.flatMap((group) => group.releases));
  const createCount = groups.reduce((sum, group) => sum + group.creates.length, 0);
  const releaseCount = releasedAllocationIds.size;

  const updateGroup = (groupKey: string, patch: Partial<GroupState>) => {
    setGroups((previous) =>
      previous.map((group) => (group.key === groupKey ? { ...group, ...patch } : group)),
    );
  };

  const addGroup = () => {
    setGroups((previous) => {
      if (previous.length >= 20) return previous;
      return [
        ...previous,
        { key: nextLocalKey("group"), releases: [], creates: [] },
      ];
    });
  };

  const validate = (): string | null => {
    if (groups.length === 0) return "请至少添加一个客户分组";
    for (let i = 0; i < groups.length; i += 1) {
      if (!groups[i].customerId) return `客户分组 ${i + 1} 尚未选择客户`;
    }
    if (new Set(groups.map((group) => group.customerId)).size !== groups.length) {
      return "同一批保存中不能重复选择客户";
    }
    if (createCount + releaseCount === 0) return "请至少新增或释放一项资源";

    const releaseDate = releasedAt ?? dayjs();
    const allocationsById = new Map<string, WorkspaceAllocation>();
    const rackOptions = new Map<string, AllocationOption>();
    const ipRangeOptions = new Map<string, AllocationOption>();
    for (const group of groups) {
      const workspace = group.customerId
        ? workspaceRef.current.get(group.customerId)
        : undefined;
      for (const allocation of workspace?.allocations ?? []) {
        allocationsById.set(allocation.id, allocation);
      }
      for (const option of workspace?.resources.rack ?? []) {
        rackOptions.set(option.id, option);
      }
      for (const option of workspace?.resources.ipRange ?? []) {
        ipRangeOptions.set(option.id, option);
      }
    }

    const seenSingle = new Map<string, string>();
    const seenRackUnits = new Map<string, string>();
    const seenIpAddresses = new Map<number, string>();

    for (const group of groups) {
      const customerName =
        customers.find((customer) => customer.id === group.customerId)?.name ??
        "该客户";

      for (const allocationId of group.releases) {
        const allocation = allocationsById.get(allocationId);
        if (
          allocation &&
          releaseDate.startOf("day").isBefore(dayjs(allocation.allocatedAt).startOf("day"))
        ) {
          return `释放日期不能早于「${allocation.currentResourceName}」的分配日期`;
        }
      }

      for (const create of group.creates) {
        if (!create.resourceId) return `客户「${customerName}」有未选择资源的分配行`;
        if (create.resourceType === "rack") {
          const option = rackOptions.get(create.resourceId);
          if (!option || option.uStart === undefined || option.uEnd === undefined) {
            return "机柜数据尚未加载完成，请稍候再保存";
          }
          const set = parseDraftRackSet(create);
          if (!set.ok) {
            return `客户「${customerName}」的机柜分配不合法：${set.error}`;
          }
          const outside = set.units.find(
            (u) => u < option.uStart! || u > option.uEnd!,
          );
          if (outside !== undefined) {
            return `客户「${customerName}」的 U${outside} 不在 ${option.name} 内`;
          }
          const occupied = (option.occupiedRanges ?? []).find((range) => {
            if (releasedAllocationIds.has(range.allocationId)) return false;
            return set.units.some(
              (u) => u >= range.uStart && u <= range.uEnd,
            );
          });
          if (occupied) {
            return `客户「${customerName}」的机柜分配与已有分配（${occupied.customerName || "其他客户"} ${rangeText(occupied.uStart, occupied.uEnd)}）重叠`;
          }
          for (const u of set.units) {
            const key = `${create.resourceId}:${u}`;
            const previous = seenRackUnits.get(key);
            if (previous) {
              return `机柜 U${u} 同时出现在客户「${previous}」与「${customerName}」本次填写的分配中`;
            }
            seenRackUnits.set(key, customerName);
          }
        } else if (create.resourceType === "broadband") {
          if (
            create.allocatedMbps === null ||
            create.allocatedMbps === undefined ||
            !Number.isInteger(create.allocatedMbps) ||
            create.allocatedMbps <= 0
          ) {
            return `客户「${customerName}」的宽带分配 MBPS 必须是大于 0 的整数`;
          }
        } else if (create.resourceType === "ipRange") {
          const option = ipRangeOptions.get(create.resourceId);
          if (!option || !option.rangeStart || !option.rangeEnd) {
            return "IP 区间数据尚未加载完成，请稍候再保存";
          }
          const set = parseDraftIpSet(create);
          if (!set.ok) {
            return `客户「${customerName}」的 IP 分配不合法：${set.error}`;
          }
          const block = parseIpRange(`${option.rangeStart}-${option.rangeEnd}`);
          if (!block || block.startLong === null || block.endLong === null) {
            return `客户「${customerName}」所选 IP 段范围不合法`;
          }
          const outsideLong = set.addresses
            .map((address) => ipv4ToLong(address))
            .find(
              (n) =>
                n !== null && (n < block.startLong! || n > block.endLong!),
            );
          if (outsideLong !== undefined) {
            return `客户「${customerName}」的 IP ${ipv4LongToIp(outsideLong!)} 不在 ${option.name} 内`;
          }
          const occupied = (option.occupiedIpRanges ?? []).find((range) => {
            if (releasedAllocationIds.has(range.allocationId)) return false;
            const parsed = parseIpRange(`${range.startIp}-${range.endIp}`);
            if (!parsed || parsed.startLong === null || parsed.endLong === null) {
              return false;
            }
            return set.addresses.some((address) => {
              const n = ipv4ToLong(address);
              return (
                n !== null && n >= parsed.startLong! && n <= parsed.endLong!
              );
            });
          });
          if (occupied) {
            return `客户「${customerName}」的 IP 分配与已有分配 ${occupied.startIp}-${occupied.endIp}（${occupied.customerName || "其他客户"}）重叠`;
          }
          for (const address of set.addresses) {
            const n = ipv4ToLong(address);
            if (n === null) continue;
            const previousCustomer = seenIpAddresses.get(n);
            if (previousCustomer) {
              return `IP ${address} 同时出现在客户「${previousCustomer}」与「${customerName}」本次填写的分配中`;
            }
            seenIpAddresses.set(n, customerName);
          }
        } else {
          const resourceKey = `${create.resourceType}:${create.resourceId}`;
          const previousCustomer = seenSingle.get(resourceKey);
          if (previousCustomer) {
            return `同一资源不能同时分配给多个客户（客户「${previousCustomer}」与「${customerName}」）`;
          }
          seenSingle.set(resourceKey, customerName);
        }
      }
    }
    return null;
  };

  const save = async () => {
    const error = validate();
    if (error) {
      message.error(error);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        allocatedAt: allocatedAt ? allocatedAt.format("YYYY-MM-DD") : null,
        releasedAt: releasedAt ? releasedAt.format("YYYY-MM-DD") : null,
        notes: notes.trim() || null,
        groups: groups.map((group) => ({
          customerId: group.customerId,
          releases: group.releases,
          creates: group.creates.map((create) => ({
            resourceType: create.resourceType,
            resourceId: create.resourceId,
            ...(create.resourceType === "rack"
              ? (create.uMode ?? "range") === "list"
                ? { uList: create.uList }
                : { uStart: create.uStart, uEnd: create.uEnd }
              : {}),
            ...(create.resourceType === "ipRange"
              ? (create.ipMode ?? "range") === "list"
                ? { ipList: create.ipList }
                : {
                    ipRangeStart: create.ipRangeStart,
                    ipRangeEnd: create.ipRangeEnd,
                  }
              : {}),
            ...(create.resourceType === "broadband"
              ? { allocatedMbps: create.allocatedMbps }
              : {}),
          })),
        })),
      };
      const result = await apiFetch<{ created: number; released: number }>(
        "/api/resource-allocations/bulk",
        { method: "POST", body: JSON.stringify(payload) },
      );
      message.success(`已新增 ${result.created} 条，释放 ${result.released} 条`);
      await globalMutate(
        (key) =>
          typeof key === "string" &&
          key.startsWith("/api/resource-allocations/workspace"),
        undefined,
        { revalidate: true },
      );
      await onSaved();
      onClose();
    } catch (saveError) {
      message.error(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      width={1200}
      title="批量资源分配工作台"
      onClose={onClose}
      destroyOnHidden
      footer={
        <div className="rm-allocation-footer">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存：新增 {createCount} / 释放 {releaseCount}
          </Button>
        </div>
      }
    >
      <div className="rm-allocation-shared">
        <Space wrap size={12}>
          <span>
            分配日期{" "}
            <DatePicker
              value={allocatedAt}
              onChange={setAllocatedAt}
              allowClear
              placeholder="默认今天"
            />
          </span>
          <span>
            释放日期{" "}
            <DatePicker
              value={releasedAt}
              onChange={setReleasedAt}
              allowClear
              placeholder="默认今天"
            />
          </span>
          <Input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="整批备注（可选）"
            maxLength={2000}
            style={{ width: 320 }}
          />
          <Button icon={<PlusOutlined />} onClick={addGroup} disabled={groups.length >= 20}>
            添加客户
          </Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0" }}>
          每个客户分组可独立增减 9 类资源；保存时先释放、再新增，多个客户与多项资源在同一事务内提交。
          机柜分配支持起止 U 或任意 U 位列表，按 U 位互斥；IP 分配支持起止区间或任意 IP/区间列表，按 IP 互斥；宽带允许超分。
        </Typography.Paragraph>
      </div>

      <div className="rm-allocation-groups">
        {groups.map((group, index) => (
          <CustomerGroupCard
            key={group.key}
            group={group}
            index={index}
            customers={customers}
            usedCustomerIds={usedCustomerIds}
            workspaceRef={workspaceRef}
            releasedAllocationIds={releasedAllocationIds}
            canRemove={groups.length > 1}
            onCustomerChange={(customerId) =>
              updateGroup(group.key, { customerId, releases: [], creates: [] })
            }
            onRemoveGroup={() =>
              setGroups((previous) => previous.filter((item) => item.key !== group.key))
            }
            onAddCreate={(type) =>
              updateGroup(group.key, {
                creates: [
                  ...group.creates,
                  { key: nextLocalKey("draft"), resourceType: type },
                ],
              })
            }
            onChangeCreate={(draftKey, patch) =>
              updateGroup(group.key, {
                creates: group.creates.map((create) =>
                  create.key === draftKey ? { ...create, ...patch } : create,
                ),
              })
            }
            onRemoveCreate={(draftKey) =>
              updateGroup(group.key, {
                creates: group.creates.filter((create) => create.key !== draftKey),
              })
            }
            onToggleRelease={(allocationId) =>
              updateGroup(group.key, {
                releases: group.releases.includes(allocationId)
                  ? group.releases.filter((id) => id !== allocationId)
                  : [...group.releases, allocationId],
              })
            }
          />
        ))}
      </div>
    </Drawer>
  );
}
