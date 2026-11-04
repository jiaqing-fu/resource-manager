"use client";

import { Empty } from "antd";

type Row = { key: string; label: string; value: number; hint?: string; suffix?: string };

/**
 * 单系列排名条形图：一条基线、同一蓝色、末端 4px 圆角，
 * 数值直接标注，便于比较各分类的规模。
 */
export function RankBar({
  rows,
  emptyText = "暂无数据",
  suffix = "",
  colorful = false,
  colorMap,
}: {
  rows: Row[];
  emptyText?: string;
  suffix?: string;
  colorful?: boolean;
  colorMap?: Record<string, string>;
}) {
  if (rows.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div>
      {rows.map((row) => {
        const percent = Math.round((row.value / max) * 1000) / 10;
        const color = colorful ? colorMap?.[row.key] ?? "#2a78d6" : "#2a78d6";
        return (
          <div
            key={row.key}
            title={`${row.label}：${row.value}${suffix}${row.hint ? ` · ${row.hint}` : ""}`}
            style={{ marginBottom: 12 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                fontSize: 13,
                marginBottom: 4,
              }}
            >
              <span style={{ color: "#1f2937", overflow: "hidden", textOverflow: "ellipsis" }}>
                {row.label}
              </span>
              <span style={{ color: "#52514e", whiteSpace: "nowrap" }}>
                {row.value}
                {suffix}
                {row.hint ? <span className="rm-muted"> · {row.hint}</span> : null}
              </span>
            </div>
            <div
              style={{
                height: 8,
                background: "#eef2f7",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(percent, row.value > 0 ? 1.5 : 0)}%`,
                  height: "100%",
                  background: color,
                  borderRadius: 4,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
