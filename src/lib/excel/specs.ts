import type { Option } from "@/lib/enums";
import {
  BROADBAND_STATUS,
  CRITICALITIES,
  DEVICE_FACES,
  DEVICE_ROLES,
  DEVICE_STATUS,
  DEVICE_TYPES,
  ENVIRONMENTS,
  IP_ADDRESS_ROLES,
  IP_ADDRESS_STATUS,
  IP_BLOCK_ROLES,
  IP_BLOCK_STATUS,
  LINE_SIDES,
  LINE_STATUS,
  LINE_TYPES,
  PARTY_LEVELS,
  PARTY_STATUS,
  PROTOCOLS,
  RACK_STATUS,
  SUPPLIER_CATEGORIES,
  SYSTEM_STATUS,
  TEST_STATUS,
  VLAN_STATUS,
  VXLAN_STATUS,
} from "@/lib/enums";

export type RefKind =
  | "supplier"
  | "customer"
  | "salesperson"
  | "rack"
  | "vlan"
  | "ipBlock"
  | "ipAddress"
  | "device"
  | "line"
  | "system";

export type ColType = "text" | "int" | "number" | "date" | "enum" | "boolean" | "ref";

export type ColumnSpec = {
  key: string;
  header: string;
  required?: boolean;
  type: ColType;
  options?: Option[];
  ref?: RefKind;
  width?: number;
  note?: string;
  example?: string;
  max?: number;
};

export type SheetSpec = {
  key: string;
  name: string;
  description: string;
  columns: ColumnSpec[];
};

export type ModuleSpec = {
  key: string;
  label: string;
  version: string;
  sheets: SheetSpec[];
  refs: RefKind[];
  importHint: string;
};

const BOOL: Option[] = [
  { value: "true", label: "是" },
  { value: "false", label: "否" },
];

const text = (
  key: string,
  header: string,
  opts: Partial<ColumnSpec> = {},
): ColumnSpec => ({ key, header, type: "text", ...opts });
const int = (key: string, header: string, opts: Partial<ColumnSpec> = {}): ColumnSpec => ({
  key,
  header,
  type: "int",
  ...opts,
});
const num = (key: string, header: string, opts: Partial<ColumnSpec> = {}): ColumnSpec => ({
  key,
  header,
  type: "number",
  ...opts,
});
const date = (key: string, header: string, opts: Partial<ColumnSpec> = {}): ColumnSpec => ({
  key,
  header,
  type: "date",
  ...opts,
});
const en = (
  key: string,
  header: string,
  options: Option[],
  opts: Partial<ColumnSpec> = {},
): ColumnSpec => ({ key, header, type: "enum", options, ...opts });
const bool = (key: string, header: string, opts: Partial<ColumnSpec> = {}): ColumnSpec => ({
  key,
  header,
  type: "boolean",
  options: BOOL,
  ...opts,
});
const ref = (
  key: string,
  header: string,
  refKind: RefKind,
  opts: Partial<ColumnSpec> = {},
): ColumnSpec => ({ key, header, type: "ref", ref: refKind, ...opts });

const salespersonSheet: SheetSpec = {
  key: "main",
  name: "业务员",
  description: "每行一个业务员，按姓名新增或更新；姓名全局唯一。",
  columns: [
    text("name", "姓名", { required: true, width: 20, example: "张伟" }),
    text("phone", "电话", { width: 18, example: "13800000000" }),
    en("status", "状态", PARTY_STATUS, { width: 10, example: "启用" }),
    text("notes", "备注", { width: 30 }),
  ],
};

const supplierSheet: SheetSpec = {
  key: "main",
  name: "供应商",
  description: "每行一个供应商。二级供应商必须在“上级供应商”填写已存在或同表中的一级供应商名称。",
  columns: [
    text("name", "供应商名称", { required: true, width: 28, example: "中国电信" }),
    en("level", "层级", PARTY_LEVELS, { required: true, width: 10, example: "一级" }),
    ref("parentName", "上级供应商（二级填写）", "supplier", { width: 24 }),
    en("category", "分类", SUPPLIER_CATEGORIES, { width: 12, example: "运营商" }),
    int("asn", "ASN", { width: 12 }),
    text("contactName", "联系人", { width: 14 }),
    text("phone", "电话", { width: 18 }),
    text("email", "邮箱", { width: 24 }),
    text("address", "地址", { width: 30 }),
    en("status", "状态", PARTY_STATUS, { width: 10, example: "启用" }),
    text("notes", "备注", { width: 30 }),
  ],
};

