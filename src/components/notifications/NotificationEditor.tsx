"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import type { JSONContent } from "@tiptap/core";
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Input,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  SaveOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { RichTextEditor } from "@/components/notifications/RichTextEditor";
import { downloadNotificationDocx } from "@/components/notifications/download";
import { apiFetch, errorMessage } from "@/lib/client";
import { checkEmailList, emailListError } from "@/lib/email";
import { isValidDateStr, todayStr } from "@/lib/dates";
import { NOTIFICATION_STATUS, colorOf, labelOf } from "@/lib/enums";
import type {
  NotificationDetail,
  NotificationDraftInput,
  PublicNotificationMailConfig,
} from "@/lib/types";

const EMPTY_DOC: JSONContent = { type: "doc", content: [] };

function parseInitialContent(raw: string | undefined): JSONContent {
  if (!raw) return EMPTY_DOC;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JSONContent;
    }
  } catch {
    // 损坏的历史数据退回空文档，发送时服务端仍会校验
  }
  return EMPTY_DOC;
}

export function NotificationEditor({
  notification,
  config,
}: {
  notification: NotificationDetail | null;
  config: PublicNotificationMailConfig;
}) {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const [id, setId] = useState<string | null>(notification?.id ?? null);
  const [record, setRecord] = useState<NotificationDetail | null>(notification);
  const [title, setTitle] = useState(notification?.title ?? "");
  const [recipient, setRecipient] = useState(
    notification?.recipient ?? config.defaultTo ?? "",
  );
  const [cc, setCc] = useState(notification?.cc ?? "");
  const [subject, setSubject] = useState(notification?.subject ?? "");
  const [signature, setSignature] = useState(notification?.signature ?? "");
  const [documentDate, setDocumentDate] = useState(
    notification?.documentDate ?? todayStr(),
  );
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [initialContent] = useState<JSONContent>(() =>
    parseInitialContent(notification?.contentJson),
  );
  const contentRef = useRef<JSONContent>(initialContent);
  const contentTextRef = useRef(notification?.contentText ?? "");

  const readOnly = record?.status === "sent";
  const editorKey = notification?.id ?? "new";

  const buildPayload = (): NotificationDraftInput => ({
    title,
    recipient,
    cc: cc.trim() || null,
    subject: subject.trim() || null,
    contentJson: contentRef.current as unknown as Record<string, unknown>,
    signature: signature.trim() || null,
    documentDate,
  });

  /** 保存当前内容，返回服务端记录；新建时会更新本地 id。 */
  const persist = async (): Promise<NotificationDetail> => {
    const saved = id
      ? await apiFetch<NotificationDetail>(`/api/notifications/${id}`, {
          method: "PATCH",
          body: JSON.stringify(buildPayload()),
        })
      : await apiFetch<NotificationDetail>("/api/notifications", {
          method: "POST",
          body: JSON.stringify(buildPayload()),
        });
    if (!id) setId(saved.id);
    setRecord(saved);
    return saved;
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const saved = await persist();
      message.success("通知草稿已保存");
      if (!notification) {
        router.replace(`/notifications/${saved.id}`);
      } else {
        setRecord(saved);
      }
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      let targetId = id;
      if (!targetId) {
        const saved = await persist();
        targetId = saved.id;
      }
      await downloadNotificationDocx(
        targetId,
        record?.docxFilename ?? `${title.trim() || "通知"}.docx`,
      );
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setDownloading(false);
    }
  };

  const validateBeforeSend = (): string | null => {
    if (!title.trim()) return "发送前请填写通知标题";
    if (!documentDate || !isValidDateStr(documentDate)) return "请选择有效的通知日期";
    const to = checkEmailList(recipient);
    const toError = emailListError(to, "收件人");
    if (toError) return toError;
    if (to.emails.length === 0) return "请至少填写一个收件人邮箱";
    const ccError = emailListError(checkEmailList(cc), "抄送");
    if (ccError) return ccError;
    if (!contentTextRef.current.trim()) return "发送前请填写通知正文";
    return null;
  };

  const doSend = async () => {
    setSending(true);
    let targetId = id;
    try {
      const saved = await persist();
      targetId = saved.id;
      const sent = await apiFetch<NotificationDetail>(`/api/notifications/${saved.id}/send`, {
        method: "POST",
      });
      setRecord(sent);
      setId(sent.id);
      message.success("通知已发送，Word 副本已保存到服务器");
      router.replace(`/notifications/${sent.id}`);
      router.refresh();
    } catch (error) {
      message.error(errorMessage(error));
      // 发送失败时，新建通知也已在服务端保存为 failed 草稿，必须带着新 id
      // 跳转到详情页，避免刷新后回到空白的新建页或停留在旧状态。
      if (targetId) {
        if (!notification) {
          router.replace(`/notifications/${targetId}`);
          router.refresh();
        } else {
          try {
            setRecord(await apiFetch<NotificationDetail>(`/api/notifications/${targetId}`));
          } catch {
            // 刷新状态失败时保留当前页面内容
          }
        }
      }
    } finally {
      setSending(false);
    }
  };

  const confirmSend = () => {
    const error = validateBeforeSend();
    if (error) {
      message.error(error);
      return;
    }
    if (!config.configured) {
      message.error("SMTP 未配置，不能发送");
      return;
    }
    modal.confirm({
      title: "确认发送这份通知？",
      width: 520,
      content: (
        <div className="rm-notification-confirm">
          <p>
            收件人：<strong>{recipient}</strong>
          </p>
          {cc.trim() ? <p>抄送：{cc}</p> : null}
           <p>邮件主题：{subject.trim() || title.trim()}</p>
          <p className="rm-notification-confirm-warning">
            发送后会生成 Word 文档、发送邮件并保存本地副本，发送记录不可再修改。
          </p>
        </div>
      ),
      okText: "发送",
      cancelText: "取消",
      onOk: () => doSend(),
    });
  };

  return (
    <div>
      <PageHeader
        title={readOnly ? "通知详情" : id ? "编辑通知" : "新建通知"}
        description={
          readOnly
            ? "已发送的通知与本地 Word 副本均保留只读审计。"
            : "像编辑 Word 文档一样撰写通知，保存草稿后可下载或发送邮件。"
        }
        extra={
          <Space wrap>
            <Link href="/notifications">
              <Button icon={<ArrowLeftOutlined />}>返回列表</Button>
            </Link>
            <Button
              icon={<DownloadOutlined />}
              loading={downloading}
              onClick={() => void handleDownload()}
            >
              下载 Word
            </Button>
            {!readOnly ? (
              <Button
                icon={<SaveOutlined />}
                loading={saving}
                onClick={() => void handleSaveDraft()}
              >
                保存草稿
              </Button>
            ) : null}
            {!readOnly ? (
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={sending}
                disabled={!config.configured}
                onClick={confirmSend}
              >
                发送
              </Button>
            ) : null}
          </Space>
        }
      />

      <div className="rm-notification-layout">
        <div className="rm-notification-paper">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            readOnly={readOnly}
            maxLength={200}
            variant="borderless"
            className="rm-notification-title-input"
            placeholder="请输入通知标题"
            aria-label="通知标题"
          />
          <div className="rm-notification-subline">
            <span>通知日期：{documentDate}</span>
          </div>
          <RichTextEditor
            key={editorKey}
            initialContent={initialContent}
            editable={!readOnly}
            onUpdate={(json, text) => {
              contentRef.current = json;
              contentTextRef.current = text;
            }}
          />
          <div className="rm-notification-signature">
            <Input.TextArea
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              readOnly={readOnly}
              autoSize={{ minRows: 1, maxRows: 3 }}
              maxLength={2000}
              variant="borderless"
              className="rm-notification-signature-input"
              placeholder="落款（可选）"
              aria-label="落款"
            />
            <DatePicker
              value={documentDate ? dayjs(documentDate) : null}
              onChange={(value) => setDocumentDate(value ? value.format("YYYY-MM-DD") : todayStr())}
              allowClear={false}
              disabled={readOnly}
              aria-label="通知日期"
            />
          </div>
        </div>

        <aside className="rm-notification-side">
          <Card size="small" title="邮件信息">
            {!config.configured ? (
              <Alert
                type="warning"
                showIcon
                message="SMTP 未配置，暂时不能发送"
                description={
                  <span>
                    {config.issue ?? "请在服务器 .env 中配置 SMTP_HOST、SMTP_FROM 等参数。"}
                    <br />
                    仍可保存草稿和下载 Word。
                  </span>
                }
                style={{ marginBottom: 16 }}
              />
            ) : (
              <Alert
                type="success"
                showIcon
                message="发件邮箱已配置"
                description={
                  <span className="rm-notification-from">
                    {config.fromName ? `${config.fromName} <${config.from}>` : config.from}
                  </span>
                }
                style={{ marginBottom: 16 }}
              />
            )}

            {record?.status === "failed" && record.lastError ? (
              <Alert
                type="error"
                showIcon
                message="上次发送失败"
                description={record.lastError}
                style={{ marginBottom: 16 }}
              />
            ) : null}

            {readOnly ? (
              <div className="rm-notification-sent-info">
                <Tag color={colorOf(NOTIFICATION_STATUS, record?.status)}>
                  {labelOf(NOTIFICATION_STATUS, record?.status)}
                </Tag>
                <p>发送时间：{record?.sentAt ? record.sentAt.slice(0, 16).replace("T", " ") : "—"}</p>
                <p>发送人：{record?.sentByName ?? "—"}</p>
                <p>发件邮箱：{record?.fromAddress ?? "—"}</p>
                <p className="rm-mono">Message-ID：{record?.messageId ?? "—"}</p>
              </div>
            ) : null}

            <div className="rm-notification-field">
              <label htmlFor="notification-recipient">收件人 *</label>
              <Input
                id="notification-recipient"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                readOnly={readOnly}
                placeholder="多个邮箱用逗号分隔"
                maxLength={4000}
              />
            </div>
            <div className="rm-notification-field">
              <label htmlFor="notification-cc">抄送</label>
              <Input
                id="notification-cc"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                readOnly={readOnly}
                placeholder="可选，多个邮箱用逗号分隔"
                maxLength={4000}
              />
            </div>
            <div className="rm-notification-field">
              <label htmlFor="notification-subject">邮件主题</label>
              <Input
                id="notification-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                readOnly={readOnly}
                placeholder={title.trim() || "默认使用通知标题"}
                maxLength={200}
              />
            </div>

            {!readOnly ? (
              <Typography.Paragraph type="secondary" className="rm-notification-hint">
                发送会先自动保存当前内容。邮件正文与附件均来自这份通知，附件同时保存到服务器
                <span className="rm-mono"> data/notifications/</span>。
              </Typography.Paragraph>
            ) : null}
          </Card>
        </aside>
      </div>
    </div>
  );
}
