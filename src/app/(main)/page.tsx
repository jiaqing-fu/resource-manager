"use client";

import Link from "next/link";
import useSWR from "swr";
import {
  Alert,
  Button,
  Card,
  Col,
  Row,
  Skeleton,
  Space,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { RankBar } from "@/components/RankBar";
import { errorMessage } from "@/lib/client";
import type { DashboardData, ReminderData } from "@/lib/types";

function Stat({
  label,
  value,
  extra,
  href,
}: {
  label: string;
  value: number | string;
  extra?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <div className="rm-stat">
      <div className="rm-stat-label">{label}</div>
      <div className="rm-stat-value">{value}</div>
      {extra ? <div className="rm-stat-extra">{extra}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} style={{ display: "block", height: "100%" }}>
      {body}
    </Link>
  ) : (
    body
  );
}

export default function DashboardPage() {
  const { data, error, isLoading, mutate } = useSWR<DashboardData>("/api/dashboard/summary");
  const {
    data: reminders,
    error: reminderError,
    mutate: mutateReminders,
  } = useSWR<ReminderData>("/api/dashboard/reminders?days=30");

  const refresh = () => {
    void mutate();
    void mutateReminders();
  };

  if (isLoading && !data) {
    return (
      <div>
        <PageHeader title="工作台" description="资源总览、分布与到期提醒" />
        <Skeleton active paragraph={{ rows: 10 }} />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <PageHeader title="工作台" />
        <Alert type="error" showIcon message={errorMessage(error)} />
      </div>
    );
  }

  const c = data.counts;
  return (
    <div>
      <PageHeader
        title="工作台"
        description="资源总览、IP/设备/线路分布与 30 天到期提醒"
        extra={
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            刷新
          </Button>
        }
      />

      <Row gutter={[12, 12]}>
        <Col xs={12} sm={8} lg={6} xl={4}>
          <Stat
            label="供应商"
            value={c.suppliers}
            extra={`一级 ${c.suppliersL1} · 二级 ${c.suppliersL2}`}
            href="/suppliers"
          />
        </Col>
        <Col xs={12} sm={8} lg={6} xl={4}>
          <Stat
            label="客户"
            value={c.customers}
            extra={`一级 ${c.customersL1} · 二级 ${c.customersL2}`}
            href="/customers"
          />
        </Col>
        <Col xs={12} sm={8} lg={6} xl={4}>
          <Stat label="机柜" value={c.racks} href="/racks" />
        </Col>
        <Col xs={12} sm={8} lg={6} xl={4}>
          <Stat label="IP 段" value={c.ipBlocks} href="/ip/blocks" />
        </Col>
        <Col xs={12} sm={8} lg={6} xl={4}>
          <Stat label="IP 地址" value={c.ipAddresses} href="/ip/addresses" />
        </Col>
        <Col xs={12} sm={8} lg={6} xl={4}>
          <Stat label="VLAN" value={c.vlans} href="/vlans" />
        </Col>
        <Col xs={12} sm={8} lg={6} xl={4}>
          <Stat label="VXLAN" value={c.vxlans} href="/vxlans" />
        </Col>
        <Col xs={12} sm={8} lg={6} xl={4}>
          <Stat label="宽带" value={c.broadbands} href="/broadbands" />
        </Col>
        <Col xs={12} sm={8} lg={6} xl={4}>
          <Stat label="设备" value={c.devices} href="/devices" />
        </Col>
        <Col xs={12} sm={8} lg={6} xl={4}>
          <Stat label="线路" value={c.lines} href="/lines" />
        </Col>
        <Col xs={12} sm={8} lg={6} xl={4}>
          <Stat label="业务系统" value={c.businessSystems} href="/business-systems" />
        </Col>
        <Col xs={12} sm={8} lg={6} xl={4}>
          <Stat label="客户测试" value={c.customerTests} href="/customer-tests" />
        </Col>
        <Col xs={12} sm={8} lg={6} xl={4}>
          <Stat label="活动资源分配" value={c.activeAllocations} href="/resource-allocations" />
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={12}>
          <Card title="IP 地址状态分布" size="small">
            <RankBar
              rows={data.ipStatus.map((r) => ({ key: r.value, label: r.label, value: r.count }))}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="IP 地址角色分布" size="small">
            <RankBar
              rows={data.ipRole.map((r) => ({ key: r.value, label: r.label, value: r.count }))}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="设备状态分布" size="small">
            <RankBar
              rows={data.deviceStatus.map((r) => ({ key: r.value, label: r.label, value: r.count }))}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="设备类型分布" size="small">
            <RankBar
              rows={data.deviceType.map((r) => ({ key: r.value, label: r.label, value: r.count }))}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="线路状态分布" size="small">
            <RankBar
              rows={data.lineStatus.map((r) => ({ key: r.value, label: r.label, value: r.count }))}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="IP 段利用率 Top 5" size="small">
            <RankBar
              suffix="%"
              rows={data.blockUsage.map((b) => ({
                key: b.id,
                label: b.cidr,
                value: b.percent ?? 0,
                hint: `${b.used}/${b.total ?? "?"}`,
              }))}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="机柜使用率 Top 5" size="small">
            <RankBar
              suffix="%"
              rows={data.rackUsage.map((r) => ({
                key: r.id,
                label: `${r.location ? `${r.location} / ` : ""}${r.code} [${r.uStart}-${r.uEnd}]U`,
                value: r.percent,
                hint: `${r.usedU}/${r.capacity}U`,
              }))}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="30 天到期提醒" size="small">
            {reminderError ? (
              <Alert type="error" showIcon message={errorMessage(reminderError)} />
            ) : !reminders ? (
              <Skeleton active paragraph={{ rows: 4 }} />
            ) : (
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Link href="/lines?expiring=1">
                  <Alert
                    type={reminders.lines.length > 0 ? "warning" : "success"}
                    showIcon
                    message={`线路到期：${data.reminders.linesExpiring} 条`}
                    description={
                      reminders.lines.length > 0
                        ? reminders.lines
                            .slice(0, 3)
                            .map((l) => `${l.code} ${l.name}（${l.expireDate}）`)
                            .join("；")
                        : "30 天内没有线路到期"
                    }
                  />
                </Link>
                <Link href="/broadbands?expiring=1">
                  <Alert
                    type={reminders.broadbands.length > 0 ? "warning" : "success"}
                    showIcon
                    message={`宽带到期：${data.reminders.broadbandsExpiring} 条`}
                    description={
                      reminders.broadbands.length > 0
                        ? reminders.broadbands
                            .slice(0, 3)
                            .map((b) => `${b.name}（${b.expireDate}）`)
                            .join("；")
                        : "30 天内没有宽带到期"
                    }
                  />
                </Link>
                <Link href="/devices?warranty=1">
                  <Alert
                    type={reminders.devices.length > 0 ? "warning" : "success"}
                    showIcon
                    message={`设备保修到期：${data.reminders.warrantiesExpiring} 台`}
                    description={
                      reminders.devices.length > 0
                        ? reminders.devices
                            .slice(0, 3)
                            .map((d) => `${d.name}（${d.warrantyEnd}）`)
                            .join("；")
                        : "30 天内没有设备保修到期"
                    }
                  />
                </Link>
                <Link href="/customer-tests?status=expired">
                  <Alert
                    type={reminders.tests.length > 0 ? "error" : "success"}
                    showIcon
                    message={`客户测试已到期未处理：${data.reminders.testsExpired} 条`}
                    description={
                      reminders.tests.length > 0 ? (
                        <span>
                          {reminders.tests
                            .slice(0, 3)
                            .map((t) => `#${t.seqNo} ${t.companyName}`)
                            .join("；")}
                          {reminders.tests.length > 3 ? " …" : ""}
                        </span>
                      ) : (
                        "没有到期未处理的测试"
                      )
                    }
                  />
                </Link>
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24}>
          <Card title="快捷入口" size="small">
            <Space wrap>
              <Link href="/resource-allocations">
                <Button>新增资源分配</Button>
              </Link>
              <Link href="/ip/blocks">
                <Button>IP 段管理</Button>
              </Link>
              <Link href="/ip/addresses">
                <Button>登记 IP</Button>
              </Link>
              <Link href="/vlans">
                <Button>VLAN 管理</Button>
              </Link>
              <Link href="/vxlans">
                <Button>VXLAN 管理</Button>
              </Link>
              <Link href="/broadbands">
                <Button>宽带管理</Button>
              </Link>
              <Link href="/devices">
                <Button>设备盘点</Button>
              </Link>
              <Link href="/lines">
                <Button>线路管理</Button>
              </Link>
              <Link href="/customer-tests">
                <Button>客户测试</Button>
              </Link>
              {reminders ? (
                <Typography.Text type="secondary">
                  统计时间：{reminders.today}
                </Typography.Text>
              ) : null}
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
