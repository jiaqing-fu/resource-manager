import { prisma } from "@/lib/db";
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
  labelOf,
} from "@/lib/enums";
import type { Option } from "@/lib/enums";
import { testStatusWhere } from "@/server/services/status";

export type ExportCell = string | number | boolean | null;
export type ExportSheets = Record<string, ExportCell[][]>;

function param(params: URLSearchParams, key: string): string | undefined {
  const v = params.get(key);
  return v === null || v === "" ? undefined : v;
}

function enumValue(options: Option[], value: string | undefined): string | undefined {
  return value && options.some((o) => o.value === value) ? value : undefined;
}

function enumLabel(options: Option[], value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  return labelOf(options, value);
}

function boolLabel(value: boolean | null | undefined): string {
  return value ? "是" : "否";
}

/** 防 Excel 公式注入：= + - @ 开头的文本加单引号。 */
function safeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function keywordWhere(
  keyword: string | undefined,
  fields: string[],
): Record<string, unknown> | null {
  if (!keyword) return null;
  return { OR: fields.map((field) => ({ [field]: { contains: keyword } })) };
}

function combine(parts: Array<Record<string, unknown> | null>): Record<string, unknown> {
  const list = parts.filter((p): p is Record<string, unknown> => p !== null);
  if (list.length === 0) return {};
  if (list.length === 1) return list[0];
  return { AND: list };
}

