export type ListResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type IdName = { id: string; name: string };

export type Counts = Record<string, number>;

export type SupplierContact = {
  id: string;
  supplierId: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  isPrimary: boolean;
  notes: string | null;
};

export type Supplier = {
  id: string;
  name: string;
  level: number;
  parentId: string | null;
  parent?: IdName | null;
  category: string;
  asn: number | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string;
  notes: string | null;
  contacts?: SupplierContact[];
  children?: Array<{ id: string; name: string; level: number }>;
  _count?: Counts;
  createdAt: string;
  updatedAt: string;
};

export type Salesperson = {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  notes: string | null;
  _count?: Counts;
  createdAt: string;
  updatedAt: string;
};

export type Customer = {
  id: string;
  name: string;
  level: number;
  parentId: string | null;
  parent?: IdName | null;
  salespersonId: string | null;
  salesperson?: Pick<Salesperson, "id" | "name" | "status"> | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string;
  notes: string | null;
  children?: Array<{ id: string; name: string; level: number }>;
  _count?: Counts;
  createdAt: string;
  updatedAt: string;
};

export type Rack = {
  id: string;
  code: string;
  location: string | null;
  status: string;
  width: number;
  uStart: number;
  uEnd: number;
  power: string | null;
  serial: string | null;
  supplierId: string | null;
  supplier?: IdName | null;
  customerId: string | null;
  customer?: IdName | null;
  customerSummary?: string | null;
  customerNames?: string[];
  notes: string | null;
  usedUFront?: number;
  usedURear?: number;
  usedU?: number;
  occupiedU?: number;
  maxU?: number;
  devices?: Device[];
  allocations?: Array<{
    id: string;
    customerId: string;
    customer?: IdName | null;
    uStart: number | null;
    uEnd: number | null;
    allocatedAt: string;
    notes: string | null;
  }>;
  _count?: Counts;
  createdAt: string;
  updatedAt: string;
};

export type Vlan = {
  id: string;
  vid: number;
  name: string;
  status: string;
  description: string | null;
  supplierId: string | null;
  supplier?: IdName | null;
  customerId: string | null;
  customer?: IdName | null;
  vxlan?: { id: string; vni: number; name: string | null; status: string } | null;
  _count?: Counts;
  createdAt: string;
  updatedAt: string;
};

export type Vxlan = {
  id: string;
  vni: number;
  name: string | null;
  status: string;
  description: string | null;
  vlanId: string | null;
  vlan?: { id: string; vid: number; name: string } | null;
  supplierId: string | null;
  supplier?: IdName | null;
  customerId: string | null;
  customer?: IdName | null;
  _count?: Counts;
  createdAt: string;
  updatedAt: string;
};

export type IpBlock = {
  id: string;
  cidr: string;
  parentId: string | null;
  parent?: { id: string; cidr: string } | null;
  children?: Array<{ id: string; cidr: string }>;
  ipVersion: number;
  status: string;
  role: string;
  vlanId: string | null;
  vlan?: { id: string; vid: number; name: string } | null;
  supplierId: string | null;
  supplier?: IdName | null;
  customerId: string | null;
  customer?: IdName | null;
  gateway: string | null;
  description: string | null;
  assignedAt: string | null;
  ipAddresses?: IpAddress[];
  _count?: Counts;
  createdAt: string;
  updatedAt: string;
};

export type BlockTreeNode = {
  id: string;
  cidr: string;
  status: string;
  role: string;
  parentId: string | null;
  supplierId: string | null;
  customerId: string | null;
  supplierName: string | null;
  customerName: string | null;
  directUsed: number;
  used: number;
  total: number | null;
  percent: number | null;
  children: BlockTreeNode[];
};

export type IpAddress = {
  id: string;
  address: string;
  status: string;
  role: string;
  blockId: string | null;
  block?: { id: string; cidr: string } | null;
  supplierId: string | null;
  supplier?: IdName | null;
  customerId: string | null;
  customer?: IdName | null;
  rackId: string | null;
  rack?: {
    id: string;
    code: string;
    uStart?: number;
    uEnd?: number;
    location?: string | null;
  } | null;
  deviceId: string | null;
  device?: IdName | null;
  lineId: string | null;
  line?: { id: string; code: string; name?: string } | null;
  isPrimary: boolean;
  dnsName: string | null;
  description: string | null;
  assignedAt: string | null;
  endpoints?: Array<{
    id: string;
    port: number | null;
    protocol: string;
    isPrimary: boolean;
    system: IdName;
  }>;
  _count?: Counts;
  createdAt: string;
  updatedAt: string;
};