const supplierContactsSheet: SheetSpec = {
  key: "contacts",
  name: "联系方式",
  description: "每行一个联系人，按供应商名称归属；同一供应商只能有一个主要联系人。",
  columns: [
    text("supplierName", "供应商名称", { required: true, width: 28 }),
    text("supplierParentName", "上级供应商（二级填写）", { width: 24 }),
    text("name", "姓名", { required: true, width: 14 }),
    text("role", "职务", { width: 16 }),
    text("phone", "电话", { width: 18 }),
    text("email", "邮箱", { width: 24 }),
    text("wechat", "微信", { width: 18 }),
    bool("isPrimary", "主要联系人", { width: 12 }),
    text("notes", "备注", { width: 30 }),
  ],
};

const customerSheet: SheetSpec = {
  key: "main",
  name: "客户",
  description: "每行一个客户。二级客户必须在“上级客户”填写已存在或同表中的一级客户名称。",
  columns: [
    text("name", "客户名称", { required: true, width: 28, example: "示例科技有限公司" }),
    en("level", "层级", PARTY_LEVELS, { required: true, width: 10, example: "一级" }),
    ref("parentName", "上级客户（二级填写）", "customer", { width: 24 }),
    ref("salesperson", "业务员", "salesperson", { width: 14 }),
    text("contactName", "联系人", { width: 14 }),
    text("phone", "电话", { width: 18 }),
    text("email", "邮箱", { width: 24 }),
    text("address", "地址", { width: 30 }),
    en("status", "状态", PARTY_STATUS, { width: 10, example: "启用" }),
    text("notes", "备注", { width: 30 }),
  ],
};

const rackSheet: SheetSpec = {
  key: "main",
  name: "机柜",
  description:
    "一条记录代表物理机柜的一段 U 区间；同一编号可拆分多条记录，区间不能重叠；供应商必填。",
  columns: [
    text("location", "位置", { width: 20, example: "东侧" }),
    text("code", "机柜编号", { required: true, width: 16, example: "A01" }),
    en("status", "状态", RACK_STATUS, { width: 10 }),
    en("width", "宽度（英寸）", [
      { value: "19", label: "19" },
      { value: "23", label: "23" },
    ], { width: 12 }),
    int("uStart", "起始 U 位", { required: true, width: 12, example: "1" }),
    int("uEnd", "结束 U 位", { required: true, width: 12, example: "42" }),
    text("power", "电力", { width: 14 }),
    text("serial", "序列号", { width: 18 }),
    ref("supplierName", "供应商（必填）", "supplier", { width: 24 }),
    text("notes", "备注", { width: 30 }),
  ],
};

const vlanSheet: SheetSpec = {
  key: "main",
  name: "VLAN",
  description:
    "同一供应商下 VLAN ID 唯一；供应商必填。客户列可选，客户必须已存在；二级客户必须同时填写其一级客户；填写后为该 VLAN 建立资源分配。",
  columns: [
    int("vid", "VLAN ID", { required: true, width: 10, example: "100" }),
    text("name", "VLAN 名称", { required: true, width: 24 }),
    en("status", "状态", VLAN_STATUS, { width: 10 }),
    ref("supplierName", "供应商（必填）", "supplier", { width: 24 }),
    ref("customerLevel1", "一级客户", "customer", {
      width: 24,
      note: "可选；填写后为该资源创建客户分配，必须是已存在的一级客户。",
    }),
    ref("customerLevel2", "二级客户（需填写一级客户）", "customer", {
      width: 28,
      note: "可选；填写时必须同时填写一级客户，且必须是该一级客户下的二级客户。",
    }),
    text("description", "描述", { width: 32 }),
  ],
};