async function salespersonsData(params: URLSearchParams): Promise<ExportSheets> {
  const keyword = param(params, "keyword");
  const where = combine([
    keywordWhere(keyword, ["name", "phone", "notes"]),
    enumValue(PARTY_STATUS, param(params, "status"))
      ? { status: param(params, "status") }
      : null,
  ]);
  const list = await prisma.salesperson.findMany({
    where,
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  return {
    main: list.map((s) => [
      safeText(s.name),
      safeText(s.phone),
      enumLabel(PARTY_STATUS, s.status),
      safeText(s.notes),
    ]),
  };
}

async function suppliersData(params: URLSearchParams): Promise<ExportSheets> {
  const keyword = param(params, "keyword");
  const level = param(params, "level");
  const where = combine([
    keywordWhere(keyword, ["name", "contactName", "phone"]),
    level === "1" || level === "2" ? { level: Number(level) } : null,
    enumValue(PARTY_STATUS, param(params, "status"))
      ? { status: param(params, "status") }
      : null,
    enumValue(SUPPLIER_CATEGORIES, param(params, "category"))
      ? { category: param(params, "category") }
      : null,
  ]);
  const list = await prisma.supplier.findMany({
    where,
    orderBy: [{ level: "asc" }, { name: "asc" }],
    include: { parent: { select: { name: true } } },
  });
  const ids = list.map((s) => s.id);
  const contacts = ids.length
    ? await prisma.supplierContact.findMany({
        where: { supplierId: { in: ids } },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        include: { supplier: { select: { name: true, parent: { select: { name: true } } } } },
      })
    : [];

  const main = list.map((s) => [
    safeText(s.name),
    enumLabel(PARTY_LEVELS, s.level),
    safeText(s.parent?.name),
    enumLabel(SUPPLIER_CATEGORIES, s.category),
    s.asn,
    safeText(s.contactName),
    safeText(s.phone),
    safeText(s.email),
    safeText(s.address),
    enumLabel(PARTY_STATUS, s.status),
    safeText(s.notes),
  ]);
  const contactRows = contacts.map((c) => [
    safeText(c.supplier.name),
    safeText(c.supplier.parent?.name),
    safeText(c.name),
    safeText(c.role),
    safeText(c.phone),
    safeText(c.email),
    safeText(c.wechat),
    boolLabel(c.isPrimary),
    safeText(c.notes),
  ]);
  return { main, contacts: contactRows };
}

async function customersData(params: URLSearchParams): Promise<ExportSheets> {
  const level = param(params, "level");
  const keyword = param(params, "keyword");
  const where = combine([
    keyword
      ? {
          OR: [
            { name: { contains: keyword } },
            { contactName: { contains: keyword } },
            { salesperson: { is: { name: { contains: keyword } } } },
            { phone: { contains: keyword } },
          ],
        }
      : null,
    level === "1" || level === "2" ? { level: Number(level) } : null,
    enumValue(PARTY_STATUS, param(params, "status"))
      ? { status: param(params, "status") }
      : null,
    param(params, "salespersonId")
      ? { salespersonId: param(params, "salespersonId") }
      : null,
  ]);
  const list = await prisma.customer.findMany({
    where,
    orderBy: [{ level: "asc" }, { name: "asc" }],
    include: {
      parent: { select: { name: true } },
      salesperson: { select: { name: true } },
    },
  });
  return {
    main: list.map((c) => [
      safeText(c.name),
      enumLabel(PARTY_LEVELS, c.level),
      safeText(c.parent?.name),
      safeText(c.salesperson?.name),
      safeText(c.contactName),
      safeText(c.phone),
      safeText(c.email),
      safeText(c.address),
      enumLabel(PARTY_STATUS, c.status),
      safeText(c.notes),
    ]),
  };
}

async function racksData(params: URLSearchParams): Promise<ExportSheets> {
  const keyword = param(params, "keyword");
  const where: Record<string, unknown> = combine([
    keyword
      ? {
          OR: [
            { code: { contains: keyword } },
            { location: { contains: keyword } },
            { power: { contains: keyword } },
            { serial: { contains: keyword } },
            { notes: { contains: keyword } },
            { supplier: { is: { name: { contains: keyword } } } },
            {
              allocations: {
                some: {
                  releasedAt: null,
                  customer: { is: { name: { contains: keyword } } },
                },
              },
            },
          ],
        }
      : null,
    enumValue(RACK_STATUS, param(params, "status"))
      ? { status: param(params, "status") }
      : null,
    param(params, "supplierId") ? { supplierId: param(params, "supplierId") } : null,
    param(params, "customerId")
      ? { allocations: { some: { releasedAt: null, customerId: param(params, "customerId") } } }
      : null,
  ]);
  const list = await prisma.rack.findMany({
    where,
    orderBy: [{ code: "asc" }, { uStart: "asc" }],
    include: {
      supplier: { select: { name: true } },
    },
  });
  return {
    main: list.map((r) => [
      safeText(r.location),
      safeText(r.code),
      enumLabel(RACK_STATUS, r.status),
      r.width,
      r.uStart,
      r.uEnd,
      safeText(r.power),
      safeText(r.serial),
      safeText(r.supplier?.name),
      safeText(r.notes),
    ]),
  };
}

async function vlansData(params: URLSearchParams): Promise<ExportSheets> {
  const keyword = param(params, "keyword");
  const or: Record<string, unknown>[] = [];
  if (keyword) {
    or.push(
      { name: { contains: keyword } },
      { description: { contains: keyword } },
      { supplier: { is: { name: { contains: keyword } } } },
      { customer: { is: { name: { contains: keyword } } } },
    );
    if (/^\d+$/.test(keyword)) or.push({ vid: Number(keyword) });
  }
  const where = combine([
    or.length > 0 ? { OR: or } : null,
    enumValue(VLAN_STATUS, param(params, "status"))
      ? { status: param(params, "status") }
      : null,
    param(params, "supplierId") ? { supplierId: param(params, "supplierId") } : null,
    param(params, "customerId") ? { customerId: param(params, "customerId") } : null,
  ]);
  const list = await prisma.vlan.findMany({
    where,
    orderBy: { vid: "asc" },
    include: {
      supplier: { select: { name: true } },
      customer: { select: { name: true } },
    },
  });
  return {
    main: list.map((v) => [
      v.vid,
      safeText(v.name),
      enumLabel(VLAN_STATUS, v.status),
      safeText(v.supplier?.name),
      safeText(v.description),
    ]),
  };
}

async function vxlansData(params: URLSearchParams): Promise<ExportSheets> {
  const keyword = param(params, "keyword");
  const or: Record<string, unknown>[] = [];
  if (keyword) {
    or.push(
      { name: { contains: keyword } },
      { description: { contains: keyword } },
      { vlan: { is: { name: { contains: keyword } } } },
      { supplier: { is: { name: { contains: keyword } } } },
      { customer: { is: { name: { contains: keyword } } } },
    );
    if (/^\d+$/.test(keyword)) {
      or.push({ vni: Number(keyword) });
      or.push({ vlan: { is: { vid: Number(keyword) } } });
    }
  }
  const where = combine([
    or.length > 0 ? { OR: or } : null,
    enumValue(VXLAN_STATUS, param(params, "status"))
      ? { status: param(params, "status") }
      : null,
    param(params, "supplierId") ? { supplierId: param(params, "supplierId") } : null,
    param(params, "customerId") ? { customerId: param(params, "customerId") } : null,
    param(params, "vlanId") ? { vlanId: param(params, "vlanId") } : null,
  ]);
  const list = await prisma.vxlan.findMany({
    where,
    orderBy: { vni: "asc" },
    include: {
      vlan: { select: { vid: true } },
      supplier: { select: { name: true } },
      customer: { select: { name: true } },
    },
  });
  return {
    main: list.map((v) => [
      v.vni,
      safeText(v.name),
      enumLabel(VXLAN_STATUS, v.status),
      v.vlan?.vid ?? null,
      safeText(v.supplier?.name),
      safeText(v.description),
    ]),
  };
}

async function ipBlocksData(params: URLSearchParams): Promise<ExportSheets> {
  const keyword = param(params, "keyword");
  const or: Record<string, unknown>[] = [];
  if (keyword) {
    or.push(
      { cidr: { contains: keyword } },
      { description: { contains: keyword } },
      { gateway: { contains: keyword } },
      { supplier: { is: { name: { contains: keyword } } } },
      { customer: { is: { name: { contains: keyword } } } },
      { vlan: { is: { name: { contains: keyword } } } },
    );
    if (/^\d+$/.test(keyword)) or.push({ vlan: { is: { vid: Number(keyword) } } });
  }
  const where = combine([
    or.length > 0 ? { OR: or } : null,
    enumValue(IP_BLOCK_STATUS, param(params, "status"))
      ? { status: param(params, "status") }
      : null,
    enumValue(IP_BLOCK_ROLES, param(params, "role")) ? { role: param(params, "role") } : null,
    param(params, "parentId") ? { parentId: param(params, "parentId") } : null,
    param(params, "supplierId") ? { supplierId: param(params, "supplierId") } : null,
    param(params, "customerId") ? { customerId: param(params, "customerId") } : null,
    param(params, "vlanId") ? { vlanId: param(params, "vlanId") } : null,
  ]);
  const list = await prisma.ipBlock.findMany({
    where,
    orderBy: { cidr: "asc" },
    include: {
      parent: { select: { cidr: true } },
      vlan: { select: { vid: true } },
      supplier: { select: { name: true } },
      customer: { select: { name: true } },
    },
  });
  return {
    main: list.map((b) => [
      safeText(b.cidr),
      enumLabel(IP_BLOCK_STATUS, b.status),
      enumLabel(IP_BLOCK_ROLES, b.role),
      safeText(b.parent?.cidr),
      b.vlan?.vid ?? null,
      safeText(b.supplier?.name),
      safeText(b.gateway),
      safeText(b.description),
      b.assignedAt,
    ]),
  };
}

async function ipAddressesData(params: URLSearchParams): Promise<ExportSheets> {
  const keyword = param(params, "keyword");
  const where = combine([
    keyword
      ? {
          OR: [
            { address: { contains: keyword } },
            { dnsName: { contains: keyword } },
            { description: { contains: keyword } },
            { block: { is: { cidr: { contains: keyword } } } },
            { supplier: { is: { name: { contains: keyword } } } },
            { customer: { is: { name: { contains: keyword } } } },
            { rack: { is: { code: { contains: keyword } } } },
            { device: { is: { name: { contains: keyword } } } },
            { line: { is: { code: { contains: keyword } } } },
          ],
        }
      : null,
    enumValue(IP_ADDRESS_STATUS, param(params, "status"))
      ? { status: param(params, "status") }
      : null,
    enumValue(IP_ADDRESS_ROLES, param(params, "role")) ? { role: param(params, "role") } : null,
    param(params, "blockId") ? { blockId: param(params, "blockId") } : null,
    param(params, "deviceId") ? { deviceId: param(params, "deviceId") } : null,
    param(params, "lineId") ? { lineId: param(params, "lineId") } : null,
    param(params, "supplierId") ? { supplierId: param(params, "supplierId") } : null,
    param(params, "customerId") ? { customerId: param(params, "customerId") } : null,
    param(params, "rackId") ? { rackId: param(params, "rackId") } : null,
  ]);
  const list = await prisma.ipAddress.findMany({
    where,
    orderBy: { address: "asc" },
    include: {
      block: { select: { cidr: true } },
      supplier: { select: { name: true } },
      customer: { select: { name: true } },
      rack: { select: { code: true } },
      device: { select: { name: true } },
      line: { select: { code: true } },
    },
  });
  return {
    main: list.map((ip) => [
      safeText(ip.address),
      safeText(ip.block?.cidr),
      enumLabel(IP_ADDRESS_STATUS, ip.status),
      enumLabel(IP_ADDRESS_ROLES, ip.role),
      safeText(ip.supplier?.name),
      safeText(ip.rack?.code),
      safeText(ip.device?.name),
      safeText(ip.line?.code),
      boolLabel(ip.isPrimary),
      safeText(ip.dnsName),
      safeText(ip.description),
      ip.assignedAt,
    ]),
  };
}

async function devicesData(params: URLSearchParams): Promise<ExportSheets> {
  const keyword = param(params, "keyword");
  const where = combine([
    keyword
      ? {
          OR: [
            { name: { contains: keyword } },
            { serialNo: { contains: keyword } },
            { model: { contains: keyword } },
            { assetTag: { contains: keyword } },
            { mac: { contains: keyword } },
            { manufacturer: { contains: keyword } },
            { osVersion: { contains: keyword } },
            { owner: { contains: keyword } },
            { notes: { contains: keyword } },
            { rack: { is: { code: { contains: keyword } } } },
            { rack: { is: { location: { contains: keyword } } } },
            { supplier: { is: { name: { contains: keyword } } } },
            { customer: { is: { name: { contains: keyword } } } },
          ],
        }
      : null,
    enumValue(DEVICE_TYPES, param(params, "type")) ? { type: param(params, "type") } : null,
    enumValue(DEVICE_ROLES, param(params, "role")) ? { role: param(params, "role") } : null,
    enumValue(DEVICE_STATUS, param(params, "status"))
      ? { status: param(params, "status") }
      : null,
    param(params, "rackId") ? { rackId: param(params, "rackId") } : null,
    param(params, "supplierId") ? { supplierId: param(params, "supplierId") } : null,
    param(params, "customerId") ? { customerId: param(params, "customerId") } : null,
    param(params, "warrantyBefore")
      ? { warrantyEnd: { not: null, lte: param(params, "warrantyBefore") } }
      : null,
  ]);
  const list = await prisma.device.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      rack: { select: { code: true } },
      supplier: { select: { name: true } },
      customer: { select: { name: true } },
      ipAddresses: { where: { isPrimary: true }, take: 1, select: { address: true } },
    },
  });
  return {
    main: list.map((d) => [
      safeText(d.name),
      enumLabel(DEVICE_TYPES, d.type),
      enumLabel(DEVICE_ROLES, d.role),
      enumLabel(DEVICE_STATUS, d.status),
      safeText(d.manufacturer),
      safeText(d.model),
      safeText(d.serialNo),
      safeText(d.assetTag),
      safeText(d.osVersion),
      safeText(d.mac),
      safeText(d.rack?.code),
      d.uStart,
      d.uHeight,
      enumLabel(DEVICE_FACES, d.face),
      safeText(d.supplier?.name),
      safeText(d.owner),
      d.lastInventoryAt,
      d.purchaseDate,
      d.warrantyEnd,
      safeText(d.ipAddresses[0]?.address),
      safeText(d.notes),
    ]),
  };
}