export type Device = {
  id: string;
  name: string;
  type: string;
  role: string;
  status: string;
  manufacturer: string | null;
  model: string | null;
  serialNo: string | null;
  assetTag: string | null;
  osVersion: string | null;
  mac: string | null;
  rackId: string | null;
  rack?: {
    id: string;
    code: string;
    location?: string | null;
    uStart?: number;
    uEnd?: number;
  } | null;
  uStart: number | null;
  uHeight: number;
  face: string;
  supplierId: string | null;
  supplier?: IdName | null;
  customerId: string | null;
  customer?: IdName | null;
  owner: string | null;
  lastInventoryAt: string | null;
  purchaseDate: string | null;
  warrantyEnd: string | null;
  notes: string | null;
  ipAddresses?: Array<{
    id: string;
    address: string;
    status: string;
    role: string;
    isPrimary: boolean;
    dnsName: string | null;
  }>;
  terminations?: Array<{
    id: string;
    side: string;
    port: string | null;
    line: { id: string; code: string; name: string };
  }>;
  _count?: Counts;
  createdAt: string;
  updatedAt: string;
};

export type LineTermination = {
  id?: string;
  lineId?: string;
  side: string;
  rackId: string | null;
  rack?: {
    id: string;
    code: string;
    uStart?: number;
    uEnd?: number;
    location?: string | null;
  } | null;
  deviceId: string | null;
  device?: IdName | null;
  port: string | null;
  description: string | null;
};

export type Line = {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
  supplierId: string | null;
  supplier?: IdName | null;
  customerId: string | null;
  customer?: IdName | null;
  bandwidthMbps: number | null;
  monthlyFeeCents: number | null;
  circuitNo: string | null;
  installDate: string | null;
  expireDate: string | null;
  description: string | null;
  terminations?: LineTermination[];
  ipAddresses?: IpAddress[];
  _count?: Counts;
  createdAt: string;
  updatedAt: string;
};

export type Broadband = {
  id: string;
  name: string;
  supplierId: string | null;
  supplier?: IdName | null;
  customerId: string | null;
  customer?: IdName | null;
  customerSummary?: string | null;
  customerNames?: string[];
  allocatedMbps?: number;
  reusePercent?: number | null;
  allocations?: Array<{
    id: string;
    customerId: string;
    customer?: IdName | null;
    allocatedMbps: number | null;
    allocatedAt: string;
    notes: string | null;
    uStart: number | null;
    uEnd: number | null;
  }>;
  bandwidthMbps: number | null;
  status: string;
  expireDate: string | null;
  account: string | null;
  password: string | null;
  installAddress: string | null;
  rackId: string | null;
  rack?: {
    id: string;
    code: string;
    uStart?: number;
    uEnd?: number;
    location?: string | null;
  } | null;
  deviceId: string | null;
  device?: IdName | null;
  lineId: string | null;
  line?: { id: string; code: string; name?: string } | null;
  ipAddressId: string | null;
  ipAddress?: { id: string; address: string } | null;
  monthlyFeeCents: number | null;
  contractNo: string | null;
  description: string | null;
  notes: string | null;
  _count?: Counts;
  createdAt: string;
  updatedAt: string;
};

