"use client";

import { useState } from "react";
import {
  Alert,
  App,
  Button,
  Descriptions,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import type { UploadFile } from "antd";
import {
  CheckCircleOutlined,
  DownloadOutlined,
  ExportOutlined,
  InboxOutlined,
  UploadOutlined,
} from "@ant-design/icons";

type ImportCellError = {
  sheet: string;
  row: number;
  column: string;
  message: string;
  value: string;
};

type ImportResult = {
  dryRun: boolean;
  committed: boolean;
  module: string;
  label: string;
  totalRows: number;
  created: number;
  updated: number;
  sheets: Array<{ sheet: string; rows: number; created: number; updated: number }>;
};

export function ImportExport({
  module,
  moduleLabel,
  exportQuery = "",
  isAdmin,
  onImported,
}: {
  module: string;
  moduleLabel: string;
  exportQuery?: string;
  isAdmin: boolean;
  onImported?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errors, setErrors] = useState<ImportCellError[] | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const { message } = App.useApp();

  const file = fileList[0]?.originFileObj as File | undefined;

  const reset = () => {
    setErrors(null);
    setResult(null);
  };

  const doImport = async (dryRun: boolean) => {
    if (!file) {
      message.warning("请先选择 .xlsx 文件");
      return;
    }
    if (dryRun) setChecking(true);
    else setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/import/${module}${dryRun ? "?dryRun=1" : ""}`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => null)) as
        | (ImportResult & { error?: { message?: string; errors?: ImportCellError[] } })
        | null;
      if (!res.ok) {
        const cellErrors = data?.error?.errors;
        if (cellErrors?.length) {
          setErrors(cellErrors);
          setResult(null);
        }
        message.error(data?.error?.message ?? `导入失败（${res.status}）`);
        return;
      }
      if (!data) {
        message.error("服务器返回内容为空");
        return;
      }
      setErrors(null);
      setResult(data);
      if (dryRun) {
        message.success("校验通过，可以确认导入");
      } else {
        message.success(
          `导入完成：新增 ${data.created} 行，更新 ${data.updated} 行`,
        );
        setOpen(false);
        setFileList([]);
        setResult(null);
        onImported?.();
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导入请求失败");
    } finally {
      setChecking(false);
      setImporting(false);
    }
  };

  return (
    <>
      <Space wrap>
        <Button
          icon={<DownloadOutlined />}
          href={`/api/templates/${module}`}
          title="下载标准 Excel 模板"
        >
          下载模板
        </Button>
        <Button
          icon={<ExportOutlined />}
          href={`/api/export/${module}${exportQuery}`}
          title="按当前筛选条件导出"
        >
          导出
        </Button>
        {isAdmin ? (
          <Button icon={<UploadOutlined />} onClick={() => setOpen(true)}>
            导入
          </Button>
        ) : null}
      </Space>

      <Modal
        open={open}
        title={`导入${moduleLabel}`}
        width={820}
        onCancel={() => {
          setOpen(false);
          setFileList([]);
          reset();
        }}
        destroyOnHidden
        footer={
          <Space>
            <Button
              onClick={() => {
                setOpen(false);
                setFileList([]);
                reset();
              }}
            >
              关闭
            </Button>
            <Button
              loading={checking}
              disabled={!file}
              onClick={() => void doImport(true)}
            >
              预校验
            </Button>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={importing}
              disabled={!result || result.dryRun === false}
              onClick={() => void doImport(false)}
            >
              确认导入
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="全有或全无"
          description={
            <span>
              请先下载系统生成的模板并按其表头填写。导入会先做全量校验，任意一行有误都不会写入；
              全部通过后按自然键新增或更新，更新会覆盖同名的现有记录。仅管理员可导入。
            </span>
          }
        />
        <Upload.Dragger
          accept=".xlsx"
          maxCount={1}
          beforeUpload={() => false}
          fileList={fileList}
          onChange={({ fileList: list }) => {
            setFileList(list.slice(-1));
            reset();
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽 .xlsx 文件到此处</p>
          <p className="ant-upload-hint">单个文件不超过 5MB，最多 5000 行</p>
        </Upload.Dragger>

        {errors && errors.length > 0 ? (
          <>
            <Alert
              style={{ marginTop: 14 }}
              type="error"
              showIcon
              message={`共 ${errors.length} 处校验错误，请修正后重新上传`}
            />
            <div className="rm-error-list">
              <Table<ImportCellError>
                size="small"
                rowKey={(_r, i) => String(i)}
                pagination={{ pageSize: 20, size: "small" }}
                dataSource={errors}
                columns={[
                  { title: "工作表", dataIndex: "sheet", width: 110 },
                  { title: "行号", dataIndex: "row", width: 70 },
                  { title: "列名", dataIndex: "column", width: 150 },
                  { title: "原因", dataIndex: "message" },
                  {
                    title: "当前值",
                    dataIndex: "value",
                    width: 150,
                    render: (v: string) => (v ? <Typography.Text code>{v}</Typography.Text> : "—"),
                  },
                ]}
              />
            </div>
          </>
        ) : null}

        {result && result.dryRun ? (
          <div style={{ marginTop: 14 }}>
            <Alert
              type="success"
              showIcon
              message="校验通过"
              description={`共 ${result.totalRows} 行，预计新增 ${result.created} 行、更新 ${result.updated} 行。确认后将写入数据库。`}
            />
            <Descriptions size="small" column={1} style={{ marginTop: 12 }} bordered>
              {result.sheets.map((s) => (
                <Descriptions.Item key={s.sheet} label={s.sheet}>
                  {s.rows} 行
                  <Tag color="green" style={{ marginLeft: 8 }}>
                    新增 {s.created}
                  </Tag>
                  <Tag color="blue">更新 {s.updated}</Tag>
                </Descriptions.Item>
              ))}
            </Descriptions>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
