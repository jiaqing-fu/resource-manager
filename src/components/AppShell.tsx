"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { App, Avatar, Button, Dropdown, Layout, Menu, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
import {
  ApiOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  ClusterOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileWordOutlined,
  GlobalOutlined,
  HistoryOutlined,
  IdcardOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  NodeIndexOutlined,
  PartitionOutlined,
  SettingOutlined,
  ShopOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { GlobalSearch } from "@/components/GlobalSearch";
import { SessionProvider } from "@/components/SessionContext";
import type { SessionUser } from "@/lib/auth";
import { USER_ROLES, labelOf } from "@/lib/enums";

const { Header, Sider, Content } = Layout;

const ROUTE_KEYS = [
  "/customers",
  "/resource-allocations",
  "/salespersons",
  "/suppliers",
  "/customer-tests",
  "/notifications",
  "/business-systems",
  "/racks",
  "/ip/blocks",
  "/ip/addresses",
  "/vlans",
  "/vxlans",
  "/broadbands",
  "/lines",
  "/devices",
  "/users",
  "/changelog",
  "/profile",
];

function parentKeysFor(pathname: string): string[] {
  if (pathname.startsWith("/ip/")) return ["resources", "ipam"];
  if (pathname.startsWith("/vlans") || pathname.startsWith("/vxlans")) {
    return ["resources", "lan"];
  }
  if (["/racks", "/broadbands", "/lines", "/devices"].some((p) => pathname.startsWith(p))) {
    return ["resources"];
  }
  if (pathname.startsWith("/customers") || pathname.startsWith("/resource-allocations")) {
    return ["customer-group"];
  }
  if (pathname.startsWith("/users") || pathname.startsWith("/changelog")) {
    return ["system"];
  }
  return [];
}

export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { message } = App.useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const effectiveOpenKeys = Array.from(new Set([...openKeys, ...parentKeysFor(pathname)]));

  const menuItems = useMemo<MenuProps["items"]>(() => {
    const items: MenuProps["items"] = [
      {
        key: "/",
        icon: <DashboardOutlined />,
        label: <Link href="/">工作台</Link>,
      },
      {
        key: "customer-group",
        icon: <TeamOutlined />,
        label: "客户管理",
        children: [
          { key: "/customers", icon: <TeamOutlined />, label: <Link href="/customers">客户列表</Link> },
          {
            key: "/resource-allocations",
            icon: <ApartmentOutlined />,
            label: <Link href="/resource-allocations">资源分配</Link>,
          },
        ],
      },
      ...(user.role === "ADMIN"
        ? [
            {
              key: "/salespersons",
              icon: <IdcardOutlined />,
              label: <Link href="/salespersons">业务员管理</Link>,
            },
          ]
        : []),
      {
        key: "/suppliers",
        icon: <ShopOutlined />,
        label: <Link href="/suppliers">供应商管理</Link>,
      },
      {
        key: "/customer-tests",
        icon: <ExperimentOutlined />,
        label: <Link href="/customer-tests">客户测试统计</Link>,
      },
      {
        key: "/notifications",
        icon: <FileWordOutlined />,
        label: <Link href="/notifications">通知管理</Link>,
      },
      {
        key: "/business-systems",
        icon: <AppstoreOutlined />,
        label: <Link href="/business-systems">业务系统登记</Link>,
      },
      {
        key: "resources",
        icon: <ClusterOutlined />,
        label: "资源管理",
        children: [
          { key: "/racks", icon: <DatabaseOutlined />, label: <Link href="/racks">机柜管理</Link> },
          {
            key: "ipam",
            icon: <ApartmentOutlined />,
            label: "IP 管理",
            children: [
              {
                key: "/ip/blocks",
                icon: <PartitionOutlined />,
                label: <Link href="/ip/blocks">IP 段管理</Link>,
              },
              {
                key: "/ip/addresses",
                icon: <ApiOutlined />,
                label: <Link href="/ip/addresses">IP 地址管理</Link>,
              },
            ],
          },
          {
            key: "lan",
            icon: <NodeIndexOutlined />,
            label: "LAN 管理",
            children: [
              { key: "/vlans", icon: <PartitionOutlined />, label: <Link href="/vlans">VLAN 管理</Link> },
              { key: "/vxlans", icon: <NodeIndexOutlined />, label: <Link href="/vxlans">VXLAN 管理</Link> },
            ],
          },
          {
            key: "/broadbands",
            icon: <GlobalOutlined />,
            label: <Link href="/broadbands">宽带管理</Link>,
          },
          { key: "/lines", icon: <PartitionOutlined />, label: <Link href="/lines">线路管理</Link> },
          { key: "/devices", icon: <ClusterOutlined />, label: <Link href="/devices">设备管理</Link> },
        ],
      },
      {
        key: "system",
        icon: <SettingOutlined />,
        label: "系统管理",
        children: [
          ...(user.role === "ADMIN"
            ? [
                { key: "/users", icon: <UserOutlined />, label: <Link href="/users">用户管理</Link> },
                {
                  key: "/changelog",
                  icon: <HistoryOutlined />,
                  label: <Link href="/changelog">变更记录</Link>,
                },
              ]
            : []),
          { key: "/profile", icon: <SettingOutlined />, label: <Link href="/profile">修改密码</Link> },
        ],
      },
    ];
    return items;
  }, [user.role]);

  const selectedKey = useMemo(() => {
    if (pathname === "/") return "/";
    return ROUTE_KEYS.find((k) => pathname.startsWith(k)) ?? pathname;
  }, [pathname]);

  const userMenu: MenuProps = {
    items: [
      {
        key: "info",
        icon: <UserOutlined />,
        label: `${user.displayName}（${labelOf(USER_ROLES, user.role)}）`,
        disabled: true,
      },
      { type: "divider" },
      { key: "profile", icon: <SettingOutlined />, label: "修改密码" },
      { key: "logout", icon: <LogoutOutlined />, label: "退出登录", danger: true },
    ],
    onClick: async ({ key }) => {
      if (key === "profile") {
        router.push("/profile");
        return;
      }
      if (key === "logout") {
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } catch {
          // 忽略网络错误，仍然回到登录页
        }
        message.success("已退出登录");
        router.replace("/login");
        router.refresh();
      }
    },
  };

  return (
    <SessionProvider user={user}>
      <Layout className="rm-shell">
        <Sider
          width={224}
          theme="dark"
          collapsible
          collapsed={collapsed}
          trigger={null}
          breakpoint="lg"
          collapsedWidth={64}
          onBreakpoint={(broken) => setCollapsed(broken)}
          style={{ position: "sticky", top: 0, height: "100vh", overflow: "auto" }}
        >
          <div className="rm-logo">
            <span className="rm-logo-mark">
              <ApartmentOutlined />
            </span>
            {!collapsed ? <span>技术资源管理</span> : null}
          </div>
          <Menu
            theme="dark"
            mode="inline"
            items={menuItems}
            selectedKeys={[selectedKey]}
            {...(collapsed
              ? {}
              : {
                  openKeys: effectiveOpenKeys,
                  onOpenChange: (keys: string[]) => setOpenKeys(keys),
                })}
          />
        </Sider>
        <Layout>
          <Header className="rm-header">
            <div className="rm-header-left">
              <Button
                type="text"
                aria-label={collapsed ? "展开导航" : "收起导航"}
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed((v) => !v)}
              />
              <GlobalSearch />
            </div>
            <div className="rm-header-right">
              {user.role === "ADMIN" ? <Tag color="red">管理员</Tag> : <Tag color="blue">普通用户</Tag>}
              <Dropdown menu={userMenu} placement="bottomRight" trigger={["click"]}>
                <div className="rm-user">
                  <Avatar size={28} style={{ background: "#1677ff" }}>
                    {user.displayName.slice(0, 1)}
                  </Avatar>
                  <Typography.Text>{user.displayName}</Typography.Text>
                </div>
              </Dropdown>
            </div>
          </Header>
          <Content>
            <div className="rm-content">{children}</div>
          </Content>
        </Layout>
      </Layout>
    </SessionProvider>
  );
}
