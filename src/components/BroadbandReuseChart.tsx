"use client";

import useSWR from "swr";
import { Button, Empty, Skeleton, Space, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { errorMessage } from "@/lib/client";

type ReuseRow = {
  id: string;
  name: string;
  supplierName: string | null;
  bandwidthMbps: number | null;
  allocatedMbps: number;
  reusePercent: number | null;
};

/**
 * 全部宽带的复用率横向柱状图。纯 CSS 渲染，不引入图表依赖。
 * 单一系列，100% 处画参考线，超过 100% 使用状态色并保留数值标签。
 */
export function BroadbandReuseChart() {
  const { data, error, isLoading, mutate } = useSWR<ReuseRow[]>("/api/broadbands/reuse");
  const rows = data ?? [];
  const maxPercent = rows.reduce(
    (max, row) => Math.max(max, row.reusePercent ?? 0),
    0,
  );
  const scale = Math.max(100, Math.ceil(maxPercent / 50) * 50);
  const referenceLeft = `${(100 / scale) * 100}%`;

  return (
    <div>
      <div className="rm-reuse-meta">
        <Space size={16} wrap>
          <Typography.Text type="secondary">
            全部宽带 {rows.length} 条，按复用率倒序
          </Typography.Text>
          <span className="rm-reuse-legend">
            <span className="rm-reuse-swatch rm-reuse-swatch-normal" /> ≤ 100%
          </span>
          <span className="rm-reuse-legend">
            <span className="rm-reuse-swatch rm-reuse-swatch-over" /> &gt; 100%
          </span>
          <span className="rm-reuse-legend">
            <span className="rm-reuse-reference-legend" /> 100% 参考线
          </span>
        </Space>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void mutate()}>
          刷新
        </Button>
      </div>

      {isLoading && rows.length === 0 ? <Skeleton active paragraph={{ rows: 5 }} /> : null}
      {error ? (
        <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>
      ) : null}
      {!isLoading && !error && rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无宽带" />
      ) : null}

      {rows.length > 0 ? (
        <div className="rm-reuse-chart" role="img" aria-label="全部宽带复用率柱状图">
          {rows.map((row) => {
            const over = row.reusePercent !== null && row.reusePercent > 100;
            const width =
              row.reusePercent === null ? "0%" : `${Math.min(100, (row.reusePercent / scale) * 100)}%`;
            const detail =
              row.reusePercent === null
                ? `${row.name}：总带宽未知，已分配 ${row.allocatedMbps} Mbps`
                : `${row.name}：总带宽 ${row.bandwidthMbps} Mbps，已分配 ${row.allocatedMbps} Mbps，复用率 ${row.reusePercent}%`;
            return (
              <div className="rm-reuse-row" key={row.id} title={detail}>
                <div className="rm-reuse-name">
                  <span title={row.name}>{row.name}</span>
                  {row.supplierName ? (
                    <span className="rm-reuse-supplier">{row.supplierName}</span>
                  ) : null}
                </div>
                <div className="rm-reuse-bar-area">
                  <span className="rm-reuse-reference" style={{ left: referenceLeft }} />
                  <span className="rm-reuse-track">
                    <span
                      className={
                        over ? "rm-reuse-bar rm-reuse-bar-over" : "rm-reuse-bar"
                      }
                      style={{ width }}
                    />
                  </span>
                </div>
                <div
                  className={
                    over ? "rm-reuse-value rm-reuse-value-over" : "rm-reuse-value"
                  }
                >
                  {row.reusePercent === null ? "—" : `${row.reusePercent.toFixed(1)}%`}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