const vxlanSheet: SheetSpec = {
  key: "main",
  name: "VXLAN",
  description:
    "VNI 全局唯一，范围 1-16777215；一个 VLAN 最多关联一个 VXLAN。供应商可留空，由关联 VLAN 继承。客户列可选，客户必须已存在；二级客户必须同时填写其一级客户；填写后为该 VXLAN 建立资源分配。",
  columns: [
    int("vni", "VNI", { required: true, width: 14, example: "10010" }),
    text("name", "VXLAN 名称", { width: 24 }),
    en("status", "状态", VXLAN_STATUS, { width: 10 }),
    int("vlanVid", "关联 VLAN ID（可空）", { width: 16 }),
    ref("supplierName", "供应商（可继承 VLAN）", "supplier", { width: 24 }),
    ref("customerLevel1", "一级客户", "customer", {
      width: 24,
      note: "可选；填写后为该资源创建客户分配，必须是已存在的一级客户。",
    }),
    ref("customerLevel2", "二级客户（需填写一级客户）", "customer", {
      width: 28,
      note: "可选；填写时必须同时填写一级客户，且必须是该一级客户下的二级客户。",
    }),
    text("description", "描述", { width: 32 }),
  ],
};

const ipBlockSheet: SheetSpec = {
  key: "main",
  name: "IP段",
  description:
    "支持 CIDR（如 192.168.1.0/24，必须为网络地址）或 IPv4 闭区间（如 10.99.1.0-10.99.1.255，最多 4096 个地址）。区间创建后自动生成全部 IP；父网段由系统按覆盖范围自动建立。",
  columns: [
    text("cidr", "CIDR / IP 区间", {
      required: true,
      width: 26,
      example: "10.99.1.0-10.99.1.255",
    }),
    en("status", "状态", IP_BLOCK_STATUS, { required: true, width: 18, example: "在用" }),
    en("role", "角色", IP_BLOCK_ROLES, { width: 16 }),
    text("parentCidr", "父网段（CIDR / IP 区间，可空）", { width: 26 }),
    int("vlanVid", "VLAN ID（可空）", { width: 14 }),
    ref("supplierName", "供应商（可继承父段/VLAN）", "supplier", { width: 26 }),
    text("gateway", "网关", { width: 18 }),
    text("description", "描述", { width: 30 }),
    date("assignedAt", "分配日期", { width: 14 }),
  ],
};

const ipAddressSheet: SheetSpec = {
  key: "main",
  name: "IP地址",
  description:
    "IP 地址全局唯一。供应商可留空，依次从网段、设备、机柜、线路继承；主管理 IP 需绑定设备。客户列可选，客户必须已在客户管理中创建；二级客户必须同时填写其一级客户；填写后为该 IP 建立资源分配。",
  columns: [
    text("address", "IP 地址", { required: true, width: 20, example: "192.168.1.10" }),
    ref("blockCidr", "所在网段（CIDR / IP 区间）", "ipBlock", { width: 26 }),
    en("status", "状态", IP_ADDRESS_STATUS, { required: true, width: 12 }),
    en("role", "角色", IP_ADDRESS_ROLES, { width: 14 }),
    ref("supplierName", "供应商（可继承）", "supplier", { width: 24 }),
    ref("customerLevel1", "一级客户", "customer", {
      width: 24,
      note: "可选；填写后为该 IP 创建客户分配，必须是已存在的一级客户。",
    }),
    ref("customerLevel2", "二级客户（需填写一级客户）", "customer", {
      width: 28,
      note: "可选；填写时必须同时填写一级客户，且必须是该一级客户下的二级客户。",
    }),
    text("rackCode", "机柜编号", { width: 14 }),
    ref("deviceName", "设备名称", "device", { width: 22 }),
    ref("lineCode", "线路编号", "line", { width: 18 }),
    bool("isPrimary", "主管理 IP", { width: 12 }),
    text("dnsName", "DNS 名称", { width: 26 }),
    text("description", "描述", { width: 30 }),
    date("assignedAt", "分配日期", { width: 14 }),
  ],
};

