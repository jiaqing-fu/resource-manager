export type Option = { value: string; label: string; color?: string };

export const USER_ROLES: Option[] = [
  { value: "ADMIN", label: "管理员", color: "red" },
  { value: "USER", label: "普通用户", color: "blue" },
];

export const PARTY_LEVELS: Option[] = [
  { value: "1", label: "一级" },
  { value: "2", label: "二级" },
];

export const PARTY_STATUS: Option[] = [
  { value: "active", label: "启用", color: "green" },
  { value: "inactive", label: "停用", color: "default" },
];

export const SUPPLIER_CATEGORIES: Option[] = [
  { value: "carrier", label: "运营商" },
  { value: "idc", label: "IDC" },
  { value: "vendor", label: "设备商" },
  { value: "other", label: "其他" },
];

export const RACK_STATUS: Option[] = [
  { value: "active", label: "在用", color: "green" },
  { value: "planned", label: "规划中", color: "blue" },
  { value: "reserved", label: "预留", color: "orange" },
  { value: "deprecated", label: "已废弃", color: "default" },
];

export const VLAN_STATUS: Option[] = [
  { value: "active", label: "在用", color: "green" },
  { value: "reserved", label: "预留", color: "orange" },
  { value: "deprecated", label: "已废弃", color: "default" },
];

export const VXLAN_STATUS: Option[] = [
  { value: "active", label: "在用", color: "green" },
  { value: "planned", label: "规划中", color: "blue" },
  { value: "deprecated", label: "已停用", color: "default" },
];

export const IP_BLOCK_STATUS: Option[] = [
  { value: "active", label: "在用", color: "green" },
  { value: "container", label: "容器", color: "blue" },
  { value: "reserved", label: "预留", color: "orange" },
  { value: "deprecated", label: "已废弃", color: "default" },
];

export const IP_BLOCK_ROLES: Option[] = [
  { value: "transit", label: "传输" },
  { value: "customer_pool", label: "客户地址池" },
  { value: "internal", label: "内部" },
  { value: "other", label: "其他" },
];

export const IP_ADDRESS_STATUS: Option[] = [
  { value: "active", label: "在用", color: "green" },
  { value: "reserved", label: "预留", color: "orange" },
  { value: "deprecated", label: "已废弃", color: "default" },
  { value: "dhcp", label: "DHCP", color: "blue" },
  { value: "slaac", label: "SLAAC", color: "cyan" },
];

export const IP_ADDRESS_ROLES: Option[] = [
  { value: "management", label: "管理" },
  { value: "customer", label: "客户" },
  { value: "transit", label: "传输" },
  { value: "vip", label: "VIP" },
  { value: "other", label: "其他" },
];

export const DEVICE_TYPES: Option[] = [
  { value: "router", label: "路由器" },
  { value: "switch", label: "交换机" },
  { value: "firewall", label: "防火墙" },
  { value: "ap", label: "无线 AP" },
  { value: "other", label: "其他" },
];

export const DEVICE_ROLES: Option[] = [
  { value: "core", label: "核心" },
  { value: "aggregation", label: "汇聚" },
  { value: "access", label: "接入" },
  { value: "customer_edge", label: "客户边缘" },
  { value: "other", label: "其他" },
];

export const DEVICE_STATUS: Option[] = [
  { value: "active", label: "在用", color: "green" },
  { value: "planned", label: "规划中", color: "blue" },
  { value: "staged", label: "待上线", color: "cyan" },
  { value: "inventory", label: "库存", color: "default" },
  { value: "offline", label: "离线", color: "orange" },
  { value: "failed", label: "故障", color: "red" },
  { value: "decommissioning", label: "退网中", color: "volcano" },
];

export const DEVICE_FACES: Option[] = [
  { value: "front", label: "前面板" },
  { value: "rear", label: "后面板" },
];

export const LINE_TYPES: Option[] = [
  { value: "internet", label: "互联网" },
  { value: "mpls", label: "MPLS" },
  { value: "dark_fiber", label: "裸光纤" },
  { value: "point_to_point", label: "点对点" },
  { value: "other", label: "其他" },
];

