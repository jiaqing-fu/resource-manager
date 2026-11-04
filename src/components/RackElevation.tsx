"use client";

import { useState } from "react";
import useSWR from "swr";
import { Alert, Segmented, Space, Spin, Tag, Typography } from "antd";
import { errorMessage } from "@/lib/client";
import { DEVICE_STATUS, labelOf } from "@/lib/enums";

type ElevationDevice = {
  id: string;
  name: string;
  type: string;
  status: string;
  manufacturer: string | null;
  model: string | null;
  uStart: number;
  uHeight: number;
  face: string;
  isStart: boolean;
};

type ElevationData = {
  rack: {
    id: string;
    code: string;
    location: string | null;
    uStart: number;
    uEnd: number;
    width: number;
    status: string;
  };
  face: string;
  slots: Array<{ u: number; device: ElevationDevice | null }>;
  usedU: number;
  usedUFront: number;
  usedURear: number;
};

export function RackElevation({ rackId }: { rackId: string }) {
  const [face, setFace] = useState<"front" | "rear">("front");
  const { data, error, isLoading } = useSWR<ElevationData>(
    `/api/racks/${rackId}/elevation?face=${face}`,
  );

  if (error) return <Alert type="error" showIcon message={errorMessage(error)} />;
  if (isLoading && !data) return <Spin />;
  if (!data) return null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <Space wrap>
          <Typography.Text strong>
            {data.rack.location ? `${data.rack.location} / ${data.rack.code}` : data.rack.code}
          </Typography.Text>
          <Tag>
            {data.rack.uStart}-{data.rack.uEnd}U（共 {data.rack.uEnd - data.rack.uStart + 1}U）
          </Tag>
          <Tag>{data.rack.width} 英寸</Tag>
          <Tag color="blue">
            已用 {face === "front" ? data.usedUFront : data.usedURear}U
          </Tag>
        </Space>
        <Segmented
          value={face}
          onChange={(v) => setFace(v as "front" | "rear")}
          options={[
            { label: "前面板", value: "front" },
            { label: "后面板", value: "rear" },
          ]}
        />
      </div>

      <div className="rm-rack-grid">
        {data.slots.map((slot) => {
          const device = slot.device;
          return (
            <div className="rm-rack-row" key={slot.u}>
              <div className="rm-rack-u">{slot.u}U</div>
              <div
                className={[
                  "rm-rack-slot",
                  device ? "used" : "empty",
                  device ? `status-${device.status}` : "",
                ].join(" ")}
                title={
                  device
                    ? `${device.name}（${labelOf(DEVICE_STATUS, device.status)}）` +
                      `${device.isStart ? ` · ${device.uStart}-${device.uStart + device.uHeight - 1}U` : ""}`
                    : "空闲"
                }
              >
                {device && device.isStart ? (
                  <span>
                    {device.name}
                    {device.uHeight > 1 ? (
                      <span className="rm-muted">（{device.uHeight}U）</span>
                    ) : null}
                  </span>
                ) : device ? (
                  <span className="rm-muted" style={{ visibility: "hidden" }}>
                    {device.name}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