async function linesData(params: URLSearchParams): Promise<ExportSheets> {
  const keyword = param(params, "keyword");
  const where = combine([
    keyword
      ? {
          OR: [
            { code: { contains: keyword } },
            { name: { contains: keyword } },
            { circuitNo: { contains: keyword } },
            { description: { contains: keyword } },
            { supplier: { is: { name: { contains: keyword } } } },
            { customer: { is: { name: { contains: keyword } } } },
            { terminations: { some: { rack: { is: { code: { contains: keyword } } } } } },
            { terminations: { some: { rack: { is: { location: { contains: keyword } } } } } },
            { terminations: { some: { device: { is: { name: { contains: keyword } } } } } },
          ],
        }
      : null,
    enumValue(LINE_TYPES, param(params, "type")) ? { type: param(params, "type") } : null,
    enumValue(LINE_STATUS, param(params, "status"))
      ? { status: param(params, "status") }
      : null,
    param(params, "supplierId") ? { supplierId: param(params, "supplierId") } : null,
    param(params, "customerId") ? { customerId: param(params, "customerId") } : null,
    param(params, "expireBefore")
      ? { expireDate: { not: null, lte: param(params, "expireBefore") } }
      : null,
  ]);
  const list = await prisma.line.findMany({
    where,
    orderBy: { code: "asc" },
    include: {
      supplier: { select: { name: true } },
      customer: { select: { name: true } },
      terminations: {
        orderBy: { side: "asc" },
        include: {
          rack: { select: { code: true } },
          device: { select: { name: true } },
        },
      },
    },
  });
  const main = list.map((l) => [
    safeText(l.code),
    safeText(l.name),
    enumLabel(LINE_TYPES, l.type),
    enumLabel(LINE_STATUS, l.status),
    safeText(l.supplier?.name),
    l.bandwidthMbps,
    l.monthlyFeeCents === null ? null : Math.round(l.monthlyFeeCents) / 100,
    safeText(l.circuitNo),
    l.installDate,
    l.expireDate,
    safeText(l.description),
  ]);
  const terminations = list.flatMap((l) =>
    l.terminations.map((t) => [
      safeText(l.code),
      enumLabel(LINE_SIDES, t.side),
      safeText(t.rack?.code),
      safeText(t.device?.name),
      safeText(t.port),
      safeText(t.description),
    ]),
  );
  return { main, terminations };
}