const deviceSheet: SheetSpec = {
  key: "main",
  name: "设备",
  description:
    "设备放入机柜时必须填写起始 U 位；同机柜同面板 U 位不可重叠。供应商可留空，由机柜继承。管理 IP 必须已存在于 IP 台账。客户列可选，客户必须已存在；二级客户必须同时填写其一级客户；填写后为该设备建立资源分配。",
  columns: [
    text("name", "设备名称", { required: true, width: 24, example: "核心路由器-01" }),
    en("type", "类型", DEVICE_TYPES, { required: true, width: 12 }),
    en("role", "角色", DEVICE_ROLES, { width: 14 }),
    en("status", "状态", DEVICE_STATUS, { required: true, width: 12 }),
    text("manufacturer", "厂商", { width: 16 }),
    text("model", "型号", { width: 18 }),
    text("serialNo", "序列号", { width: 20 }),
    text("assetTag", "资产编号", { width: 18 }),
    text("osVersion", "系统版本", { width: 16 }),
    text("mac", "MAC 地址", { width: 18 }),
    text("rackCode", "机柜编号", { width: 14 }),
    int("uStart", "起始 U 位", { width: 12 }),
    int("uHeight", "高度（U）", { width: 12 }),
    en("face", "面板", DEVICE_FACES, { width: 10 }),
    ref("supplierName", "供应商（可继承机柜）", "supplier", { width: 24 }),
    ref("customerLevel1", "一级客户", "customer", {
      width: 24,
      note: "可选；填写后为该资源创建客户分配，必须是已存在的一级客户。",
    }),
    ref("customerLevel2", "二级客户（需填写一级客户）", "customer", {
      width: 28,
      note: "可选；填写时必须同时填写一级客户，且必须是该一级客户下的二级客户。",
    }),
    text("owner", "负责人", { width: 14 }),
    date("lastInventoryAt", "最近盘点日期", { width: 16 }),
    date("purchaseDate", "采购日期", { width: 14 }),
    date("warrantyEnd", "保修到期", { width: 14 }),
    ref("managementIp", "管理 IP", "ipAddress", { width: 20 }),
    text("notes", "备注", { width: 30 }),
  ],
};

const lineSheet: SheetSpec = {
  key: "main",
  name: "线路",
  description:
    "线路编号全局唯一；供应商必填；A/Z 端点在第二个工作表维护。客户列可选，客户必须已存在；二级客户必须同时填写其一级客户；填写后为该线路建立资源分配。",
  columns: [
    text("code", "线路编号", { required: true, width: 18, example: "LN-2026-001" }),
    text("name", "线路名称", { required: true, width: 24 }),
    en("type", "类型", LINE_TYPES, { width: 14 }),
    en("status", "状态", LINE_STATUS, { width: 12 }),
    ref("supplierName", "供应商（必填）", "supplier", { width: 24 }),
    ref("customerLevel1", "一级客户", "customer", {
      width: 24,
      note: "可选；填写后为该资源创建客户分配，必须是已存在的一级客户。",
    }),
    ref("customerLevel2", "二级客户（需填写一级客户）", "customer", {
      width: 28,
      note: "可选；填写时必须同时填写一级客户，且必须是该一级客户下的二级客户。",
    }),
    int("bandwidthMbps", "带宽（Mbps）", { width: 14 }),
    num("monthlyFeeYuan", "月租（元）", { width: 14 }),
    text("circuitNo", "电路号", { width: 18 }),
    date("installDate", "开通日期", { width: 14 }),
    date("expireDate", "到期日期", { width: 14 }),
    text("description", "描述", { width: 32 }),
  ],
};

const lineTermSheet: SheetSpec = {
  key: "terminations",
  name: "线路端点",
  description: "每条线路最多 A 端、Z 端各一行；线路编号必须存在。",
  columns: [
    text("lineCode", "线路编号", { required: true, width: 18 }),
    en("side", "端点", LINE_SIDES, { required: true, width: 10 }),
    text("rackCode", "机柜编号", { width: 14 }),
    ref("deviceName", "设备名称", "device", { width: 22 }),
    text("port", "端口", { width: 16 }),
    text("description", "描述", { width: 30 }),
  ],
};

const broadbandSheet: SheetSpec = {
  key: "main",
  name: "宽带",
  description:
    "宽带名称/编号全局唯一；供应商必填。机柜、设备、线路、IP 地址可选，按自然键匹配。",
  columns: [
    text("name", "名称 / 编号", { required: true, width: 24, example: "BW-2026-001" }),
    ref("supplierName", "供应商（必填）", "supplier", { width: 24 }),
    int("bandwidthMbps", "带宽（Mbps）", { width: 14 }),
    en("status", "状态", BROADBAND_STATUS, { width: 12 }),
    date("expireDate", "到期日期", { width: 14 }),
    text("account", "宽带账号", { width: 20 }),
    text("password", "密码", { width: 18 }),
    text("installAddress", "安装地址", { width: 32 }),
    text("rackCode", "机柜编号", { width: 14 }),
    ref("deviceName", "设备名称", "device", { width: 22 }),
    ref("lineCode", "线路编号", "line", { width: 18 }),
    ref("ipAddress", "IP 地址", "ipAddress", { width: 20 }),
    num("monthlyFeeYuan", "月费（元）", { width: 14 }),
    text("contractNo", "合同号", { width: 20 }),
    text("description", "描述", { width: 30 }),
    text("notes", "备注", { width: 30 }),
  ],
};

