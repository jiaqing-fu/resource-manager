"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tree,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { DataNode } from "antd/es/tree";
import {
  DeleteOutlined,
  EditOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { CrudDrawer } from "@/components/CrudDrawer";
import { ImportExport } from "@/components/ImportExport";
import { PartySelect } from "@/components/PartySelect";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { BatchEntryList } from "@/components/batch/BatchEntryList";
import { submitBatch } from "@/components/batch/submitBatch";
import { useOptions } from "@/components/OptionsProvider";
import { useSessionUser } from "@/components/SessionContext";
import { useInitialParams } from "@/components/useInitialParams";
import { apiFetch, buildQuery, errorMessage } from "@/lib/client";
import {
  IP_ADDRESS_ROLES,
  IP_ADDRESS_STATUS,
  IP_BLOCK_ROLES,
  IP_BLOCK_STATUS,
  colorOf,
  labelOf,
} from "@/lib/enums";
import type { BlockTreeNode, IpBlock, ListResult } from "@/lib/types";

type BlockForm = {
  cidr: string;
  parentId?: string | null;
  status: string;
  role: string;
  vlanId?: string | null;
  supplierId?: string | null;
  gateway?: string;
  description?: string;
  assignedAt?: Dayjs | null;
};

type GenerateForm = {
  count: number;
  status: string;
  role: string;
  description?: string;
};

function flattenTree(nodes: BlockTreeNode[]): BlockTreeNode[] {
  const out: BlockTreeNode[] = [];
  const walk = (list: BlockTreeNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function buildTreeData(nodes: BlockTreeNode[]): DataNode[] {
  return nodes.map((node) => ({
    key: node.id,
    title: (
      <span className="rm-tree-node">
        <span className="rm-tree-cidr">{node.cidr}</span>
        <Tag
          color={colorOf(IP_BLOCK_STATUS, node.status)}
          style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: "16px" }}
        >
          {labelOf(IP_BLOCK_STATUS, node.status)}
        </Tag>
        <span className="rm-tree-percent">
          {node.used}/{node.total ?? "?"} · {node.percent ?? 0}%
        </span>
      </span>
    ),
    children: node.children.length > 0 ? buildTreeData(node.children) : undefined,
  }));
}

const defaults = (): BlockForm => ({ cidr: "", status: "active", role: "other" });

export default function IpBlocksPage() {
  const router = useRouter();
  const user = useSessionUser();
  const isAdmin = user.role === "ADMIN";
  const { message } = App.useApp();
  const { data: options, mutate: mutateOptions } = useOptions();
  const initial = useInitialParams("keyword,supplierId,customerId");

  const { data: tree, error: treeError, mutate: mutateTree } = useSWR<{ items: BlockTreeNode[] }>(
    "/api/ip-blocks/tree",
  );
  const treeNodes = useMemo(() => flattenTree(tree?.items ?? []), [tree]);
  const treeMap = useMemo(() => new Map(treeNodes.map((n) => [n.id, n])), [treeNodes]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: selected, mutate: mutateSelected } = useSWR<IpBlock>(
    selectedId ? `/api/ip-blocks/${selectedId}` : null,
  );

  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [status, setStatus] = useState<string | undefined>();
  const [role, setRole] = useState<string | undefined>();
  const [supplierId, setSupplierId] = useState<string | undefined>(initial.supplierId);
  const [customerId, setCustomerId] = useState<string | undefined>(initial.customerId);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const filters = {
    keyword,
    status,
    role,
    supplierId,
    customerId,
    parentId: selectedId ?? undefined,
    page,
    pageSize,
  };
  const { data, error, isLoading, mutate } = useSWR<ListResult<IpBlock>>(
    `/api/ip-blocks${buildQuery(filters)}`,
  );

  const [form] = Form.useForm<{ items: BlockForm[] }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<IpBlock | null>(null);
  const [saving, setSaving] = useState(false);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateForm] = Form.useForm<GenerateForm>();

  const refreshAll = async () => {
    await Promise.all([mutate(), mutateTree(), mutateSelected(), mutateOptions()]);
  };

  const parentOptions = (options?.ipBlocks ?? []).map((b) => ({
    value: b.id,
    label: b.cidr,
    supplierId: b.supplierId,
  }));
  const vlanOptions = (options?.vlans ?? []).map((v) => ({
    value: v.id,
    label: `VLAN ${v.vid} ${v.name}`,
    supplierId: v.supplierId,
  }));

  const openCreate = (parentId?: string) => {
    setEditing(null);
    const parent = parentOptions.find((p) => p.value === parentId);
    form.resetFields();
    form.setFieldsValue({
      items: [{ ...defaults(), parentId: parentId ?? null, supplierId: parent?.supplierId ?? undefined }],
    });
    setDrawerOpen(true);
  };

  const toForm = (row: IpBlock): BlockForm => ({
    cidr: row.cidr,
    parentId: row.parentId,
    status: row.status,
    role: row.role,
    vlanId: row.vlanId,
    supplierId: row.supplierId,
    gateway: row.gateway ?? undefined,
    description: row.description ?? undefined,
    assignedAt: row.assignedAt ? dayjs(row.assignedAt) : null,
  });

  const openEdit = (row: IpBlock) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({ items: [toForm(row)] });
    setDrawerOpen(true);
  };

  const toPayload = (values: BlockForm) => ({
    cidr: values.cidr.trim(),
    parentId: values.parentId ?? null,
    status: values.status,
    role: values.role,
    vlanId: values.vlanId ?? null,
    supplierId: values.supplierId ?? null,
    gateway: values.gateway?.trim() || null,
    description: values.description?.trim() || null,
    assignedAt: values.assignedAt ? values.assignedAt.format("YYYY-MM-DD") : null,
  });

  const submit = async () => {
    let values: { items: BlockForm[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const items = values.items ?? [];
    if (!editing) {
      const seen = new Set<string>();
      for (let i = 0; i < items.length; i += 1) {
        const cidr = items[i].cidr?.trim();
        if (!cidr) continue;
        if (seen.has(cidr)) {
          message.error(`第 ${i + 1} 条 CIDR「${cidr}」在本次提交中重复`);
          return;
        }
        seen.add(cidr);
      }
    }
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/ip-blocks/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(items[0])),
        });
        message.success("IP 段已更新");
      } else {
        const result = await submitBatch(items, async (item) => {
          await apiFetch("/api/ip-blocks", {
            method: "POST",
            body: JSON.stringify(toPayload(item)),
          });
        });
        if (result.ok) {
          message.success(`已新增 ${result.count} 个 IP 段`);
        } else {
          message.warning(
            `已成功 ${result.successCount} 条，第 ${result.failedIndex + 1} 条失败：${errorMessage(
              result.error,
            )}`,
          );
        }
      }
      setDrawerOpen(false);
      await refreshAll();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: IpBlock) => {
    try {
      await apiFetch(`/api/ip-blocks/${row.id}`, { method: "DELETE" });
      message.success("IP 段已删除");
      if (selectedId === row.id) setSelectedId(null);
      await refreshAll();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const openGenerate = () => {
    if (!selectedId) return;
    generateForm.resetFields();
    generateForm.setFieldsValue({ count: 10, status: "active", role: "other" });
    setGenerateOpen(true);
  };

  const submitGenerate = async () => {
    let values: GenerateForm;
    try {
      values = await generateForm.validateFields();
    } catch {
      return;
    }
    setGenerating(true);
    try {
      const result = await apiFetch<{ created: number; first: string; last: string }>(
        `/api/ip-blocks/${selectedId}/generate`,
        { method: "POST", body: JSON.stringify(values) },
      );
      message.success(`已生成 ${result.created} 个 IP（${result.first} ~ ${result.last}）`);
      setGenerateOpen(false);
      await refreshAll();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setGenerating(false);
    }
  };

  const supplierRule = (index: number) => ({
    validator: async () => {
      const row = form.getFieldValue(["items", index]) as BlockForm | undefined;
      if (row?.supplierId) return;
      const parent = parentOptions.find((p) => p.value === row?.parentId);
      if (parent?.supplierId) return;
      const vlan = vlanOptions.find((v) => v.value === row?.vlanId);
      if (vlan?.supplierId) return;
      throw new Error("请选择供应商（或选择已关联供应商的父网段/VLAN）");
    },
  });

  const columns: ColumnsType<IpBlock> = [
    {
      title: "CIDR",
      dataIndex: "cidr",
      render: (_v, row) => (
        <a className="rm-mono" onClick={() => setSelectedId(row.id)}>
          {row.cidr}
        </a>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 140,
      render: (v: string) => (
        <Tag color={colorOf(IP_BLOCK_STATUS, v)}>{labelOf(IP_BLOCK_STATUS, v)}</Tag>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 110,
      render: (v: string) => labelOf(IP_BLOCK_ROLES, v),
    },
    {
      title: "父网段",
      width: 150,
      render: (_v, row) => <span className="rm-mono">{row.parent?.cidr ?? "—"}</span>,
    },
    {
      title: "供应商",
      width: 150,
      render: (_v, row) => row.supplier?.name ?? "—",
    },
    {
      title: "客户",
      width: 150,
      render: (_v, row) => row.customer?.name ?? "—",
    },
    {
      title: "VLAN",
      width: 160,
      render: (_v, row) =>
        row.vlan ? `VLAN ${row.vlan.vid} ${row.vlan.name}` : "—",
    },
    {
      title: "利用率",
      width: 130,
      render: (_v, row) => {
        const node = treeMap.get(row.id);
        return node ? (
          <span>
            {node.used}/{node.total ?? "?"}
            <span className="rm-muted">（{node.percent ?? 0}%）</span>
          </span>
        ) : (
          "—"
        );
      },
    },
    {
      title: "IP 数",
      width: 80,
      render: (_v, row) => row._count?.ipAddresses ?? 0,
    },
    {
      title: "操作",
      width: 150,
      fixed: "right",
      render: (_v, row) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          {isAdmin ? (
            <Popconfirm
              title="确认删除该 IP 段？"
              description="仍有子网段、IP 或未释放分配时无法删除。"
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
        title="IP 段管理"
        description="网段层级、容器状态与实时利用率；供应商必填，客户归属通过资源分配产生。"
      />

      <Row gutter={14}>
        <Col xs={24} lg={7} xl={6}>
          <Card
            size="small"
            title="网段树"
            extra={<Tag>{treeNodes.length} 个网段</Tag>}
            styles={{ body: { padding: 0 } }}
          >
            {treeError ? (
              <Alert type="error" showIcon message={errorMessage(treeError)} />
            ) : (
              <div className="rm-prefix-tree">
                <Tree
                  key={tree ? "loaded" : "empty"}
                  showLine
                  blockNode
                  defaultExpandAll
                  selectedKeys={selectedId ? [selectedId] : ["root"]}
                  onSelect={(keys) => {
                    const key = String(keys[0] ?? "root");
                    setSelectedId(key === "root" ? null : key);
                    setPage(1);
                  }}
                  treeData={[
                    { key: "root", title: <span>全部网段</span> },
                    ...buildTreeData(tree?.items ?? []),
                  ]}
                />
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={17} xl={18}>
          {selectedId && selected ? (
            <Card
              size="small"
              title={<span className="rm-mono">{selected.cidr}</span>}
              style={{ marginBottom: 14 }}
              extra={
                <Space wrap>
                  <Button size="small" icon={<NodeIndexOutlined />} onClick={() => openCreate(selected.id)}>
                    新增子段
                  </Button>
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => router.push(`/ip/addresses?blockId=${selected.id}&create=1`)}
                  >
                    新增 IP
                  </Button>
                  <Button size="small" icon={<ThunderboltOutlined />} onClick={openGenerate}>
                    批量生成
                  </Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(selected)}>
                    编辑
                  </Button>
                </Space>
              }
            >
              <Descriptions size="small" column={3}>
                <Descriptions.Item label="状态">
                  {labelOf(IP_BLOCK_STATUS, selected.status)}
                </Descriptions.Item>
                <Descriptions.Item label="角色">
                  {labelOf(IP_BLOCK_ROLES, selected.role)}
                </Descriptions.Item>
                <Descriptions.Item label="父网段">
                  {selected.parent?.cidr ?? "—"}
                </Descriptions.Item>
                <Descriptions.Item label="供应商">{selected.supplier?.name ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="客户">{selected.customer?.name ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="VLAN">
                  {selected.vlan ? `VLAN ${selected.vlan.vid} ${selected.vlan.name}` : "—"}
                </Descriptions.Item>
                <Descriptions.Item label="网关">{selected.gateway ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="分配日期">{selected.assignedAt ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="直接 IP">{selected._count?.ipAddresses ?? 0}</Descriptions.Item>
                <Descriptions.Item label="子网段">{selected._count?.children ?? 0}</Descriptions.Item>
                <Descriptions.Item label="利用率">
                  {treeMap.get(selected.id)?.percent ?? 0}%
                </Descriptions.Item>
                <Descriptions.Item label="描述" span={3}>
                  {selected.description ?? "—"}
                </Descriptions.Item>
              </Descriptions>
              {selected.children && selected.children.length > 0 ? (
                <Space wrap style={{ marginTop: 8 }}>
                  {selected.children.map((child) => (
                    <Tag key={child.id} className="rm-mono" color="blue">
                      {child.cidr}
                    </Tag>
                  ))}
                </Space>
              ) : null}
            </Card>
          ) : (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 14 }}
              message="在左侧选择网段可查看详情、新增子段或批量生成 IP；下方列表显示所选网段的直接子段。"
            />
          )}

          <div className="rm-toolbar">
            <div className="rm-toolbar-filters">
              <DebouncedSearchInput
                value={keyword}
                placeholder="搜索 CIDR / 描述 / 网关 / 供应商"
                style={{ width: 250 }}
                onSearch={(v) => {
                  setKeyword(v);
                  setPage(1);
                }}
              />
              <Select
                allowClear
                placeholder="状态"
                style={{ width: 140 }}
                value={status}
                onChange={(v) => {
                  setStatus(v);
                  setPage(1);
                }}
                options={IP_BLOCK_STATUS}
              />
              <Select
                allowClear
                placeholder="角色"
                style={{ width: 120 }}
                value={role}
                onChange={(v) => {
                  setRole(v);
                  setPage(1);
                }}
                options={IP_BLOCK_ROLES}
              />
              <PartySelect
                kind="supplier"
                parties={options?.suppliers}
                placeholder="供应商"
                style={{ width: 170 }}
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
                style={{ width: 170 }}
                value={customerId}
                onChange={(v) => {
                  setCustomerId(v);
                  setPage(1);
                }}
              />
            </div>
            <Space wrap>
              <ImportExport
                module="ip-blocks"
                moduleLabel="IP 段"
                exportQuery={buildQuery({
                  keyword,
                  status,
                  role,
                  supplierId,
                  customerId,
                  parentId: selectedId ?? undefined,
                })}
                isAdmin={isAdmin}
                onImported={() => void refreshAll()}
              />
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
                新增 IP 段
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void refreshAll()}>
                刷新
              </Button>
            </Space>
          </div>

          <Table<IpBlock>
            rowKey="id"
            size="middle"
            loading={isLoading}
            dataSource={data?.items ?? []}
            columns={columns}
            scroll={{ x: 1260 }}
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
            locale={{ emptyText: error ? errorMessage(error) : "暂无 IP 段" }}
          />
        </Col>
      </Row>

      <CrudDrawer
        open={drawerOpen}
        title={editing ? `编辑 IP 段：${editing.cidr}` : "批量新增 IP 段"}
        onClose={() => setDrawerOpen(false)}
        onSave={() => void submit()}
        saving={saving}
        width={820}
      >
        <Form<{ items: BlockForm[] }> form={form} layout="vertical" requiredMark>
          {editing && editing.supplierId === null ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="该历史 IP 段尚未关联供应商，请补全后保存。"
            />
          ) : null}
          <BatchEntryList
            form={form}
            batch={!editing}
            defaultItem={defaults()}
            renderItem={(field, index) => (
              <>
                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item
                    name={[field.name, "cidr"]}
                    label="CIDR"
                    rules={[{ required: true, message: "请输入 CIDR，如 192.168.1.0/24" }]}
                    style={{ flex: 1 }}
                  >
                    <Input placeholder="192.168.1.0/24" maxLength={100} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "parentId"]}
                    label="父网段（可空，系统按 CIDR 自动推导）"
                    style={{ flex: 1 }}
                  >
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      options={parentOptions}
                      placeholder="自动推导或选择父网段"
                      onChange={(v: string | undefined) => {
                        const parent = parentOptions.find((p) => p.value === v);
                        if (parent?.supplierId) {
                          form.setFieldValue(["items", index, "supplierId"], parent.supplierId);
                        }
                      }}
                    />
                  </Form.Item>
                </Space>
                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "status"]} label="状态" style={{ flex: 1 }}>
                    <Select options={IP_BLOCK_STATUS} />
                  </Form.Item>
                  <Form.Item name={[field.name, "role"]} label="角色" style={{ flex: 1 }}>
                    <Select options={IP_BLOCK_ROLES} />
                  </Form.Item>
                  <Form.Item name={[field.name, "gateway"]} label="网关" style={{ flex: 1 }}>
                    <Input maxLength={100} />
                  </Form.Item>
                  <Form.Item name={[field.name, "assignedAt"]} label="分配日期" style={{ flex: 1 }}>
                    <DatePicker style={{ width: "100%" }} />
                  </Form.Item>
                </Space>
                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "vlanId"]} label="VLAN" style={{ flex: 1 }}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      options={vlanOptions}
                      onChange={(v: string | undefined) => {
                        const vlan = vlanOptions.find((item) => item.value === v);
                        if (vlan?.supplierId) {
                          form.setFieldValue(["items", index, "supplierId"], vlan.supplierId);
                        }
                      }}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "supplierId"]}
                    label="供应商"
                    rules={[supplierRule(index)]}
                    style={{ flex: 1 }}
                  >
                    <PartySelect kind="supplier" parties={options?.suppliers} />
                  </Form.Item>
                </Space>
                <Form.Item name={[field.name, "description"]} label="描述">
                  <Input.TextArea rows={2} maxLength={500} />
                </Form.Item>
              </>
            )}
          />
        </Form>
      </CrudDrawer>

      <Modal
        open={generateOpen}
        title={selected ? `批量生成 IP：${selected.cidr}` : "批量生成 IP"}
        onCancel={() => setGenerateOpen(false)}
        onOk={() => void submitGenerate()}
        okText="开始生成"
        confirmLoading={generating}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="仅支持 IPv4，单次最多 4096 个；自动排除网络地址、广播地址、网关和已存在的 IP。"
        />
        <Form<GenerateForm> form={generateForm} layout="vertical">
          <Form.Item name="count" label="生成数量" rules={[{ required: true }]}>
            <InputNumber min={1} max={4096} style={{ width: "100%" }} />
          </Form.Item>
          <Space size={12} style={{ display: "flex" }}>
            <Form.Item name="status" label="状态" style={{ flex: 1 }}>
              <Select options={IP_ADDRESS_STATUS} />
            </Form.Item>
            <Form.Item name="role" label="角色" style={{ flex: 1 }}>
              <Select options={IP_ADDRESS_ROLES} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="描述">
            <Input maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