async function broadbandsData(params: URLSearchParams): Promise<ExportSheets> {
  const keyword = param(params, "keyword");
  const where = combine([
    keyword
      ? {
          OR: [
            { name: { contains: keyword } },
            { account: { contains: keyword } },
            { installAddress: { contains: keyword } },
            { contractNo: { contains: keyword } },
            { description: { contains: keyword } },
            { notes: { contains: keyword } },
            { supplier: { is: { name: { contains: keyword } } } },
            { customer: { is: { name: { contains: keyword } } } },
            { rack: { is: { code: { contains: keyword } } } },
            { device: { is: { name: { contains: keyword } } } },
            { line: { is: { code: { contains: keyword } } } },
            { ipAddress: { is: { address: { contains: keyword } } } },
          ],
        }
      : null,
    enumValue(BROADBAND_STATUS, param(params, "status"))
      ? { status: param(params, "status") }
      : null,
    param(params, "supplierId") ? { supplierId: param(params, "supplierId") } : null,
    param(params, "customerId") ? { customerId: param(params, "customerId") } : null,
    param(params, "rackId") ? { rackId: param(params, "rackId") } : null,
    param(params, "deviceId") ? { deviceId: param(params, "deviceId") } : null,
    param(params, "lineId") ? { lineId: param(params, "lineId") } : null,
    param(params, "expireBefore")
      ? { expireDate: { not: null, lte: param(params, "expireBefore") } }
      : null,
    param(params, "expireAfter")
      ? { expireDate: { not: null, gte: param(params, "expireAfter") } }
      : null,
  ]);
  const list = await prisma.broadband.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      supplier: { select: { name: true } },
      customer: { select: { name: true } },
      rack: { select: { code: true } },
      device: { select: { name: true } },
      line: { select: { code: true } },
      ipAddress: { select: { address: true } },
    },
  });
  return {
    main: list.map((b) => [
      safeText(b.name),
      safeText(b.supplier?.name),
      b.bandwidthMbps,
      enumLabel(BROADBAND_STATUS, b.status),
      b.expireDate,
      safeText(b.account),
      safeText(b.password),
      safeText(b.installAddress),
      safeText(b.rack?.code),
      safeText(b.device?.name),
      safeText(b.line?.code),
      safeText(b.ipAddress?.address),
      b.monthlyFeeCents === null ? null : Math.round(b.monthlyFeeCents) / 100,
      safeText(b.contractNo),
      safeText(b.description),
      safeText(b.notes),
    ]),
  };
}

