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
import { rangesOverlap, rangeWithin, subtractRanges } from "@/lib/ranges";
import type { OptionsData, ResourceAllocation } from "@/lib/types";

const RESOURCE_ORDER = [
  "ipAddress",
  "ipBlock",
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
  allocatedMbps?: number | null;
};

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
  const rackError =
    type === "rack" &&
    option &&
    option.uStart !== undefined &&
    option.uEnd !== undefined &&
    draft.uStart !== null &&
    draft.uStart !== undefined &&
    draft.uEnd !== null &&
    draft.uEnd !== undefined
      ? !rangeWithin(draft.uStart, draft.uEnd, option.uStart, option.uEnd) ||
        draft.uStart > draft.uEnd
        ? "U 区间必须落在机柜记录范围内，且结束 U 位不能小于起始 U 位"
        : (option.occupiedRanges ?? []).some(
            (range) =>
              !releasedAllocationIds.has(range.allocationId) &&
              rangesOverlap(draft.uStart!, draft.uEnd!, range.uStart, range.uEnd),
          )
          ? "该区间与已有有效分配重叠"
          : null
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
                uStart: free[0]?.start ?? next.uStart ?? null,
                uEnd: free[0]?.end ?? next.uStart ?? null,
              });
            } else {
              onChange({ resourceId: value, uStart: null, uEnd: null });
            }
          }}
        />
        {type === "rack" ? (
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
            `可选区间：${freeRanges.length > 0 ? freeRanges.map((r) => rangeText(r.start, r.end)).join("、") : "暂无空闲（可先释放已有分配）"}`}
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
          选择客户后，将列出该客户的 8 类资源当前分配，可用 + / - 增减后一次保存。
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
    }

    const seenSingle = new Map<string, string>();
    const seenRackRanges = new Map<
      string,
      Array<{ uStart: number; uEnd: number; customerName: string }>
    >();

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
          const { uStart, uEnd } = create;
          if (
            uStart === null ||
            uStart === undefined ||
            uEnd === null ||
            uEnd === undefined ||
            !Number.isInteger(uStart) ||
            !Number.isInteger(uEnd) ||
            uStart > uEnd ||
            !rangeWithin(uStart, uEnd, option.uStart, option.uEnd)
          ) {
            return `客户「${customerName}」的机柜区间不合法`;
          }
          const occupied = (option.occupiedRanges ?? []).find(
            (range) =>
              !releasedAllocationIds.has(range.allocationId) &&
              rangesOverlap(uStart, uEnd, range.uStart, range.uEnd),
          );
          if (occupied) {
            return `客户「${customerName}」的机柜区间 ${rangeText(uStart, uEnd)} 与已有分配（${occupied.customerName || "其他客户"} ${rangeText(occupied.uStart, occupied.uEnd)}）重叠`;
          }
          const existingDrafts = seenRackRanges.get(create.resourceId) ?? [];
          const conflict = existingDrafts.find((range) =>
            rangesOverlap(uStart, uEnd, range.uStart, range.uEnd),
          );
          if (conflict) {
            return `机柜区间 ${rangeText(uStart, uEnd)} 与客户「${conflict.customerName}」本次填写的 ${rangeText(conflict.uStart, conflict.uEnd)} 重叠`;
          }
          existingDrafts.push({ uStart, uEnd, customerName });
          seenRackRanges.set(create.resourceId, existingDrafts);
        } else if (create.resourceType === "broadband") {
          if (
            create.allocatedMbps === null ||
            create.allocatedMbps === undefined ||
            !Number.isInteger(create.allocatedMbps) ||
            create.allocatedMbps <= 0
          ) {
            return `客户「${customerName}」的宽带分配 MBPS 必须是大于 0 的整数`;
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
              ? { uStart: create.uStart, uEnd: create.uEnd }
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
          每个客户分组可独立增减 8 类资源；保存时先释放、再新增，多个客户与多项资源在同一事务内提交。
          机柜分配需选择区间记录并填写起止 U；宽带允许超分。
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