const systemSheet: SheetSpec = {
  key: "main",
  name: "业务系统",
  description: "系统编号全局唯一（可空）。访问端点在第二个工作表维护。",
  columns: [
    text("name", "系统名称", { required: true, width: 26, example: "计费系统" }),
    text("code", "系统编号", { width: 18 }),
    text("owner", "负责人", { required: true, width: 14 }),
    text("department", "部门", { width: 18 }),
    en("environment", "环境", ENVIRONMENTS, { required: true, width: 10 }),
    en("criticality", "重要性", CRITICALITIES, { required: true, width: 10 }),
    en("status", "状态", SYSTEM_STATUS, { required: true, width: 10 }),
    text("url", "访问地址", { width: 32 }),
    text("domain", "域名", { width: 24 }),
    date("onlineDate", "上线日期", { width: 14 }),
    text("description", "描述", { width: 32 }),
  ],
};

const systemEndpointSheet: SheetSpec = {
  key: "endpoints",
  name: "访问端点",
  description:
    "系统名称必须存在；IP 地址优先匹配 IP 台账，未匹配时作为独立 IP 文本保存。",
  columns: [
    text("systemName", "系统名称", { required: true, width: 26 }),
    text("ipAddress", "IP 地址", { required: true, width: 20 }),
    int("port", "端口", { width: 10 }),
    en("protocol", "协议", PROTOCOLS, { width: 10 }),
    bool("isPrimary", "主要端点", { width: 12 }),
    text("description", "描述", { width: 30 }),
  ],
};

const testSheet: SheetSpec = {
  key: "main",
  name: "客户测试",
  description:
    "序号用于更新已有记录（留空则新建）；结束日期默认开始日期 +7 天；转正后自动视为接单。",
  columns: [
    int("seqNo", "序号（更新时填写）", { width: 16 }),
    text("companyName", "公司名称", { required: true, width: 28 }),
    ref("customerName", "关联客户", "customer", { width: 24 }),
    text("salesperson", "业务员", { width: 14 }),
    text("content", "测试内容", { width: 32 }),
    date("startAt", "测试开始日期", { required: true, width: 16 }),
    date("endAt", "测试结束日期", { width: 16 }),
    bool("accepted", "是否接单", { width: 12 }),
    bool("converted", "是否转正", { width: 12 }),
    en("status", "测试结果", TEST_STATUS, { width: 14 }),
    text("notes", "备注", { width: 30 }),
  ],
};