async function systemsData(params: URLSearchParams): Promise<ExportSheets> {
  const where = combine([
    keywordWhere(param(params, "keyword"), ["name", "code", "owner", "domain"]),
    enumValue(ENVIRONMENTS, param(params, "environment"))
      ? { environment: param(params, "environment") }
      : null,
    enumValue(CRITICALITIES, param(params, "criticality"))
      ? { criticality: param(params, "criticality") }
      : null,
    enumValue(SYSTEM_STATUS, param(params, "status"))
      ? { status: param(params, "status") }
      : null,
  ]);
  const list = await prisma.businessSystem.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      endpoints: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        include: { ipAddress: { select: { address: true } } },
      },
    },
  });
  const main = list.map((s) => [
    safeText(s.name),
    safeText(s.code),
    safeText(s.owner),
    safeText(s.department),
    enumLabel(ENVIRONMENTS, s.environment),
    enumLabel(CRITICALITIES, s.criticality),
    enumLabel(SYSTEM_STATUS, s.status),
    safeText(s.url),
    safeText(s.domain),
    s.onlineDate,
    safeText(s.description),
  ]);
  const endpoints = list.flatMap((s) =>
    s.endpoints.map((e) => [
      safeText(s.name),
      safeText(e.ipAddress?.address ?? e.ipText),
      e.port,
      enumLabel(PROTOCOLS, e.protocol),
      boolLabel(e.isPrimary),
      safeText(e.description),
    ]),
  );
  return { main, endpoints };
}

