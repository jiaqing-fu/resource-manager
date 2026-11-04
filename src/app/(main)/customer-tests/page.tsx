"use client";

import { useState } from "react";
import useSWR from "swr";
import dayjs, { type Dayjs } from "dayjs";
import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
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
import {
  TEST_DISPLAY_STATUS,
  TEST_STATUS,
  colorOf,
  labelOf,
} from "@/lib/enums";
import type { CustomerTest, ListResult } from "@/lib/types";

type TestForm = {
  customerId?: string | null;
  companyName?: string;
  salesperson?: string;
  content?: string;
  startAt: Dayjs;
  endAt: Dayjs;
  accepted: boolean;
  converted: boolean;
  status?: string | null;
  notes?: string;
};

const YES_NO = [
  { value: "true", label: "是" },
  { value: "false", label: "否" },
];

const defaults = (): TestForm => {
  const today = todayStr();
  return {
    startAt: dayjs(today),
    endAt: dayjs(addDays(today, 7)),
    accepted: false,
    converted: false,
    status: null,
  };
};

function CustomerTestFields({ index }: { index: number }) {
  const form = Form.useFormInstance();
  const { data: options } = useOptions();
  const converted = Form.useWatch(["items", index, "converted"], form);

  return (
    <>
      <Space size={12} style={{ display: "flex" }} align="start">
        <Form.Item
          name={[index, "companyName"]}
          label="公司名称"
          rules={[{ required: true, message: "请输入公司名称" }]}
          style={{ flex: 2 }}
        >
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name={[index, "customerId"]} label="关联客户（可空）" style={{ flex: 1 }}>
          <PartySelect
            kind="customer"
            parties={options?.customers}
            onChange={(v) => {
              if (!form.getFieldValue(["items", index, "companyName"])) {
                const customer = options?.customers.find((c) => c.id === v);
                if (customer) {
                  form.setFieldValue(["items", index, "companyName"], customer.name);
                }
              }
            }}
          />
        </Form.Item>
      </Space>

      <Space size={12} style={{ display: "flex" }} align="start">
        <Form.Item name={[index, "salesperson"]} label="业务员" style={{ flex: 1 }}>
          <Input maxLength={50} />
        </Form.Item>
        <Form.Item
          name={[index, "startAt"]}
          label="测试开始时间"
          rules={[{ required: true }]}
          style={{ flex: 1 }}
        >
          <DatePicker
            style={{ width: "100%" }}
            onChange={(v) => {
              if (v) form.setFieldValue(["items", index, "endAt"], v.add(7, "day"));
            }}
          />
        </Form.Item>
        <Form.Item
          name={[index, "endAt"]}
          label="测试结束时间"
          rules={[
            { required: true },
            {
              validator: async (_rule, value: Dayjs | null) => {
                const start = form.getFieldValue(["items", index, "startAt"]) as Dayjs | undefined;
                if (value && start && value.isBefore(start, "day")) {
                  throw new Error("结束时间不能早于开始时间");
                }
              },
            },
          ]}
          style={{ flex: 1 }}
        >
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
      </Space>

      <Form.Item name={[index, "content"]} label="测试内容">
        <Input.TextArea rows={3} maxLength={2000} />
      </Form.Item>

      <Space size={24} style={{ display: "flex", marginBottom: 16 }} align="center">
        <Form.Item
          name={[index, "accepted"]}
          label="是否接单"
          valuePropName="checked"
          style={{ marginBottom: 0 }}
        >
          <Switch disabled={Boolean(converted)} />
        </Form.Item>
        <Form.Item
          name={[index, "converted"]}
          label="是否转正"
          valuePropName="checked"
          style={{ marginBottom: 0 }}
        >
          <Switch
            onChange={(checked) => {
              if (checked) {
                form.setFieldValue(["items", index, "accepted"], true);
                form.setFieldValue(["items", index, "status"], null);
              }
            }}
          />
        </Form.Item>
        <Form.Item
          name={[index, "status"]}
          label="测试结果（可空）"
          tooltip="未填写结果时，按结束时间自动判断为测试中或测试到期；转正视为测试通过。"
          style={{ minWidth: 180, marginBottom: 0 }}
        >
          <Select allowClear options={TEST_STATUS} placeholder="未填写" disabled={Boolean(converted)} />
        </Form.Item>
      </Space>
      {converted ? (
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
          已转正：系统按“测试通过”展示，并自动标记为已接单。
        </Typography.Text>
      ) : null}

      <Form.Item name={[index, "notes"]} label="备注">
        <Input.TextArea rows={3} maxLength={2000} />
      </Form.Item>
    </>
  );
}