export type ResourceAllocation = {
  id: string;
  customerId: string;
  customer?: IdName | null;
  resourceType: string;
  resourceName: string;
  supplierName: string | null;
  uStart: number | null;
  uEnd: number | null;
  allocatedMbps: number | null;
  activeKey: string | null;
  rackId: string | null;
  ipBlockId: string | null;
  ipAddressId: string | null;
  vlanId: string | null;
  vxlanId: string | null;
  broadbandId: string | null;
  lineId: string | null;
  deviceId: string | null;
  allocatedAt: string;
  releasedAt: string | null;
  notes: string | null;
  rack?: {
    id: string;
    code: string;
    uStart?: number;
    uEnd?: number;
    location?: string | null;
  } | null;
  ipBlock?: { id: string; cidr: string } | null;
  ipAddress?: { id: string; address: string } | null;
  vlan?: { id: string; vid: number; name: string } | null;
  vxlan?: { id: string; vni: number; name: string | null } | null;
  broadband?: { id: string; name: string } | null;
  line?: { id: string; code: string; name: string } | null;
  device?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type SystemEndpoint = {
  id?: string;
  systemId?: string;
  ipAddressId: string | null;
  ipAddress?: { id: string; address: string } | null;
  ipText: string | null;
  protocol: string;
  port: number | null;
  isPrimary: boolean;
  description: string | null;
};

export type BusinessSystem = {
  id: string;
  name: string;
  code: string | null;
  owner: string;
  department: string | null;
  environment: string;
  criticality: string;
  status: string;
  url: string | null;
  domain: string | null;
  onlineDate: string | null;
  description: string | null;
  endpoints?: SystemEndpoint[];
  _count?: Counts;
  createdAt: string;
  updatedAt: string;
};

export type CustomerTest = {
  id: string;
  seqNo: number;
  customerId: string | null;
  customer?: IdName | null;
  companyName: string;
  salesperson: string | null;
  content: string | null;
  startAt: string;
  endAt: string;
  accepted: boolean;
  converted: boolean;
  status: string | null;
  displayStatus: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type ChangeLog = {
  id: string;
  username: string;
  resource: string;
  recordId: string;
  action: string;
  summary: string;
  before: string | null;
  after: string | null;
  createdAt: string;
};

export type OptionsData = {
  suppliers: Array<{
    id: string;
    name: string;
    level: number;
    parentId: string | null;
    status: string;
  }>;
  customers: Array<{
    id: string;
    name: string;
    level: number;
    parentId: string | null;
    status: string;
  }>;
  salespeople: Array<{
    id: string;
    name: string;
    status: string;
  }>;
  racks: Array<{
    id: string;
    code: string;
    location: string | null;
    supplierId: string | null;
    customerId: string | null;
    uStart: number;
    uEnd: number;
    status: string;
  }>;
  vlans: Array<{
    id: string;
    vid: number;
    name: string;
    supplierId: string | null;
    customerId: string | null;
    status: string;
  }>;
  vxlans: Array<{
    id: string;
    vni: number;
    name: string | null;
    status: string;
    vlanId: string | null;
    supplierId: string | null;
    customerId: string | null;
  }>;
  ipBlocks: Array<{
    id: string;
    cidr: string;
    status: string;
    supplierId: string | null;
    customerId: string | null;
    vlanId: string | null;
  }>;
  ipAddresses: Array<{
    id: string;
    address: string;
    status: string;
    blockId: string | null;
    deviceId: string | null;
    lineId: string | null;
    customerId: string | null;
  }>;
  devices: Array<{
    id: string;
    name: string;
    serialNo: string | null;
    rackId: string | null;
    supplierId: string | null;
    customerId: string | null;
    status: string;
    osVersion: string | null;
  }>;
  lines: Array<{
    id: string;
    code: string;
    name: string;
    supplierId: string | null;
    customerId: string | null;
  }>;
  broadbands: Array<{
    id: string;
    name: string;
    supplierId: string | null;
    customerId: string | null;
    status: string;
  }>;
  systems: Array<{ id: string; name: string; code: string | null }>;
};

export type DashboardData = {
  counts: {
    suppliers: number;
    suppliersL1: number;
    suppliersL2: number;
    customers: number;
    customersL1: number;
    customersL2: number;
    racks: number;
    ipBlocks: number;
    ipAddresses: number;
    vlans: number;
    vxlans: number;
    broadbands: number;
    devices: number;
    lines: number;
    businessSystems: number;
    customerTests: number;
    activeAllocations: number;
  };
  ipStatus: Array<{ value: string; label: string; count: number }>;
  ipRole: Array<{ value: string; label: string; count: number }>;
  deviceStatus: Array<{ value: string; label: string; count: number }>;
  deviceType: Array<{ value: string; label: string; count: number }>;
  lineStatus: Array<{ value: string; label: string; count: number }>;
  blockUsage: BlockTreeNode[];
  rackUsage: Array<{
    id: string;
    code: string;
    location: string | null;
    uStart: number;
    uEnd: number;
    usedU: number;
    capacity: number;
    percent: number;
  }>;
  reminders: {
    linesExpiring: number;
    warrantiesExpiring: number;
    testsExpired: number;
    broadbandsExpiring: number;
  };
};

export type PublicNotificationMailConfig = {
  configured: boolean;
  from: string | null;
  fromName: string | null;
  defaultTo: string;
  storageDir: string;
  issue: string | null;
};

export type NotificationSummary = {
  id: string;
  title: string;
  recipient: string;
  cc: string | null;
  subject: string | null;
  status: string;
  fromAddress: string | null;
  sentAt: string | null;
  messageId: string | null;
  docxFilename: string | null;
  lastError: string | null;
  attemptCount: number;
  createdByName: string;
  sentByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotificationDetail = NotificationSummary & {
  contentJson: string;
  contentText: string;
  signature: string | null;
  documentDate: string;
  sentById: string | null;
  createdById: string | null;
  docxPath: string | null;
};

export type NotificationDraftInput = {
  title: string;
  recipient: string;
  cc: string | null;
  subject: string | null;
  contentJson: Record<string, unknown>;
  signature: string | null;
  documentDate: string;
};

export type ReminderData = {
  days: number;
  today: string;
  lines: Array<{
    id: string;
    code: string;
    name: string;
    expireDate: string;
    status: string;
    supplier: { name: string } | null;
    daysLeft: number | null;
  }>;
  broadbands: Array<{
    id: string;
    name: string;
    expireDate: string;
    status: string;
    supplier: { name: string } | null;
    daysLeft: number | null;
  }>;
  devices: Array<{
    id: string;
    name: string;
    manufacturer: string | null;
    model: string | null;
    warrantyEnd: string;
    status: string;
    daysLeft: number | null;
  }>;
  tests: Array<{
    id: string;
    seqNo: number;
    companyName: string;
    salesperson: string | null;
    endAt: string;
    accepted: boolean;
    daysExpired: number;
  }>;
};
