"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  App,
  Button,
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
import { PartyHierarchyFields } from "@/components/PartyHierarchyFields";
import { SupplierContactsEditor } from "@/components/SupplierContactsEditor";
import { Maybe } from "@/components/Tags";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { BatchEntryList } from "@/components/batch/BatchEntryList";
import { submitBatch } from "@/components/batch/submitBatch";
import { useOptions } from "@/components/OptionsProvider";
import { useSessionUser } from "@/components/SessionContext";
import { useInitialParams } from "@/components/useInitialParams";
import { apiFetch, buildQuery, errorMessage } from "@/lib/client";
import {
  PARTY_LEVELS,
  PARTY_STATUS,
  SUPPLIER_CATEGORIES,
  labelOf,
} from "@/lib/enums";
import type { ListResult, Supplier, SupplierContact } from "@/lib/types";

type ContactForm = Omit<SupplierContact, "id" | "supplierId">;

type SupplierForm = {
  name?: string;
  level: string;
  parentId?: string | null;
  category: string;
  asn?: number | null;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  status: string;
  notes?: string;
  contacts?: ContactForm[];
};

const defaults = (): SupplierForm => ({
  level: "1",
  category: "other",
  status: "active",
  contacts: [],
});

export default function SuppliersPage() {
  const user = useSessionUser();
  const isAdmin = user.role === "ADMIN";
  const { message } = App.useApp();
  const { mutate: mutateOptions } = useOptions();
  const initial = useInitialParams("keyword");
  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [level, setLevel] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const filters = { keyword, level, status, category, page, pageSize };
  const { data, error, isLoading, mutate } = useSWR<ListResult<Supplier>>(
    `/api/suppliers${buildQuery(filters)}`,
  );

  const [form] = Form.useForm<{ items: SupplierForm[] }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [detail, setDetail] = useState<Supplier | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const exportQuery = buildQuery({ keyword, level, status, category });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ items: [defaults()] });
    setDrawerOpen(true);
  };

  const openEdit = async (row: Supplier) => {
    setEditing(row);
    setLoadingDetail(true);
    form.resetFields();
    form.setFieldsValue({
      items: [
        {
          name: row.name,
          level: String(row.level),
          parentId: row.parentId,
          category: row.category,
          asn: row.asn,
          contactName: row.contactName ?? undefined,
          phone: row.phone ?? undefined,
          email: row.email ?? undefined,
          address: row.address ?? undefined,
          status: row.status,
          notes: row.notes ?? undefined,
          contacts: [],
        },
      ],
    });
    setDrawerOpen(true);
    try {
      const full = await apiFetch<Supplier>(`/api/suppliers/${row.id}`);
      form.setFieldValue(
        ["items", 0, "contacts"],
        (full.contacts ?? []).map((c) => ({
          name: c.name,
          role: c.role,
          phone: c.phone,
          email: c.email,
          wechat: c.wechat,
          isPrimary: c.isPrimary,
          notes: c.notes,
        })),
      );
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setLoadingDetail(false);
    }
  };

  const openDetail = async (row: Supplier) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await apiFetch<Supplier>(`/api/suppliers/${row.id}`));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const toPayload = (values: SupplierForm) => ({
    name: values.name?.trim(),
    level: Number(values.level),
    parentId: Number(values.level) === 2 ? values.parentId ?? null : null,
    category: values.category,
    asn: values.asn ?? null,
    contactName: values.contactName?.trim() || null,
    phone: values.phone?.trim() || null,
    email: values.email?.trim() || null,
    address: values.address?.trim() || null,
    status: values.status,
    notes: values.notes?.trim() || null,
    contacts:
      values.contacts?.map((c) => ({
        ...c,
        name: c.name?.trim(),
        role: c.role?.trim() || null,
        phone: c.phone?.trim() || null,
        email: c.email?.trim() || null,
        wechat: c.wechat?.trim() || null,
        notes: c.notes?.trim() || null,
        isPrimary: Boolean(c.isPrimary),
      })) ?? [],
  });

  const submit = async () => {
    let values: { items: SupplierForm[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const items = values.items ?? [];
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/suppliers/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(items[0])),
        });
        message.success("供应商已更新");
      } else {
        const result = await submitBatch(items, async (item) => {
          await apiFetch("/api/suppliers", {
            method: "POST",
            body: JSON.stringify(toPayload(item)),
          });
        });
        if (result.ok) {
          message.success(`已新增 ${result.count} 个供应商`);
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

  const remove = async (row: Supplier) => {
    try {
      await apiFetch(`/api/suppliers/${row.id}`, { method: "DELETE" });
      message.success("供应商已删除");
      await mutate();
      await mutateOptions();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const columns: ColumnsType<Supplier> = [
    {
      title: "名称",
      dataIndex: "name",
      render: (_v, row) => (
        <Space size={6}>
          <a onClick={() => void openDetail(row)}>{row.name}</a>
          <Tag color={row.level === 1 ? "geekblue" : "cyan"}>
            {labelOf(PARTY_LEVELS, row.level)}
          </Tag>
        </Space>
      ),
    },
    {
      title: "上级供应商",
      dataIndex: "parent",
      width: 160,
      render: (_v, row) => <Maybe value={row.parent?.name} />,
    },
    {
      title: "分类",
      dataIndex: "category",
      width: 110,
      render: (v: string) => labelOf(SUPPLIER_CATEGORIES, v),
    },
    { title: "联系人", dataIndex: "contactName", width: 120, render: (v) => <Maybe value={v} /> },
    { title: "电话", dataIndex: "phone", width: 140, render: (v) => <Maybe value={v} /> },
    {
      title: "关联",
      width: 230,
      render: (_v, row) => (
        <Space size={4} wrap>
          <Tag>{row._count?.contacts ?? 0} 联系人</Tag>
          <Tag>{row._count?.racks ?? 0} 机柜</Tag>
          <Tag>{row._count?.ipAddresses ?? 0} IP</Tag>
          <Tag>{row._count?.devices ?? 0} 设备</Tag>
          <Tag>{row._count?.lines ?? 0} 线路</Tag>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v: string) => (
        <Tag color={v === "active" ? "green" : "default"}>
          {labelOf(PARTY_STATUS, v)}
        </Tag>
      ),
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
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => void openEdit(row)}>
            编辑
          </Button>
          {isAdmin ? (
            <Popconfirm
              title="确认删除该供应商？"
              description="仍被机柜、IP、VLAN、宽带、设备或线路引用时将无法删除。"
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
        title="供应商管理"
        description="严格两级：一级必须存在，二级挂在一级下；联系方式在编辑抽屉中维护。"
        extra={
          <Space wrap>
            <ImportExport
              module="suppliers"
              moduleLabel="供应商及联系方式"
              exportQuery={exportQuery}
              isAdmin={isAdmin}
              onImported={() => {
                void mutate();
                void mutateOptions();
              }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增供应商
            </Button>
          </Space>
        }
      />

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            placeholder="搜索名称 / 联系人 / 电话 / 邮箱 / 地址"
            style={{ width: 280 }}
            onSearch={(v) => {
              setKeyword(v);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="层级"
            style={{ width: 100 }}
            value={level}
            onChange={(v) => {
              setLevel(v);
              setPage(1);
            }}
            options={PARTY_LEVELS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <Select
            allowClear
            placeholder="分类"
            style={{ width: 110 }}
            value={category}
            onChange={(v) => {
              setCategory(v);
              setPage(1);
            }}
            options={SUPPLIER_CATEGORIES}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 100 }}
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={PARTY_STATUS}
          />
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
          刷新
        </Button>
      </div>

      <Table<Supplier>
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data?.items ?? []}
        columns={columns}
        scroll={{ x: 1200 }}
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
        locale={{ emptyText: error ? errorMessage(error) : "暂无供应商" }}
      />

      <CrudDrawer
        open={drawerOpen}
        title={editing ? `编辑供应商：${editing.name}` : "批量新增供应商"}
        width={800}
        onClose={() => setDrawerOpen(false)}
        onSave={() => void submit()}
        saving={saving}
        extra={loadingDetail ? <Typography.Text type="secondary">加载联系人…</Typography.Text> : null}
      >
        <Form<{ items: SupplierForm[] }> form={form} layout="vertical" requiredMark>
          <BatchEntryList
            form={form}
            batch={!editing}
            defaultItem={defaults()}
            renderItem={(field) => (
              <>
                <Form.Item
                  name={[field.name, "name"]}
                  label="名称"
                  rules={[{ required: true, message: "请输入名称" }]}
                >
                  <Input maxLength={100} />
                </Form.Item>
                <PartyHierarchyFields
                  kind="supplier"
                  path={[field.name]}
                  watchPath={["items", field.name]}
                />
                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "category"]} label="分类" style={{ flex: 1 }}>
                    <Select options={SUPPLIER_CATEGORIES} />
                  </Form.Item>
                  <Form.Item name={[field.name, "asn"]} label="ASN（可空）" style={{ flex: 1 }}>
                    <InputNumber min={0} max={4294967295} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name={[field.name, "status"]} label="状态" style={{ flex: 1 }}>
                    <Select options={PARTY_STATUS} />
                  </Form.Item>
                </Space>
                <Space size={12} style={{ display: "flex" }} align="start">
                  <Form.Item name={[field.name, "contactName"]} label="联系人" style={{ flex: 1 }}>
                    <Input maxLength={50} />
                  </Form.Item>
                  <Form.Item name={[field.name, "phone"]} label="电话" style={{ flex: 1 }}>
                    <Input maxLength={50} />
                  </Form.Item>
                  <Form.Item name={[field.name, "email"]} label="邮箱" style={{ flex: 1 }}>
                    <Input maxLength={100} />
                  </Form.Item>
                </Space>
                <Form.Item name={[field.name, "address"]} label="地址">
                  <Input maxLength={200} />
                </Form.Item>
                <Form.Item name={[field.name, "notes"]} label="备注">
                  <Input.TextArea rows={2} maxLength={1000} />
                </Form.Item>
                <SupplierContactsEditor path={[field.name]} />
              </>
            )}
          />
        </Form>
      </CrudDrawer>

      <Drawer
        open={detailOpen}
        title={detail ? `供应商详情：${detail.name}` : "供应商详情"}
        width={720}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading && !detail}
      >
        {detail ? (
          <>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="名称">{detail.name}</Descriptions.Item>
              <Descriptions.Item label="层级">{labelOf(PARTY_LEVELS, detail.level)}</Descriptions.Item>
              <Descriptions.Item label="上级">{detail.parent?.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="分类">{labelOf(SUPPLIER_CATEGORIES, detail.category)}</Descriptions.Item>
              <Descriptions.Item label="ASN">{detail.asn ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="状态">{labelOf(PARTY_STATUS, detail.status)}</Descriptions.Item>
              <Descriptions.Item label="联系人">{detail.contactName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="电话">{detail.phone ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{detail.email ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="地址">{detail.address ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>{detail.notes ?? "—"}</Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5} style={{ marginTop: 18 }}>联系方式</Typography.Title>
            <Table<SupplierContact>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.contacts ?? []}
              locale={{ emptyText: "暂无联系方式" }}
              columns={[
                { title: "姓名", dataIndex: "name" },
                { title: "职务", dataIndex: "role", render: (v) => v ?? "—" },
                { title: "电话", dataIndex: "phone", render: (v) => v ?? "—" },
                { title: "邮箱", dataIndex: "email", render: (v) => v ?? "—" },
                {
                  title: "主要",
                  dataIndex: "isPrimary",
                  width: 70,
                  render: (v: boolean) => (v ? <Tag color="green">是</Tag> : "—"),
                },
              ]}
            />

            <Typography.Title level={5} style={{ marginTop: 18 }}>关联资源</Typography.Title>
            <Space wrap>
              <Link href={`/racks?supplierId=${detail.id}`}>
                <Tag color="geekblue">{detail._count?.racks ?? 0} 个机柜</Tag>
              </Link>
              <Link href={`/ip/blocks?supplierId=${detail.id}`}>
                <Tag color="blue">{detail._count?.ipBlocks ?? 0} 个 IP 段</Tag>
              </Link>
              <Link href={`/ip/addresses?supplierId=${detail.id}`}>
                <Tag color="blue">{detail._count?.ipAddresses ?? 0} 个 IP 地址</Tag>
              </Link>
              <Link href={`/vlans?supplierId=${detail.id}`}>
                <Tag color="cyan">{detail._count?.vlans ?? 0} 个 VLAN</Tag>
              </Link>
              <Link href={`/vxlans?supplierId=${detail.id}`}>
                <Tag color="cyan">{detail._count?.vxlans ?? 0} 个 VXLAN</Tag>
              </Link>
              <Link href={`/broadbands?supplierId=${detail.id}`}>
                <Tag color="orange">{detail._count?.broadbands ?? 0} 条宽带</Tag>
              </Link>
              <Link href={`/devices?supplierId=${detail.id}`}>
                <Tag color="purple">{detail._count?.devices ?? 0} 台设备</Tag>
              </Link>
              <Link href={`/lines?supplierId=${detail.id}`}>
                <Tag color="cyan">{detail._count?.lines ?? 0} 条线路</Tag>
              </Link>
            </Space>

            {detail.children && detail.children.length > 0 ? (
              <>
                <Typography.Title level={5} style={{ marginTop: 18 }}>下级供应商</Typography.Title>
                <Space wrap>
                  {detail.children.map((child) => (
                    <Tag key={child.id}>{child.name}</Tag>
                  ))}
                </Space>
              </>
            ) : null}
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