export const MODULES: Record<string, ModuleSpec> = {
  salespersons: {
    key: "salespersons",
    label: "业务员",
    version: "1.0",
    sheets: [salespersonSheet],
    refs: [],
    importHint: "按姓名新增或更新；姓名全局唯一。客户导入引用业务员前，请先导入或维护业务员。",
  },
  suppliers: {
    key: "suppliers",
    label: "供应商及联系方式",
    version: "1.0",
    sheets: [supplierSheet, supplierContactsSheet],
    refs: ["supplier"],
    importHint: "先导入一级供应商，再导入二级供应商；联系方式工作表可同时导入。",
  },
  customers: {
    key: "customers",
    label: "客户",
    version: "1.1",
    sheets: [customerSheet],
    refs: ["customer", "salesperson"],
    importHint:
      "先导入一级客户，再导入二级客户；业务员必须是系统中已存在的姓名（由管理员在「业务员管理」维护）。IP 地址、VLAN、VXLAN、线路、设备的创建或导入也可绑定客户；客户变更和释放仍在系统「资源分配」中操作。",
  },
  racks: {
    key: "racks",
    label: "机柜",
    version: "3.0",
    sheets: [rackSheet],
    refs: ["supplier"],
    importHint:
      "导入前先建立供应商；同一机柜编号可有多条互不重叠的 U 区间记录，供应商必填。",
  },
  vlans: {
    key: "vlans",
    label: "VLAN",
    version: "2.1",
    sheets: [vlanSheet],
    refs: ["supplier", "customer"],
    importHint:
      "导入前先建立供应商、客户；同一供应商下 VLAN ID 唯一，供应商必填。一级/二级客户列可选，客户必须已存在，二级客户必须同时填写其一级客户；填写后会为 VLAN 建立资源分配，客户不存在或 VLAN 已分配给其他客户时整批不导入。",
  },
  vxlans: {
    key: "vxlans",
    label: "VXLAN",
    version: "2.1",
    sheets: [vxlanSheet],
    refs: ["vlan", "supplier", "customer"],
    importHint:
      "导入前先建立 VLAN、供应商、客户；VNI 全局唯一，供应商可由关联 VLAN 继承。一级/二级客户列可选，客户必须已存在，二级客户必须同时填写其一级客户；填写后会为 VXLAN 建立资源分配，客户不存在或 VXLAN 已分配给其他客户时整批不导入。",
  },
  "ip-blocks": {
    key: "ip-blocks",
    label: "IP 段",
    version: "2.1",
    sheets: [ipBlockSheet],
    refs: ["vlan", "supplier"],
    importHint:
      "先导入 VLAN、供应商；支持 CIDR 与 IPv4 闭区间（每段最多 4096 个地址），区间会自动生成全部 IP；按覆盖范围从大到小排序建立父子关系，供应商可继承父段/VLAN。",
  },
  devices: {
    key: "devices",
    label: "设备",
    version: "2.1",
    sheets: [deviceSheet],
    refs: ["supplier", "rack", "customer"],
    importHint:
      "导入前先建立机柜、供应商、客户；设备按「机柜编号 + 起始 U 位」匹配机柜区间，供应商可由机柜继承，管理 IP 必须已存在 IP 台账。一级/二级客户列可选，客户必须已存在，二级客户必须同时填写其一级客户；填写后会为设备建立资源分配，客户不存在或设备已分配给其他客户时整批不导入。",
  },
  lines: {
    key: "lines",
    label: "线路及 A/Z 端点",
    version: "2.1",
    sheets: [lineSheet, lineTermSheet],
    refs: ["supplier", "device", "customer"],
    importHint:
      "导入前先建立供应商、机柜、设备、客户；线路供应商必填。一级/二级客户列可选，客户必须已存在，二级客户必须同时填写其一级客户；填写后会为线路建立资源分配，客户不存在或线路已分配给其他客户时整批不导入。",
  },
  "ip-addresses": {
    key: "ip-addresses",
    label: "IP 地址",
    version: "2.2",
    sheets: [ipAddressSheet],
    refs: ["ipBlock", "supplier", "customer", "rack", "device", "line"],
    importHint:
      "导入前先建立 IP 段（CIDR 或 IP 区间）、机柜、设备、线路、客户；供应商可依次从网段/设备/机柜/线路继承。一级/二级客户列可选，客户必须已存在，二级客户必须同时填写其一级客户；填写后会为 IP 建立资源分配，客户不存在或 IP 已分配给其他客户时整批不导入。",
  },
  broadbands: {
    key: "broadbands",
    label: "宽带",
    version: "2.0",
    sheets: [broadbandSheet],
    refs: ["supplier", "rack", "device", "line", "ipAddress"],
    importHint: "导入前先建立供应商、机柜、设备、线路、IP；宽带供应商必填。",
  },
  "business-systems": {
    key: "business-systems",
    label: "业务系统及访问端点",
    version: "1.0",
    sheets: [systemSheet, systemEndpointSheet],
    refs: ["system"],
    importHint: "IP 地址可关联 IP 台账，也可填写未登记的 IP 文本。",
  },
  "customer-tests": {
    key: "customer-tests",
    label: "客户测试",
    version: "1.0",
    sheets: [testSheet],
    refs: ["customer"],
    importHint: "关联客户可留空；留空时仅保存公司名称快照。",
  },
};

export function moduleSpec(key: string): ModuleSpec | null {
  return MODULES[key] ?? null;
}

export function displayHeader(col: ColumnSpec): string {
  return col.required ? `${col.header}*` : col.header;
}

export function normalizeHeader(header: string): string {
  return header.replace(/\*+$/, "").trim();
}