export const LINE_STATUS: Option[] = [
  { value: "planned", label: "规划中", color: "blue" },
  { value: "provisioning", label: "开通中", color: "cyan" },
  { value: "active", label: "在用", color: "green" },
  { value: "offline", label: "停用", color: "orange" },
  { value: "deprovisioned", label: "已退网", color: "default" },
];

export const LINE_SIDES: Option[] = [
  { value: "A", label: "A 端" },
  { value: "Z", label: "Z 端" },
];

export const BROADBAND_STATUS: Option[] = [
  { value: "active", label: "正常", color: "green" },
  { value: "planned", label: "待开通", color: "blue" },
  { value: "suspended", label: "暂停", color: "orange" },
  { value: "terminated", label: "已停用", color: "default" },
];

export const ALLOCATION_RESOURCE_TYPES: Option[] = [
  { value: "ipAddress", label: "IP 地址" },
  { value: "ipBlock", label: "IP 段" },
  { value: "rack", label: "机柜" },
  { value: "device", label: "设备" },
  { value: "vlan", label: "VLAN" },
  { value: "vxlan", label: "VXLAN" },
  { value: "broadband", label: "宽带" },
  { value: "line", label: "线路" },
];

export const ALLOCATION_STATUS: Option[] = [
  { value: "active", label: "已分配", color: "green" },
  { value: "released", label: "已释放", color: "default" },
];

export const ENVIRONMENTS: Option[] = [
  { value: "prod", label: "生产", color: "green" },
  { value: "staging", label: "预发", color: "orange" },
  { value: "test", label: "测试", color: "blue" },
];

export const CRITICALITIES: Option[] = [
  { value: "core", label: "核心", color: "red" },
  { value: "important", label: "重要", color: "orange" },
  { value: "normal", label: "一般", color: "default" },
];

export const SYSTEM_STATUS: Option[] = [
  { value: "active", label: "在用", color: "green" },
  { value: "planned", label: "规划中", color: "blue" },
  { value: "retired", label: "已下线", color: "default" },
];

export const PROTOCOLS: Option[] = [
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
  { value: "other", label: "其他" },
];

export const TEST_STATUS: Option[] = [
  { value: "passed", label: "测试通过", color: "green" },
  { value: "failed", label: "测试未通过", color: "red" },
];

export const TEST_DISPLAY_STATUS: Option[] = [
  { value: "testing", label: "测试中", color: "blue" },
  { value: "passed", label: "测试通过", color: "green" },
  { value: "failed", label: "测试未通过", color: "red" },
  { value: "expired", label: "测试到期", color: "orange" },
];

export const CHANGE_ACTIONS: Option[] = [
  { value: "CREATE", label: "创建", color: "green" },
  { value: "UPDATE", label: "修改", color: "blue" },
  { value: "DELETE", label: "删除", color: "red" },
  { value: "IMPORT", label: "导入", color: "purple" },
  { value: "SEND", label: "发送", color: "cyan" },
];

export const NOTIFICATION_STATUS: Option[] = [
  { value: "draft", label: "草稿", color: "default" },
  { value: "sent", label: "已发送", color: "green" },
  { value: "failed", label: "发送失败", color: "red" },
];

export const IP_VERSIONS: Option[] = [
  { value: "4", label: "IPv4" },
  { value: "6", label: "IPv6" },
];