async function customerTestsData(params: URLSearchParams): Promise<ExportSheets> {
  const and: Record<string, unknown>[] = [];
  const keyword = param(params, "keyword");
  if (keyword) {
    and.push({
      OR: [
        { companyName: { contains: keyword } },
        { salesperson: { contains: keyword } },
        { content: { contains: keyword } },
        { notes: { contains: keyword } },
        { customer: { is: { name: { contains: keyword } } } },
        ...(/^\d+$/.test(keyword) ? [{ seqNo: Number(keyword) }] : []),
      ],
    });
  }
  const status = param(params, "status");
  if (status) and.push(testStatusWhere(status));
  const customerId = param(params, "customerId");
  if (customerId) and.push({ customerId });
  const salesperson = param(params, "salesperson");
  if (salesperson) and.push({ salesperson: { contains: salesperson } });
  const accepted = param(params, "accepted");
  if (accepted === "true" || accepted === "false") {
    and.push({ accepted: accepted === "true" });
  }
  const converted = param(params, "converted");
  if (converted === "true" || converted === "false") {
    and.push({ converted: converted === "true" });
  }
  const endFrom = param(params, "endFrom");
  const endTo = param(params, "endTo");
  if (endFrom || endTo) {
    and.push({
      endAt: {
        ...(endFrom ? { gte: endFrom } : {}),
        ...(endTo ? { lte: endTo } : {}),
      },
    });
  }
  const list = await prisma.customerTest.findMany({
    where: and.length > 0 ? { AND: and } : {},
    orderBy: [{ endAt: "desc" }, { seqNo: "desc" }],
    include: { customer: { select: { name: true } } },
  });
  return {
    main: list.map((t) => [
      t.seqNo,
      safeText(t.companyName),
      safeText(t.customer?.name),
      safeText(t.salesperson),
      safeText(t.content),
      t.startAt,
      t.endAt,
      boolLabel(t.accepted),
      boolLabel(t.converted),
      enumLabel(TEST_STATUS, t.status),
      safeText(t.notes),
    ]),
  };
}

export async function buildExportData(
  moduleKey: string,
  params: URLSearchParams,
): Promise<ExportSheets> {
  switch (moduleKey) {
    case "salespersons":
      return salespersonsData(params);
    case "suppliers":
      return suppliersData(params);
    case "customers":
      return customersData(params);
    case "racks":
      return racksData(params);
    case "vlans":
      return vlansData(params);
    case "vxlans":
      return vxlansData(params);
    case "ip-blocks":
      return ipBlocksData(params);
    case "ip-addresses":
      return ipAddressesData(params);
    case "devices":
      return devicesData(params);
    case "lines":
      return linesData(params);
    case "broadbands":
      return broadbandsData(params);
    case "business-systems":
      return systemsData(params);
    case "customer-tests":
      return customerTestsData(params);
    default:
      throw new Error(`unknown export module: ${moduleKey}`);
  }
}
