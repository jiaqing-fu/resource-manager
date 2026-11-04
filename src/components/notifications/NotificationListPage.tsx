"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Alert,
  App,
  Button,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DownloadOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { useSessionUser } from "@/components/SessionContext";
import { useInitialParams } from "@/components/useInitialParams";
import { downloadNotificationDocx } from "@/components/notifications/download";
import { apiFetch, buildQuery, errorMessage } from "@/lib/client";
import { formatDateTime } from "@/lib/dates";
import { NOTIFICATION_STATUS, colorOf, labelOf } from "@/lib/enums";
import type {
  ListResult,
  NotificationSummary,
  PublicNotificationMailConfig,
} from "@/lib/types";

export function NotificationListPage({ config }: { config: PublicNotificationMailConfig }) {
  const user = useSessionUser();
  const isAdmin = user.role === "ADMIN";
  const { message } = App.useApp();
  const initial = useInitialParams("keyword");
  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [status, setStatus] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR<ListResult<NotificationSummary>>(
    `/api/notifications${buildQuery({ keyword, status, page, pageSize })}`,
  );

  const download = async (row: NotificationSummary) => {
    setDownloadingId(row.id);
    try {
      await downloadNotificationDocx(row.id, row.docxFilename ?? "通知.docx");
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setDownloadingId(null);
    }
  };

  const remove = async (row: NotificationSummary) => {
    try {
      await apiFetch(`/api/notifications/${row.id}`, { method: "DELETE" });
      message.success("通知已删除");
      await mutate();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const columns: ColumnsType<NotificationSummary> = [
    {
      title: "标题",
      dataIndex: "title",
      width: 260,
      render: (_value, row) => (
        <div>
          <Link href={`/notifications/${row.id}`}>{row.title || "未命名通知"}</Link>
          {row.subject ? (
            <div>
              <Typography.Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                {row.subject}
              </Typography.Text>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: "收件人",
      dataIndex: "recipient",
      width: 260,
      render: (value: string) => (
        <Tooltip title={value || "—"}>
          <Typography.Text ellipsis style={{ maxWidth: 240 }}>
            {value || "—"}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      render: (value: string, row) => {
        const tag = (
          <Tag color={colorOf(NOTIFICATION_STATUS, value)}>
            {labelOf(NOTIFICATION_STATUS, value)}
          </Tag>
        );
        return row.lastError && value === "failed" ? (
          <Tooltip title={row.lastError}>{tag}</Tooltip>
        ) : (
          tag
        );
      },
    },
    { title: "创建人", dataIndex: "createdByName", width: 110 },
    {
      title: "发件邮箱",
      dataIndex: "fromAddress",
      width: 190,
      render: (value: string | null) => value || "—",
    },
    {
      title: "发送时间",
      dataIndex: "sentAt",
      width: 160,
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 160,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 210,
      fixed: "right",
      render: (_value, row) => (
        <Space size="small">
          <Link href={`/notifications/${row.id}`}>
            <Button size="small" type="link" icon={<EyeOutlined />}>
              {row.status === "sent" ? "查看" : "编辑"}
            </Button>
          </Link>
          <Button
            size="small"
            type="link"
            icon={<DownloadOutlined />}
            loading={downloadingId === row.id}
            onClick={() => void download(row)}
          >
            下载
          </Button>
          {isAdmin && row.status !== "sent" ? (
            <Popconfirm
              title="删除这份通知？"
              description="本地 Word 副本也会一并删除。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void remove(row)}
            >
              <Button size="small" type="link" danger>
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
        title="通知管理"
        description="新建通知相当于撰写 Word 文档；发送时通过服务器配置的邮箱发送邮件，并在本地保存一份 Word 副本。"
        extra={
          <Link href="/notifications/new">
            <Button type="primary" icon={<PlusOutlined />}>
              新建通知
            </Button>
          </Link>
        }
      />

      {!config.configured ? (
        <Alert
          type="warning"
          showIcon
          message="SMTP 未配置"
          description={
            <span>
              {config.issue ?? "请在服务器 .env 中配置 SMTP 参数。"}
              通知仍可创建、保存和下载 Word，发送前请联系管理员完成邮箱配置。
            </span>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <div className="rm-toolbar">
        <div className="rm-toolbar-filters">
          <DebouncedSearchInput
            value={keyword}
            onSearch={(value) => {
              setKeyword(value);
              setPage(1);
            }}
            placeholder="搜索标题、收件人、主题或正文"
            style={{ width: 320 }}
          />
          <Select
            allowClear
            placeholder="全部状态"
            options={NOTIFICATION_STATUS.map((o) => ({ value: o.value, label: o.label }))}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            style={{ width: 140 }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
            刷新
          </Button>
        </div>
      </div>

      <Table<NotificationSummary>
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
          showTotal: (total) => `共 ${total} 条`,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage);
            setPageSize(nextSize);
          },
        }}
        locale={{ emptyText: error ? errorMessage(error) : "暂无通知" }}
      />
    </div>
  );
}