const ALL: Array<Option[]> = [
  USER_ROLES,
  PARTY_LEVELS,
  PARTY_STATUS,
  SUPPLIER_CATEGORIES,
  RACK_STATUS,
  VLAN_STATUS,
  VXLAN_STATUS,
  IP_BLOCK_STATUS,
  IP_BLOCK_ROLES,
  IP_ADDRESS_STATUS,
  IP_ADDRESS_ROLES,
  BROADBAND_STATUS,
  ALLOCATION_RESOURCE_TYPES,
  ALLOCATION_STATUS,
  DEVICE_TYPES,
  DEVICE_ROLES,
  DEVICE_STATUS,
  DEVICE_FACES,
  LINE_TYPES,
  LINE_STATUS,
  LINE_SIDES,
  ENVIRONMENTS,
  CRITICALITIES,
  SYSTEM_STATUS,
  PROTOCOLS,
  TEST_STATUS,
  TEST_DISPLAY_STATUS,
  CHANGE_ACTIONS,
  NOTIFICATION_STATUS,
  IP_VERSIONS,
];

/** 根据值查中文标签；兼容数字型枚举值。 */
export function labelOf(options: Option[], value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const found = options.find((o) => o.value === String(value));
  return found ? found.label : String(value);
}

/** 根据值查颜色，用于 Tag。 */
export function colorOf(options: Option[], value: unknown): string | undefined {
  return options.find((o) => o.value === String(value))?.color;
}

/** 所有枚举的中文标签映射，Excel 导出时使用。 */
export const LABEL_MAPS = {
  userRole: Object.fromEntries(USER_ROLES.map((o) => [o.value, o.label])),
  level: Object.fromEntries(PARTY_LEVELS.map((o) => [o.value, o.label])),
  partyStatus: Object.fromEntries(PARTY_STATUS.map((o) => [o.value, o.label])),
  supplierCategory: Object.fromEntries(SUPPLIER_CATEGORIES.map((o) => [o.value, o.label])),
  rackStatus: Object.fromEntries(RACK_STATUS.map((o) => [o.value, o.label])),
  vlanStatus: Object.fromEntries(VLAN_STATUS.map((o) => [o.value, o.label])),
  vxlanStatus: Object.fromEntries(VXLAN_STATUS.map((o) => [o.value, o.label])),
  ipBlockStatus: Object.fromEntries(IP_BLOCK_STATUS.map((o) => [o.value, o.label])),
  ipBlockRole: Object.fromEntries(IP_BLOCK_ROLES.map((o) => [o.value, o.label])),
  ipStatus: Object.fromEntries(IP_ADDRESS_STATUS.map((o) => [o.value, o.label])),
  ipRole: Object.fromEntries(IP_ADDRESS_ROLES.map((o) => [o.value, o.label])),
  broadbandStatus: Object.fromEntries(BROADBAND_STATUS.map((o) => [o.value, o.label])),
  allocationResourceType: Object.fromEntries(
    ALLOCATION_RESOURCE_TYPES.map((o) => [o.value, o.label]),
  ),
  deviceType: Object.fromEntries(DEVICE_TYPES.map((o) => [o.value, o.label])),
  deviceRole: Object.fromEntries(DEVICE_ROLES.map((o) => [o.value, o.label])),
  deviceStatus: Object.fromEntries(DEVICE_STATUS.map((o) => [o.value, o.label])),
  deviceFace: Object.fromEntries(DEVICE_FACES.map((o) => [o.value, o.label])),
  lineType: Object.fromEntries(LINE_TYPES.map((o) => [o.value, o.label])),
  lineStatus: Object.fromEntries(LINE_STATUS.map((o) => [o.value, o.label])),
  lineSide: Object.fromEntries(LINE_SIDES.map((o) => [o.value, o.label])),
  environment: Object.fromEntries(ENVIRONMENTS.map((o) => [o.value, o.label])),
  criticality: Object.fromEntries(CRITICALITIES.map((o) => [o.value, o.label])),
  systemStatus: Object.fromEntries(SYSTEM_STATUS.map((o) => [o.value, o.label])),
  protocol: Object.fromEntries(PROTOCOLS.map((o) => [o.value, o.label])),
  testStatus: Object.fromEntries(TEST_STATUS.map((o) => [o.value, o.label])),
  ipVersion: Object.fromEntries(IP_VERSIONS.map((o) => [o.value, o.label])),
} as const;

export { ALL as ALL_ENUM_GROUPS };