export default function CustomerTestsPage() {
  const user = useSessionUser();
  const isAdmin = user.role === "ADMIN";
  const { message } = App.useApp();
  const { data: options, mutate: mutateOptions } = useOptions();
  const initial = useInitialParams("keyword,status,customerId");
  const today = todayStr();

  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [salesperson, setSalesperson] = useState<string | undefined>();
  const [accepted, setAccepted] = useState<string | undefined>();
  const [converted, setConverted] = useState<string | undefined>();
  const [endRange, setEndRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [displayStatus, setDisplayStatus] = useState<string | undefined>(initial.status);
  const [customerId, setCustomerId] = useState<string | undefined>(initial.customerId);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const filters = {
    keyword,
    status: displayStatus,
    customerId,
    salesperson,
    accepted,
    converted,
    endFrom: endRange?.[0]?.format("YYYY-MM-DD"),
    endTo: endRange?.[1]?.format("YYYY-MM-DD"),
    page,
    pageSize,
  };
  const { data, error, isLoading, mutate } = useSWR<ListResult<CustomerTest>>(
    `/api/customer-tests${buildQuery(filters)}`,
  );

  const [form] = Form.useForm<{ items: TestForm[] }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerTest | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ items: [defaults()] });
    setDrawerOpen(true);
  };

  const openEdit = (row: CustomerTest) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      items: [
        {
          customerId: row.customerId,
          companyName: row.companyName,
          salesperson: row.salesperson ?? undefined,
          content: row.content ?? undefined,
          startAt: dayjs(row.startAt),
          endAt: dayjs(row.endAt),
          accepted: row.accepted,
          converted: row.converted,
          status: row.status,
          notes: row.notes ?? undefined,
        },
      ],
    });
    setDrawerOpen(true);
  };

  const toPayload = (values: TestForm) => ({
    customerId: values.customerId ?? null,
    companyName: values.companyName?.trim(),
    salesperson: values.salesperson?.trim() || null,
    content: values.content?.trim() || null,
    startAt: values.startAt.format("YYYY-MM-DD"),
    endAt: values.endAt.format("YYYY-MM-DD"),
    accepted: Boolean(values.accepted),
    converted: Boolean(values.converted),
    status: values.status ?? null,
    notes: values.notes?.trim() || null,
  });

  const submit = async () => {
    let values: { items: TestForm[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const items = values.items ?? [];
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/customer-tests/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(items[0])),
        });
        message.success("测试记录已更新");
      } else {
        const result = await submitBatch(items, async (item) => {
          await apiFetch("/api/customer-tests", {
            method: "POST",
            body: JSON.stringify(toPayload(item)),
          });
        });
        if (result.ok) {
          message.success(`已新增 ${result.count} 条测试记录`);
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

  const remove = async (row: CustomerTest) => {
    try {
      await apiFetch(`/api/customer-tests/${row.id}`, { method: "DELETE" });
      message.success("测试记录已删除");
      await mutate();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const columns: ColumnsType<CustomerTest> = [
    { title: "序号", dataIndex: "seqNo", width: 70 },
    {
      title: "公司",
      width: 210,
      render: (_v, row) => (
        <div>
          <div>{row.companyName}</div>
          <div className="rm-muted">{row.customer?.name ?? "未关联客户"}</div>
        </div>
      ),
    },
    { title: "业务员", dataIndex: "salesperson", width: 100, render: (v) => <Maybe value={v} /> },
    {
      title: "测试内容",
      dataIndex: "content",
      width: 220,
      ellipsis: { showTitle: true },
      render: (v) => <Maybe value={v} />,
    },
    {
      title: "测试周期",
      width: 190,
      render: (_v, row) => {
        const left = diffDays(today, row.endAt);
        return (
          <div>
            <div className="rm-mono">
              {row.startAt} ~ {row.endAt}
            </div>
            <div className="rm-muted">
              {left < 0 ? `已结束 ${-left} 天` : `剩余 ${left} 天`}
            </div>
          </div>
        );
      },
    },
    {
      title: "接单 / 转正",
      width: 110,
      render: (_v, row) => (
        <Space size={4}>
          <Tag color={row.accepted ? "green" : "default"}>{row.accepted ? "已接单" : "未接单"}</Tag>
          <Tag color={row.converted ? "blue" : "default"}>{row.converted ? "已转正" : "未转正"}</Tag>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "displayStatus",
      width: 110,
      render: (v: string) => (
        <Tag color={colorOf(TEST_DISPLAY_STATUS, v)}>{labelOf(TEST_DISPLAY_STATUS, v)}</Tag>
      ),
    },
    { title: "备注", dataIndex: "notes", ellipsis: { showTitle: true }, render: (v) => <Maybe value={v} /> },
    {
      title: "操作",
      width: 140,
      fixed: "right",
      render: (_v, row) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          {isAdmin ? (
            <Popconfirm
              title="确认删除该测试记录？"
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
        title="客户测试统计"
        description="测试开始/结束时间默认 7 天；状态由系统按手动结果、转正与到期日统一计算，转正自动视为接单。"
        extra={
          <Space wrap>
            <ImportExport
              module="customer-tests"
              moduleLabel="客户测试"
              exportQuery={buildQuery({
                keyword,
                status: displayStatus,
                customerId,
                salesperson,
                accepted,
                converted,
                endFrom: endRange?.[0]?.format("YYYY-MM-DD"),
                endTo: endRange?.[1]?.format("YYYY-MM-DD"),
              })}
              isAdmin={isAdmin}
              onImported={() => {
                void mutate();
                void mutateOptions();
              }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增测试
            </Button>
          </Space>
        }
      />

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            placeholder="搜索公司 / 业务员 / 内容 / 备注"
            style={{ width: 250 }}
            onSearch={(v) => {
              setKeyword(v);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 125 }}
            value={displayStatus}
            onChange={(v) => {
              setDisplayStatus(v);
              setPage(1);
            }}
            options={TEST_DISPLAY_STATUS}
          />
          <PartySelect
            kind="customer"
            parties={options?.customers}
            placeholder="关联客户"
            style={{ width: 180 }}
            value={customerId}
            onChange={(v) => {
              setCustomerId(v);
              setPage(1);
            }}
          />
          <DebouncedSearchInput
            value={salesperson ?? ""}
            placeholder="业务员"
            style={{ width: 130 }}
            onSearch={(v) => {
              setSalesperson(v || undefined);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="接单"
            style={{ width: 90 }}
            value={accepted}
            onChange={(v) => {
              setAccepted(v);
              setPage(1);
            }}
            options={YES_NO}
          />
          <Select
            allowClear
            placeholder="转正"
            style={{ width: 90 }}
            value={converted}
            onChange={(v) => {
              setConverted(v);
              setPage(1);
            }}
            options={YES_NO}
          />
          <DatePicker.RangePicker
            value={endRange}
            placeholder={["结束日期起", "结束日期止"]}
            style={{ width: 260 }}
            onChange={(v) => {
              setEndRange(v as [Dayjs | null, Dayjs | null] | null);
              setPage(1);
            }}
          />
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
          刷新
        </Button>
      </div>

      <Table<CustomerTest>
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data?.items ?? []}
        columns={columns}
        scroll={{ x: 1300 }}
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
        locale={{ emptyText: error ? errorMessage(error) : "暂无测试记录" }}
      />

      <CrudDrawer
        open={drawerOpen}
        title={editing ? `编辑测试：${editing.companyName}` : "批量新增客户测试"}
        onClose={() => setDrawerOpen(false)}
        onSave={() => void submit()}
        saving={saving}
        width={800}
      >
        <Form<{ items: TestForm[] }> form={form} layout="vertical" requiredMark>
          <BatchEntryList
            form={form}
            batch={!editing}
            defaultItem={defaults()}
            renderItem={(field) => <CustomerTestFields index={field.name} />}
          />
        </Form>
      </CrudDrawer>
    </div>
  );
}
