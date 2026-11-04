import { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { parseBlockSpec, parseIp } from "@/lib/ip";
import { writeChangeLog } from "@/lib/changelog";
import { VXLAN_VNI_MAX, VXLAN_VNI_MIN } from "@/lib/vxlan-schema";
import type { ParsedRow, ParsedWorkbook, ImportCellError } from "@/lib/excel/parse";
import type { ModuleSpec, SheetSpec } from "@/lib/excel/specs";
import {
  recomputeBlockParents,
  recomputeIpCustomersForSpan,
  syncRangeAddresses,
  validateAddressInput,
  validateBlockInput,
} from "./ipam";
import {
  validateDevicePlacement,
  validateRackSegment,
  validateTerminations,
} from "./inventory";
import { validateEndpoints } from "./service-endpoints";
import { assertSupplierConsistent } from "./supplier-requirements";

type Tx = Prisma.TransactionClient;

const MAX_ERRORS = 500;

export class ImportValidationError extends Error {
  errors: ImportCellError[];

  constructor(errors: ImportCellError[]) {
    super(`导入校验失败，共 ${errors.length} 处错误`);
    this.name = "ImportValidationError";
    this.errors = errors;
  }
}

class DryRunRollback extends Error {
  summary: ImportSummary;
  constructor(summary: ImportSummary) {
    super("dry-run rollback");
    this.name = "DryRunRollback";
    this.summary = summary;
  }
}

export type SheetImportSummary = {
  sheet: string;
  rows: number;
  created: number;
  updated: number;
};

export type ImportSummary = {
  module: string;
  label: string;
  totalRows: number;
  created: number;
  updated: number;
  sheets: SheetImportSummary[];
};

type SupplierLite = { id: string; name: string; level: number; parentId: string | null };
type CustomerLite = SupplierLite;
type SalespersonLite = { id: string; name: string };
type RackLite = {
  id: string;
  code: string;
  supplierId: string | null;
  uStart: number;
  uEnd: number;
};
type VlanLite = {
  id: string;
  vid: number;
  name: string;
  supplierId: string | null;
};
type VxlanLite = {
  id: string;
  vni: number;
  vlanId: string | null;
  supplierId: string | null;
};
type BlockLite = { id: string; cidr: string; status: string; supplierId: string | null };
type IpLite = { id: string; address: string; supplierId: string | null };
type DeviceLite = {
  id: string;
  name: string;
  serialNo: string | null;
  rackId: string | null;
  supplierId: string | null;
};
type LineLite = { id: string; code: string; supplierId: string | null };
type BroadbandLite = { id: string; name: string; supplierId: string | null };
type SystemLite = { id: string; name: string; code: string | null };

type SupplierRef = { id: string; supplierId: string | null };

type Cache = {
  suppliers: Map<string, SupplierLite[]>;
  customers: Map<string, CustomerLite[]>;
  salespeople: Map<string, SalespersonLite>;
  racks: Map<string, RackLite[]>;
  vlans: Map<string, VlanLite>;
  vxlansByVni: Map<number, VxlanLite>;
  vxlanByVlanId: Map<string, VxlanLite>;
  blocks: Map<string, BlockLite>;
  ips: Map<string, IpLite>;
  devicesByName: Map<string, DeviceLite[]>;
  devicesBySerial: Map<string, DeviceLite>;
  lines: Map<string, LineLite>;
  broadbands: Map<string, BroadbandLite>;
  systemsByName: Map<string, SystemLite[]>;
  systemsByCode: Map<string, SystemLite>;
};

type Ctx = {
  tx: Tx;
  user: SessionUser;
  errors: ImportCellError[];
  summary: Map<string, SheetImportSummary>;
  cache: Cache;
};

function pushToGroup<T>(map: Map<string, T[]>, key: string, item: T) {
  const list = map.get(key);
  if (list) list.push(item);
  else map.set(key, [item]);
}

async function loadCache(tx: Tx): Promise<Cache> {
  const [
    suppliers,
    customers,
    salespeople,
    racks,
    vlans,
    vxlans,
    blocks,
    ips,
    devices,
    lines,
    broadbands,
    systems,
  ] = await Promise.all([
    tx.supplier.findMany({ select: { id: true, name: true, level: true, parentId: true } }),
    tx.customer.findMany({ select: { id: true, name: true, level: true, parentId: true } }),
    tx.salesperson.findMany({ select: { id: true, name: true } }),
    tx.rack.findMany({
      select: { id: true, code: true, supplierId: true, uStart: true, uEnd: true },
    }),
    tx.vlan.findMany({ select: { id: true, vid: true, name: true, supplierId: true } }),
    tx.vxlan.findMany({ select: { id: true, vni: true, vlanId: true, supplierId: true } }),
    tx.ipBlock.findMany({ select: { id: true, cidr: true, status: true, supplierId: true } }),
    tx.ipAddress.findMany({ select: { id: true, address: true, supplierId: true } }),
    tx.device.findMany({
      select: { id: true, name: true, serialNo: true, rackId: true, supplierId: true },
    }),
    tx.line.findMany({ select: { id: true, code: true, supplierId: true } }),
    tx.broadband.findMany({ select: { id: true, name: true, supplierId: true } }),
    tx.businessSystem.findMany({ select: { id: true, name: true, code: true } }),
  ]);

  const cache: Cache = {
    suppliers: new Map(),
    customers: new Map(),
    salespeople: new Map(salespeople.map((s) => [s.name, s])),
    racks: new Map(),
    vlans: new Map(vlans.map((v) => [`${v.supplierId ?? ""}|${v.vid}`, v])),
    vxlansByVni: new Map(vxlans.map((v) => [v.vni, v])),
    vxlanByVlanId: new Map(
      vxlans.filter((v) => v.vlanId).map((v) => [v.vlanId as string, v]),
    ),
    blocks: new Map(
      blocks.map((b) => [parseBlockSpec(b.cidr)?.canonical ?? b.cidr, b]),
    ),
    ips: new Map(ips.map((ip) => [ip.address, ip])),
    devicesByName: new Map(),
    devicesBySerial: new Map(),
    lines: new Map(lines.map((l) => [l.code, l])),
    broadbands: new Map(broadbands.map((b) => [b.name, b])),
    systemsByName: new Map(),
    systemsByCode: new Map(),
  };
  for (const s of suppliers) pushToGroup(cache.suppliers, s.name, s);
  for (const c of customers) pushToGroup(cache.customers, c.name, c);
  for (const r of racks) pushToGroup(cache.racks, r.code, r);
  for (const d of devices) {
    pushToGroup(cache.devicesByName, d.name, d);
    if (d.serialNo) cache.devicesBySerial.set(d.serialNo, d);
  }
  for (const s of systems) {
    pushToGroup(cache.systemsByName, s.name, s);
    if (s.code) cache.systemsByCode.set(s.code, s);
  }
  return cache;
}

function text(row: ParsedRow, key: string): string | null {
  const v = row.values[key];
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

function int(row: ParsedRow, key: string): number | null {
  const v = row.values[key];
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

function bool(row: ParsedRow, key: string, fallback = false): boolean {
  const v = row.values[key];
  return typeof v === "boolean" ? v : fallback;
}

function levelOf(row: ParsedRow): number | null {
  const v = text(row, "level");
  if (v === "1") return 1;
  if (v === "2") return 2;
  return null;
}

function addError(
  ctx: Ctx,
  row: ParsedRow,
  column: string,
  message: string,
  value?: string,
) {
  if (ctx.errors.length >= MAX_ERRORS) return;
  ctx.errors.push({
    sheet: row.sheetName,
    row: row.rowNumber,
    column,
    message,
    value: value ?? "",
  });
}

function recordApiError(ctx: Ctx, row: ParsedRow, column: string, error: unknown): void {
  if (error instanceof ApiError) {
    addError(ctx, row, column, error.message);
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = Array.isArray(error.meta?.target)
        ? (error.meta?.target as string[]).join("、")
        : String(error.meta?.target ?? "唯一字段");
      addError(ctx, row, column, `唯一性冲突：${target} 已存在`);
      return;
    }
    if (error.code === "P2003" || error.code === "P2014") {
      addError(ctx, row, column, "该记录仍被其他数据引用，无法写入或修改");
      return;
    }
  }
  throw error;
}

function countRow(ctx: Ctx, sheetKey: string, outcome: "created" | "updated" | "written") {
  const s = ctx.summary.get(sheetKey);
  if (!s) return;
  s.rows++;
  if (outcome === "created" || outcome === "written") s.created++;
  else s.updated++;
}

function countWritten(ctx: Ctx, sheetKey: string, count: number) {
  const s = ctx.summary.get(sheetKey);
  if (!s) return;
  s.rows += count;
  s.created += count;
}

function resolveSupplier(
  ctx: Ctx,
  name: string | null,
  filter?: { level?: number; parentId?: string | null },
): SupplierLite | null {
  if (!name) return null;
  let list = ctx.cache.suppliers.get(name) ?? [];
  if (filter?.level !== undefined) list = list.filter((s) => s.level === filter.level);
  if (filter?.parentId !== undefined) list = list.filter((s) => s.parentId === filter.parentId);
  if (list.length === 0) {
    throw new ApiError(
      422,
      filter?.level === 1
        ? `一级供应商「${name}」不存在`
        : `供应商「${name}」不存在`,
      "SUPPLIER_NOT_FOUND",
    );
  }
  if (list.length > 1) {
    throw new ApiError(
      422,
      `供应商名称「${name}」对应多条记录，无法唯一匹配，请先调整名称`,
      "AMBIGUOUS_SUPPLIER",
    );
  }
  return list[0];
}

/**
 * 导入时的最终供应商：
 * 1. 显式填写优先；
 * 2. 否则取第一个可用的继承值（父段、VLAN、机柜、设备、线路等）；
 * 3. 更新已有记录时若都为空，保留原值（历史空值仍可保持为空）；
 * 4. 新建记录仍为空则报错“供应商必填”。
 */
function resolveImportedSupplier(
  ctx: Ctx,
  explicitName: string | null,
  inherited: Array<SupplierRef | null | undefined>,
  existingSupplierId: string | null | undefined,
  hint: string,
): string | null {
  if (explicitName) {
    const supplier = resolveSupplier(ctx, explicitName);
    return supplier!.id;
  }
  const inheritedSupplier = inherited.find((s): s is SupplierRef => Boolean(s));
  if (inheritedSupplier) return inheritedSupplier.supplierId;
  if (existingSupplierId !== undefined) return existingSupplierId;
  throw new ApiError(
    422,
    hint
      ? `供应商必填（可直接填写，或填写${hint}以继承）`
      : "供应商必填（资源创建必须关联供应商）",
    "SUPPLIER_REQUIRED",
  );
}

function resolveCustomer(
  ctx: Ctx,
  name: string | null,
  filter?: { level?: number; parentId?: string | null },
): CustomerLite | null {
  if (!name) return null;
  let list = ctx.cache.customers.get(name) ?? [];
  if (filter?.level !== undefined) list = list.filter((s) => s.level === filter.level);
  if (filter?.parentId !== undefined) list = list.filter((s) => s.parentId === filter.parentId);
  if (list.length === 0) {
    throw new ApiError(
      422,
      filter?.level === 1 ? `一级客户「${name}」不存在` : `客户「${name}」不存在`,
      "CUSTOMER_NOT_FOUND",
    );
  }
  if (list.length > 1) {
    throw new ApiError(
      422,
      `客户名称「${name}」对应多条记录，无法唯一匹配，请先调整名称`,
      "AMBIGUOUS_CUSTOMER",
    );
  }
  return list[0];
}

function resolveSalesperson(ctx: Ctx, name: string | null): SalespersonLite | null {
  if (!name) return null;
  const salesperson = ctx.cache.salespeople.get(name);
  if (!salesperson) {
    throw new ApiError(
      422,
      `业务员「${name}」不存在，请先在业务员管理中创建`,
      "SALESPERSON_NOT_FOUND",
    );
  }
  return salesperson;
}

/**
 * 按编号解析机柜区间。同一编号有多条区间记录时：
 * - 设备行提供了起始 U 位，则匹配唯一包含该 U 位的区间；
 * - 其他模块没有 U 位信息，无法唯一匹配，直接报错。
 */
function resolveRack(
  ctx: Ctx,
  code: string | null,
  uStart?: number | null,
): RackLite | null {
  if (!code) return null;
  const list = ctx.cache.racks.get(code) ?? [];
  if (list.length === 0) {
    throw new ApiError(422, `机柜「${code}」不存在`, "RACK_NOT_FOUND");
  }
  if (list.length === 1) return list[0];
  if (uStart === null || uStart === undefined) {
    throw new ApiError(
      422,
      `机柜「${code}」对应多个 U 区间，无法唯一匹配；请在设备行填写起始 U 位`,
      "AMBIGUOUS_RACK",
    );
  }
  const matched = list.filter((rack) => uStart >= rack.uStart && uStart <= rack.uEnd);
  if (matched.length === 1) return matched[0];
  throw new ApiError(
    422,
    `起始 U 位 ${uStart} 不落在机柜「${code}」的任何区间内`,
    "RACK_RANGE_NOT_FOUND",
  );
}

function resolveVlan(
  ctx: Ctx,
  supplierId: string | null,
  vid: number | null,
): VlanLite | null {
  if (vid === null) return null;
  if (supplierId) {
    const vlan = ctx.cache.vlans.get(`${supplierId}|${vid}`);
    if (!vlan) {
      throw new ApiError(422, `该供应商下不存在 VLAN ID ${vid}`, "VLAN_NOT_FOUND");
    }
    return vlan;
  }
  const values = Array.from(ctx.cache.vlans.values()).filter((v) => v.vid === vid);
  if (values.length === 0) {
    throw new ApiError(422, `VLAN ID ${vid} 不存在`, "VLAN_NOT_FOUND");
  }
  if (values.length > 1) {
    throw new ApiError(
      422,
      `VLAN ID ${vid} 在多个供应商下存在，请同时填写供应商`,
      "AMBIGUOUS_VLAN",
    );
  }
  return values[0];
}

function resolveBlock(ctx: Ctx, cidrText: string | null): BlockLite | null {
  if (!cidrText) return null;
  const parsed = parseBlockSpec(cidrText);
  if (!parsed) {
    throw new ApiError(
      422,
      `IP 段「${cidrText}」不是合法 CIDR 或 IP 区间`,
      "INVALID_BLOCK",
    );
  }
  const block = ctx.cache.blocks.get(parsed.canonical);
  if (!block) {
    throw new ApiError(
      422,
      `IP 段 ${parsed.canonical} 不存在，请先导入 IP 段`,
      "BLOCK_NOT_FOUND",
    );
  }
  return block;
}

function resolveIp(ctx: Ctx, address: string | null): IpLite | null {
  if (!address) return null;
  const parsed = parseIp(address);
  if (!parsed) {
    throw new ApiError(422, `IP 地址「${address}」格式不正确`, "INVALID_IP");
  }
  const ip = ctx.cache.ips.get(parsed.canonical);
  if (!ip) {
    throw new ApiError(
      422,
      `IP 地址 ${parsed.canonical} 不存在，请先导入 IP 地址`,
      "IP_NOT_FOUND",
    );
  }
  return ip;
}

function resolveDevice(ctx: Ctx, name: string | null): DeviceLite | null {
  if (!name) return null;
  const list = ctx.cache.devicesByName.get(name) ?? [];
  if (list.length === 0) {
    throw new ApiError(422, `设备「${name}」不存在`, "DEVICE_NOT_FOUND");
  }
  if (list.length > 1) {
    throw new ApiError(
      422,
      `设备名称「${name}」对应多台设备，无法唯一匹配`,
      "AMBIGUOUS_DEVICE",
    );
  }
  return list[0];
}

function resolveLine(ctx: Ctx, code: string | null): LineLite | null {
  if (!code) return null;
  const line = ctx.cache.lines.get(code);
  if (!line) {
    throw new ApiError(422, `线路「${code}」不存在`, "LINE_NOT_FOUND");
  }
  return line;
}

function resolveSystem(ctx: Ctx, name: string | null): SystemLite | null {
  if (!name) return null;
  const list = ctx.cache.systemsByName.get(name) ?? [];
  if (list.length === 0) {
    throw new ApiError(422, `业务系统「${name}」不存在`, "SYSTEM_NOT_FOUND");
  }
  if (list.length > 1) {
    throw new ApiError(
      422,
      `业务系统名称「${name}」对应多条记录，无法唯一匹配`,
      "AMBIGUOUS_SYSTEM",
    );
  }
  return list[0];
}

/* ---------------------------------- 业务员 --------------------------------- */

async function importSalespersons(ctx: Ctx, parsed: ParsedWorkbook): Promise<void> {
  for (const row of parsed.sheets.main ?? []) {
    const name = text(row, "name")?.trim();
    if (!name) continue;
    try {
      if (name.length > 100) {
        addError(ctx, row, "姓名", "姓名不能超过 100 个字符", name);
        continue;
      }
      const phone = text(row, "phone")?.trim() || null;
      const notes = text(row, "notes")?.trim() || null;
      if (phone && phone.length > 50) {
        addError(ctx, row, "电话", "电话不能超过 50 个字符", phone);
        continue;
      }
      if (notes && notes.length > 1000) {
        addError(ctx, row, "备注", "备注不能超过 1000 个字符", notes);
        continue;
      }
      const data = {
        name,
        phone,
        status: text(row, "status") ?? "active",
        notes,
      };
      const existing = ctx.cache.salespeople.get(name);
      if (existing) {
        await ctx.tx.salesperson.update({ where: { id: existing.id }, data });
        countRow(ctx, "main", "updated");
      } else {
        const created = await ctx.tx.salesperson.create({ data });
        ctx.cache.salespeople.set(name, { id: created.id, name });
        countRow(ctx, "main", "created");
      }
    } catch (error) {
      recordApiError(ctx, row, "业务员", error);
    }
  }
}

/* ---------------------------------- 供应商 --------------------------------- */

async function importSuppliers(ctx: Ctx, parsed: ParsedWorkbook): Promise<void> {
  for (const row of parsed.sheets.main ?? []) {
    const name = text(row, "name");
    const level = levelOf(row);
    if (!name || level === null) continue;
    try {
      const parentName = text(row, "parentName");
      if (level === 1 && parentName) {
        addError(ctx, row, "上级供应商（二级填写）", "一级供应商不能填写上级供应商", parentName);
        continue;
      }
      let parentId: string | null = null;
      if (level === 2) {
        if (!parentName) {
          addError(ctx, row, "上级供应商（二级填写）", "二级供应商必须填写上级一级供应商");
          continue;
        }
        const parent = resolveSupplier(ctx, parentName, { level: 1 });
        if (!parent) continue;
        parentId = parent.id;
      }
      const existing = (ctx.cache.suppliers.get(name) ?? []).find(
        (s) => s.level === level && s.parentId === parentId,
      );
      const data = {
        name,
        level,
        parentId,
        category: text(row, "category") ?? "other",
        asn: int(row, "asn"),
        contactName: text(row, "contactName"),
        phone: text(row, "phone"),
        email: text(row, "email"),
        address: text(row, "address"),
        status: text(row, "status") ?? "active",
        notes: text(row, "notes"),
      };
      if (existing) {
        await ctx.tx.supplier.update({ where: { id: existing.id }, data });
        countRow(ctx, "main", "updated");
      } else {
        const created = await ctx.tx.supplier.create({ data });
        pushToGroup(ctx.cache.suppliers, name, {
          id: created.id,
          name,
          level,
          parentId,
        });
        countRow(ctx, "main", "created");
      }
    } catch (error) {
      recordApiError(ctx, row, "供应商", error);
    }
  }

  const groups = new Map<string, ParsedRow[]>();
  for (const row of parsed.sheets.contacts ?? []) {
    const name = text(row, "supplierName");
    if (!name) continue;
    const key = `${text(row, "supplierParentName") ?? ""}\u0000${name}`;
    pushToGroup(groups, key, row);
  }
  for (const rows of groups.values()) {
    const first = rows[0];
    try {
      const name = text(first, "supplierName");
      const parentName = text(first, "supplierParentName");
      let parentId: string | null | undefined;
      if (parentName) {
        const parent = resolveSupplier(ctx, parentName, { level: 1 });
        if (!parent) continue;
        parentId = parent.id;
      }
      const supplier = resolveSupplier(ctx, name, { parentId });
      if (!supplier) continue;
      if (rows.filter((r) => bool(r, "isPrimary")).length > 1) {
        addError(ctx, first, "主要联系人", "同一供应商只能设置一个主要联系人");
        continue;
      }
      await ctx.tx.supplierContact.deleteMany({ where: { supplierId: supplier.id } });
      if (rows.length > 0) {
        await ctx.tx.supplierContact.createMany({
          data: rows.map((r) => ({
            supplierId: supplier.id,
            name: text(r, "name") ?? "",
            role: text(r, "role"),
            phone: text(r, "phone"),
            email: text(r, "email"),
            wechat: text(r, "wechat"),
            isPrimary: bool(r, "isPrimary"),
            notes: text(r, "notes"),
          })),
        });
      }
      countWritten(ctx, "contacts", rows.length);
    } catch (error) {
      recordApiError(ctx, first, "联系方式", error);
    }
  }
}

/* ----------------------------------- 客户 ---------------------------------- */

async function importCustomers(ctx: Ctx, parsed: ParsedWorkbook): Promise<void> {
  for (const row of parsed.sheets.main ?? []) {
    const name = text(row, "name");
    const level = levelOf(row);
    if (!name || level === null) continue;
    try {
      const parentName = text(row, "parentName");
      if (level === 1 && parentName) {
        addError(ctx, row, "上级客户（二级填写）", "一级客户不能填写上级客户", parentName);
        continue;
      }
      let parentId: string | null = null;
      if (level === 2) {
        if (!parentName) {
          addError(ctx, row, "上级客户（二级填写）", "二级客户必须填写上级一级客户");
          continue;
        }
        const parent = resolveCustomer(ctx, parentName, { level: 1 });
        if (!parent) continue;
        parentId = parent.id;
      }
      const existing = (ctx.cache.customers.get(name) ?? []).find(
        (c) => c.level === level && c.parentId === parentId,
      );
      const data = {
        name,
        level,
        parentId,
        salespersonId: resolveSalesperson(ctx, text(row, "salesperson"))?.id ?? null,
        contactName: text(row, "contactName"),
        phone: text(row, "phone"),
        email: text(row, "email"),
        address: text(row, "address"),
        status: text(row, "status") ?? "active",
        notes: text(row, "notes"),
      };
      if (existing) {
        await ctx.tx.customer.update({ where: { id: existing.id }, data });
        countRow(ctx, "main", "updated");
      } else {
        const created = await ctx.tx.customer.create({ data });
        pushToGroup(ctx.cache.customers, name, {
          id: created.id,
          name,
          level,
          parentId,
        });
        countRow(ctx, "main", "created");
      }
    } catch (error) {
      recordApiError(ctx, row, "客户", error);
    }
  }
}

/* ----------------------------------- 机柜 ---------------------------------- */

async function importRacks(ctx: Ctx, parsed: ParsedWorkbook): Promise<void> {
  for (const row of parsed.sheets.main ?? []) {
    const code = text(row, "code");
    if (!code) continue;
    try {
      const width = int(row, "width") ?? 19;
      if (width !== 19 && width !== 23) {
        addError(ctx, row, "宽度（英寸）", "机柜宽度只能是 19 或 23", String(width));
        continue;
      }
      const uStart = int(row, "uStart");
      const uEnd = int(row, "uEnd");
      if (uStart === null || uEnd === null) {
        addError(
          ctx,
          row,
          "起始 U 位 / 结束 U 位",
          "机柜模板 3.0 需要填写起始 U 位和结束 U 位，请重新下载模板",
        );
        continue;
      }
      if (uStart < 1 || uEnd > 100 || uStart > uEnd) {
        addError(
          ctx,
          row,
          "起始 U 位 / 结束 U 位",
          "机柜区间必须满足 1 ≤ 起始 U 位 ≤ 结束 U 位 ≤ 100",
          `${uStart}-${uEnd}`,
        );
        continue;
      }
      const supplierName = text(row, "supplierName");
      const siblings = ctx.cache.racks.get(code) ?? [];
      const existing = siblings.find(
        (rack) => rack.uStart === uStart && rack.uEnd === uEnd,
      );
      const supplier = supplierName ? resolveSupplier(ctx, supplierName) : null;
      const supplierId = supplier?.id ?? existing?.supplierId ?? null;
      if (!supplierId) {
        addError(ctx, row, "供应商（必填）", "供应商为必填项");
        continue;
      }
      await validateRackSegment(ctx.tx, {
        code,
        uStart,
        uEnd,
        excludeId: existing?.id,
      });
      const data = {
        code,
        location: text(row, "location"),
        status: text(row, "status") ?? "active",
        width,
        uStart,
        uEnd,
        power: text(row, "power"),
        serial: text(row, "serial"),
        supplierId,
        notes: text(row, "notes"),
      };
      if (existing) {
        await ctx.tx.rack.update({ where: { id: existing.id }, data });
        existing.supplierId = supplierId;
        countRow(ctx, "main", "updated");
      } else {
        const created = await ctx.tx.rack.create({ data });
        pushToGroup(ctx.cache.racks, code, {
          id: created.id,
          code,
          supplierId,
          uStart,
          uEnd,
        });
        countRow(ctx, "main", "created");
      }
    } catch (error) {
      recordApiError(ctx, row, "机柜", error);
    }
  }
}

/* ----------------------------------- VLAN ---------------------------------- */

async function importVlans(ctx: Ctx, parsed: ParsedWorkbook): Promise<void> {
  for (const row of parsed.sheets.main ?? []) {
    const vid = int(row, "vid");
    const name = text(row, "name");
    if (vid === null || !name) continue;
    try {
      if (vid < 1 || vid > 4094) {
        addError(ctx, row, "VLAN ID", "VLAN ID 必须在 1-4094 之间", String(vid));
        continue;
      }
      const supplierName = text(row, "supplierName");
      if (!supplierName) {
        addError(ctx, row, "供应商（必填）", "供应商为必填项");
        continue;
      }
      const supplier = resolveSupplier(ctx, supplierName);
      if (!supplier) continue;
      const key = `${supplier.id}|${vid}`;
      const existing = ctx.cache.vlans.get(key);
      const data = {
        vid,
        name,
        status: text(row, "status") ?? "active",
        description: text(row, "description"),
        supplierId: supplier.id,
      };
      if (existing) {
        await ctx.tx.vlan.update({ where: { id: existing.id }, data });
        existing.name = name;
        existing.supplierId = supplier.id;
        countRow(ctx, "main", "updated");
      } else {
        const created = await ctx.tx.vlan.create({ data });
        ctx.cache.vlans.set(key, {
          id: created.id,
          vid,
          name,
          supplierId: supplier.id,
        });
        countRow(ctx, "main", "created");
      }
    } catch (error) {
      recordApiError(ctx, row, "VLAN", error);
    }
  }
}

/* ----------------------------------- VXLAN --------------------------------- */

async function importVxlans(ctx: Ctx, parsed: ParsedWorkbook): Promise<void> {
  for (const row of parsed.sheets.main ?? []) {
    const vni = int(row, "vni");
    if (vni === null) continue;
    try {
      if (vni < VXLAN_VNI_MIN || vni > VXLAN_VNI_MAX) {
        addError(
          ctx,
          row,
          "VNI",
          `VXLAN VNI 必须在 ${VXLAN_VNI_MIN}-${VXLAN_VNI_MAX} 之间`,
          String(vni),
        );
        continue;
      }
      const existing = ctx.cache.vxlansByVni.get(vni);
      const supplierName = text(row, "supplierName");
      const explicitSupplier = supplierName ? resolveSupplier(ctx, supplierName) : null;
      const vlanVid = int(row, "vlanVid");
      const vlan = resolveVlan(ctx, explicitSupplier?.id ?? null, vlanVid);

      if (vlan) {
        const owner = ctx.cache.vxlanByVlanId.get(vlan.id);
        if (owner && owner.id !== existing?.id) {
          addError(
            ctx,
            row,
            "关联 VLAN ID（可空）",
            `VLAN ${vlan.vid} 已关联 VXLAN ${owner.vni}，一个 VLAN 最多关联一个 VXLAN`,
            String(vlanVid),
          );
          continue;
        }
      }

      const supplierId = resolveImportedSupplier(
        ctx,
        supplierName,
        [vlan],
        existing?.supplierId,
        "关联 VLAN",
      );
      assertSupplierConsistent(supplierId, vlan?.supplierId ?? null, " VLAN ");

      const data = {
        vni,
        name: text(row, "name"),
        status: text(row, "status") ?? "active",
        description: text(row, "description"),
        vlanId: vlan?.id ?? null,
        supplierId,
      };

      if (existing) {
        await ctx.tx.vxlan.update({ where: { id: existing.id }, data });
        if (existing.vlanId && existing.vlanId !== data.vlanId) {
          const current = ctx.cache.vxlanByVlanId.get(existing.vlanId);
          if (current?.id === existing.id) ctx.cache.vxlanByVlanId.delete(existing.vlanId);
        }
        existing.vlanId = data.vlanId;
        existing.supplierId = supplierId;
        if (data.vlanId) ctx.cache.vxlanByVlanId.set(data.vlanId, existing);
        countRow(ctx, "main", "updated");
      } else {
        const created = await ctx.tx.vxlan.create({ data });
        const lite: VxlanLite = {
          id: created.id,
          vni,
          vlanId: data.vlanId,
          supplierId,
        };
        ctx.cache.vxlansByVni.set(vni, lite);
        if (data.vlanId) ctx.cache.vxlanByVlanId.set(data.vlanId, lite);
        countRow(ctx, "main", "created");
      }
    } catch (error) {
      recordApiError(ctx, row, "VXLAN", error);
    }
  }
}

/* ---------------------------------- IP 段 ---------------------------------- */

async function importIpBlocks(ctx: Ctx, parsed: ParsedWorkbook): Promise<void> {
  // 覆盖范围大的段先处理，保证父段先于子段创建。
  const rows = [...(parsed.sheets.main ?? [])].sort((a, b) => {
    const pa = parseBlockSpec(text(a, "cidr") ?? "");
    const pb = parseBlockSpec(text(b, "cidr") ?? "");
    if (!pa && !pb) return 0;
    if (!pa) return 1;
    if (!pb) return -1;
    if (pa.version !== pb.version) return pa.version - pb.version;
    if (pa.version === 4) return (pb.size ?? 0) - (pa.size ?? 0);
    return (pa.prefix ?? 128) - (pb.prefix ?? 128);
  });

  for (const row of rows) {
    const cidrText = text(row, "cidr");
    if (!cidrText) continue;
    try {
      const parsedBlock = parseBlockSpec(cidrText);
      if (!parsedBlock) {
        addError(
          ctx,
          row,
          "CIDR / IP 区间",
          `「${cidrText}」不是合法 CIDR 或 IPv4 闭区间，如 192.168.1.0/24、10.99.1.0-10.99.1.255`,
          cidrText,
        );
        continue;
      }
      const status = text(row, "status") ?? "active";
      const role = text(row, "role") ?? "other";
      const parentText = text(row, "parentCidr");
      let parent: BlockLite | null = null;
      if (parentText) {
        parent = resolveBlock(ctx, parentText);
        if (!parent) continue;
      }
      const supplierName = text(row, "supplierName");
      const explicitSupplier = supplierName ? resolveSupplier(ctx, supplierName) : null;
      const vlanVid = int(row, "vlanVid");
      const vlan = resolveVlan(ctx, explicitSupplier?.id ?? null, vlanVid);
      const existing = ctx.cache.blocks.get(parsedBlock.canonical);
      const supplierId = resolveImportedSupplier(
        ctx,
        supplierName,
        [parent, vlan],
        existing?.supplierId,
        "父网段/VLAN",
      );
      assertSupplierConsistent(supplierId, vlan?.supplierId ?? null, " VLAN ");

      const validated = await validateBlockInput(
        ctx.tx,
        {
          cidr: parsedBlock.canonical,
          status,
          role,
          parentId: parent?.id ?? null,
          gateway: text(row, "gateway"),
          vlanId: vlan?.id ?? null,
          supplierId,
          description: text(row, "description"),
          assignedAt: text(row, "assignedAt"),
        },
        existing?.id,
      );
      const data = {
        cidr: validated.cidr,
        kind: validated.kind,
        rangeStart: validated.rangeStart,
        rangeEnd: validated.rangeEnd,
        ipVersion: validated.ipVersion,
        parentId: validated.parentId,
        status,
        role,
        vlanId: vlan?.id ?? null,
        supplierId,
        gateway: text(row, "gateway"),
        description: text(row, "description"),
        assignedAt: text(row, "assignedAt"),
      };
      let blockId: string;
      if (existing) {
        await ctx.tx.ipBlock.update({ where: { id: existing.id }, data });
        existing.status = status;
        existing.supplierId = supplierId;
        blockId = existing.id;
        countRow(ctx, "main", "updated");
      } else {
        const created = await ctx.tx.ipBlock.create({ data });
        blockId = created.id;
        ctx.cache.blocks.set(validated.cidr, {
          id: created.id,
          cidr: validated.cidr,
          status,
          supplierId,
        });
        countRow(ctx, "main", "created");
      }
      if (validated.kind === "range") {
        await syncRangeAddresses(ctx.tx, {
          id: blockId,
          cidr: validated.cidr,
          kind: validated.kind,
          rangeStart: validated.rangeStart,
          rangeEnd: validated.rangeEnd,
          ipVersion: validated.ipVersion,
          supplierId,
        });
      }
    } catch (error) {
      recordApiError(ctx, row, "IP段", error);
    }
  }
  await recomputeBlockParents(ctx.tx);
}

/* ---------------------------------- IP 地址 --------------------------------- */

async function importIpAddresses(ctx: Ctx, parsed: ParsedWorkbook): Promise<void> {
  for (const row of parsed.sheets.main ?? []) {
    const addressText = text(row, "address");
    if (!addressText) continue;
    try {
      const parsedIp = parseIp(addressText);
      if (!parsedIp) {
        addError(ctx, row, "IP 地址", `「${addressText}」不是合法 IP 地址`, addressText);
        continue;
      }
      const status = text(row, "status") ?? "active";
      const role = text(row, "role") ?? "other";
      const block = resolveBlock(ctx, text(row, "blockCidr"));
      const rack = resolveRack(ctx, text(row, "rackCode"));
      const device = resolveDevice(ctx, text(row, "deviceName"));
      const line = resolveLine(ctx, text(row, "lineCode"));
      const existing = ctx.cache.ips.get(parsedIp.canonical);
      const supplierId = resolveImportedSupplier(
        ctx,
        text(row, "supplierName"),
        [block, device, rack, line],
        existing?.supplierId,
        "网段/设备/机柜/线路",
      );

      const data = await validateAddressInput(ctx.tx, {
        address: parsedIp.canonical,
        blockId: block?.id ?? null,
        status,
        role,
        supplierId,
        rackId: rack?.id ?? null,
        deviceId: device?.id ?? null,
        lineId: line?.id ?? null,
        isPrimary: bool(row, "isPrimary"),
        dnsName: text(row, "dnsName"),
        description: text(row, "description"),
        assignedAt: text(row, "assignedAt"),
      });
      if (bool(row, "isPrimary") && device) {
        await ctx.tx.ipAddress.updateMany({
          where: { deviceId: device.id, isPrimary: true, address: { not: parsedIp.canonical } },
          data: { isPrimary: false },
        });
      }
      if (existing) {
        await ctx.tx.ipAddress.update({
          where: { id: existing.id },
          data: data as Prisma.IpAddressUncheckedUpdateInput,
        });
        existing.supplierId = (data.supplierId as string | null) ?? null;
        countRow(ctx, "main", "updated");
      } else {
        const created = await ctx.tx.ipAddress.create({
          data: data as Prisma.IpAddressUncheckedCreateInput,
        });
        ctx.cache.ips.set(parsedIp.canonical, {
          id: created.id,
          address: parsedIp.canonical,
          supplierId: (data.supplierId as string | null) ?? null,
        });
        countRow(ctx, "main", "created");
      }
      await recomputeIpCustomersForSpan(ctx.tx, parsedIp.canonical, parsedIp.canonical);
    } catch (error) {
      recordApiError(ctx, row, "IP 地址", error);
    }
  }
}

/* ----------------------------------- 设备 ---------------------------------- */

async function importDevices(ctx: Ctx, parsed: ParsedWorkbook): Promise<void> {
  for (const row of parsed.sheets.main ?? []) {
    const name = text(row, "name");
    if (!name) continue;
    try {
      const serialNo = text(row, "serialNo");
      let existing: DeviceLite | null = null;
      if (serialNo) {
        existing = ctx.cache.devicesBySerial.get(serialNo) ?? null;
      } else {
        const list = ctx.cache.devicesByName.get(name) ?? [];
        if (list.length > 1) {
          addError(ctx, row, "设备名称", `设备名称「${name}」已对应多台设备，请填写序列号以唯一匹配`, name);
          continue;
        }
        existing = list[0] ?? null;
      }

      const uStart = int(row, "uStart");
      const rack = resolveRack(ctx, text(row, "rackCode"), uStart);
      const supplierId = resolveImportedSupplier(
        ctx,
        text(row, "supplierName"),
        [rack],
        existing?.supplierId,
        "机柜",
      );

      const placement = await validateDevicePlacement(
        ctx.tx,
        {
          rackId: rack?.id ?? null,
          uStart,
          uHeight: int(row, "uHeight") ?? 1,
          face: text(row, "face") ?? "front",
        },
        existing?.id,
      );
      const data = {
        name,
        type: text(row, "type") ?? "router",
        role: text(row, "role") ?? "access",
        status: text(row, "status") ?? "active",
        manufacturer: text(row, "manufacturer"),
        model: text(row, "model"),
        serialNo,
        assetTag: text(row, "assetTag"),
        osVersion: text(row, "osVersion"),
        mac: text(row, "mac"),
        ...placement,
        supplierId,
        owner: text(row, "owner"),
        lastInventoryAt: text(row, "lastInventoryAt"),
        purchaseDate: text(row, "purchaseDate"),
        warrantyEnd: text(row, "warrantyEnd"),
        notes: text(row, "notes"),
      };

      let deviceId: string;
      if (existing) {
        const old = existing;
        const updated = await ctx.tx.device.update({ where: { id: old.id }, data });
        deviceId = updated.id;
        const oldList = ctx.cache.devicesByName.get(old.name) ?? [];
        const idx = oldList.findIndex((d) => d.id === old.id);
        if (idx >= 0) oldList.splice(idx, 1);
        if (oldList.length === 0) ctx.cache.devicesByName.delete(old.name);
        if (old.serialNo && old.serialNo !== updated.serialNo) {
          ctx.cache.devicesBySerial.delete(old.serialNo);
        }
        const lite: DeviceLite = {
          id: updated.id,
          name: updated.name,
          serialNo: updated.serialNo,
          rackId: updated.rackId,
          supplierId: updated.supplierId,
        };
        pushToGroup(ctx.cache.devicesByName, updated.name, lite);
        if (updated.serialNo) ctx.cache.devicesBySerial.set(updated.serialNo, lite);
        countRow(ctx, "main", "updated");
      } else {
        const created = await ctx.tx.device.create({ data });
        deviceId = created.id;
        const lite: DeviceLite = {
          id: created.id,
          name: created.name,
          serialNo: created.serialNo,
          rackId: created.rackId,
          supplierId: created.supplierId,
        };
        pushToGroup(ctx.cache.devicesByName, created.name, lite);
        if (created.serialNo) ctx.cache.devicesBySerial.set(created.serialNo, lite);
        countRow(ctx, "main", "created");
      }

      const mgmtText = text(row, "managementIp");
      if (mgmtText) {
        const mgmt = resolveIp(ctx, mgmtText);
        if (!mgmt) continue;
        await ctx.tx.ipAddress.updateMany({
          where: { deviceId, isPrimary: true, address: { not: mgmt.address } },
          data: { isPrimary: false },
        });
        await ctx.tx.ipAddress.update({
          where: { id: mgmt.id },
          data: { deviceId, isPrimary: true },
        });
      }
    } catch (error) {
      recordApiError(ctx, row, "设备", error);
    }
  }
}

/* ----------------------------------- 线路 ---------------------------------- */

async function importLines(ctx: Ctx, parsed: ParsedWorkbook): Promise<void> {
  for (const row of parsed.sheets.main ?? []) {
    const code = text(row, "code");
    const name = text(row, "name");
    if (!code || !name) continue;
    try {
      const bandwidth = int(row, "bandwidthMbps");
      if (bandwidth !== null && bandwidth < 0) {
        addError(ctx, row, "带宽（Mbps）", "带宽不能为负数", String(bandwidth));
        continue;
      }
      const feeYuan = row.values.monthlyFeeYuan;
      let feeCents: number | null = null;
      if (typeof feeYuan === "number") {
        if (feeYuan < 0) {
          addError(ctx, row, "月租（元）", "月租不能为负数", String(feeYuan));
          continue;
        }
        feeCents = Math.round(feeYuan * 100);
      }
      const existing = ctx.cache.lines.get(code);
      const supplierId = resolveImportedSupplier(
        ctx,
        text(row, "supplierName"),
        [],
        existing?.supplierId,
        "",
      );
      const data = {
        code,
        name,
        type: text(row, "type") ?? "internet",
        status: text(row, "status") ?? "active",
        supplierId,
        bandwidthMbps: bandwidth,
        monthlyFeeCents: feeCents,
        circuitNo: text(row, "circuitNo"),
        installDate: text(row, "installDate"),
        expireDate: text(row, "expireDate"),
        description: text(row, "description"),
      };
      if (existing) {
        await ctx.tx.line.update({ where: { id: existing.id }, data });
        existing.supplierId = supplierId;
        countRow(ctx, "main", "updated");
      } else {
        const created = await ctx.tx.line.create({ data });
        ctx.cache.lines.set(code, { id: created.id, code, supplierId });
        countRow(ctx, "main", "created");
      }
    } catch (error) {
      recordApiError(ctx, row, "线路", error);
    }
  }

  const groups = new Map<string, ParsedRow[]>();
  for (const row of parsed.sheets.terminations ?? []) {
    const code = text(row, "lineCode");
    if (!code) continue;
    pushToGroup(groups, code, row);
  }
  for (const [code, rows] of groups) {
    const first = rows[0];
    const line = ctx.cache.lines.get(code);
    if (!line) {
      addError(ctx, first, "线路编号", `线路「${code}」不存在，请先在线路工作表填写该线路`, code);
      continue;
    }
    try {
      const terms = [];
      let hasError = false;
      for (const r of rows) {
        try {
          const rack = resolveRack(ctx, text(r, "rackCode"));
          const deviceName = text(r, "deviceName");
          const device = deviceName ? resolveDevice(ctx, deviceName) : null;
          terms.push({
            side: text(r, "side") ?? "",
            rackId: rack?.id ?? null,
            deviceId: device?.id ?? null,
            port: text(r, "port"),
            description: text(r, "description"),
          });
        } catch (error) {
          recordApiError(ctx, r, "线路端点", error);
          hasError = true;
        }
      }
      if (hasError) continue;
      const validated = await validateTerminations(ctx.tx, terms);
      await ctx.tx.lineTermination.deleteMany({ where: { lineId: line.id } });
      if (validated.length > 0) {
        await ctx.tx.lineTermination.createMany({
          data: validated.map((t) => ({ ...t, lineId: line.id })),
        });
      }
      countWritten(ctx, "terminations", rows.length);
    } catch (error) {
      recordApiError(ctx, first, "线路端点", error);
    }
  }
}

/* ----------------------------------- 宽带 ---------------------------------- */

async function importBroadbands(ctx: Ctx, parsed: ParsedWorkbook): Promise<void> {
  for (const row of parsed.sheets.main ?? []) {
    const name = text(row, "name");
    if (!name) continue;
    try {
      const bandwidth = int(row, "bandwidthMbps");
      if (bandwidth !== null && bandwidth < 0) {
        addError(ctx, row, "带宽（Mbps）", "带宽不能为负数", String(bandwidth));
        continue;
      }
      const feeYuan = row.values.monthlyFeeYuan;
      let feeCents: number | null = null;
      if (typeof feeYuan === "number") {
        if (feeYuan < 0) {
          addError(ctx, row, "月费（元）", "月费不能为负数", String(feeYuan));
          continue;
        }
        feeCents = Math.round(feeYuan * 100);
      }
      const existing = ctx.cache.broadbands.get(name);
      const supplierId = resolveImportedSupplier(
        ctx,
        text(row, "supplierName"),
        [],
        existing?.supplierId,
        "",
      );
      const rack = resolveRack(ctx, text(row, "rackCode"));
      const device = resolveDevice(ctx, text(row, "deviceName"));
      const line = resolveLine(ctx, text(row, "lineCode"));
      const ip = resolveIp(ctx, text(row, "ipAddress"));
      const data = {
        name,
        supplierId,
        bandwidthMbps: bandwidth,
        status: text(row, "status") ?? "active",
        expireDate: text(row, "expireDate"),
        account: text(row, "account"),
        password: text(row, "password"),
        installAddress: text(row, "installAddress"),
        rackId: rack?.id ?? null,
        deviceId: device?.id ?? null,
        lineId: line?.id ?? null,
        ipAddressId: ip?.id ?? null,
        monthlyFeeCents: feeCents,
        contractNo: text(row, "contractNo"),
        description: text(row, "description"),
        notes: text(row, "notes"),
      };
      if (existing) {
        await ctx.tx.broadband.update({ where: { id: existing.id }, data });
        existing.supplierId = supplierId;
        countRow(ctx, "main", "updated");
      } else {
        const created = await ctx.tx.broadband.create({ data });
        ctx.cache.broadbands.set(name, {
          id: created.id,
          name,
          supplierId,
        });
        countRow(ctx, "main", "created");
      }
    } catch (error) {
      recordApiError(ctx, row, "宽带", error);
    }
  }
}

/* --------------------------------- 业务系统 --------------------------------- */

async function importBusinessSystems(ctx: Ctx, parsed: ParsedWorkbook): Promise<void> {
  for (const row of parsed.sheets.main ?? []) {
    const name = text(row, "name");
    if (!name) continue;
    try {
      const code = text(row, "code");
      let existing: SystemLite | null = null;
      if (code) {
        existing = ctx.cache.systemsByCode.get(code) ?? null;
      } else {
        const list = ctx.cache.systemsByName.get(name) ?? [];
        if (list.length > 1) {
          addError(ctx, row, "系统名称", `系统名称「${name}」对应多条记录，请填写系统编号以唯一匹配`, name);
          continue;
        }
        existing = list[0] ?? null;
      }
      const data = {
        name,
        code,
        owner: text(row, "owner") ?? "",
        department: text(row, "department"),
        environment: text(row, "environment") ?? "prod",
        criticality: text(row, "criticality") ?? "normal",
        status: text(row, "status") ?? "active",
        url: text(row, "url"),
        domain: text(row, "domain"),
        onlineDate: text(row, "onlineDate"),
        description: text(row, "description"),
      };
      if (existing) {
        const old = existing;
        const updated = await ctx.tx.businessSystem.update({
          where: { id: old.id },
          data,
        });
        const oldList = ctx.cache.systemsByName.get(old.name) ?? [];
        const idx = oldList.findIndex((s) => s.id === old.id);
        if (idx >= 0) oldList.splice(idx, 1);
        if (oldList.length === 0) ctx.cache.systemsByName.delete(old.name);
        if (old.code && old.code !== updated.code) ctx.cache.systemsByCode.delete(old.code);
        const lite: SystemLite = {
          id: updated.id,
          name: updated.name,
          code: updated.code,
        };
        pushToGroup(ctx.cache.systemsByName, updated.name, lite);
        if (updated.code) ctx.cache.systemsByCode.set(updated.code, lite);
        countRow(ctx, "main", "updated");
      } else {
        const created = await ctx.tx.businessSystem.create({ data });
        const lite: SystemLite = {
          id: created.id,
          name: created.name,
          code: created.code,
        };
        pushToGroup(ctx.cache.systemsByName, created.name, lite);
        if (created.code) ctx.cache.systemsByCode.set(created.code, lite);
        countRow(ctx, "main", "created");
      }
    } catch (error) {
      recordApiError(ctx, row, "业务系统", error);
    }
  }

  const groups = new Map<string, ParsedRow[]>();
  for (const row of parsed.sheets.endpoints ?? []) {
    const name = text(row, "systemName");
    if (!name) continue;
    pushToGroup(groups, name, row);
  }
  for (const [name, rows] of groups) {
    const first = rows[0];
    let system: SystemLite;
    try {
      const found = resolveSystem(ctx, name);
      if (!found) continue;
      system = found;
    } catch (error) {
      recordApiError(ctx, first, "系统名称", error);
      continue;
    }
    try {
      const endpoints = [];
      let hasError = false;
      for (const r of rows) {
        const ipText = text(r, "ipAddress");
        if (!ipText) {
          addError(ctx, r, "IP 地址", "IP 地址为必填项");
          hasError = true;
          continue;
        }
        const parsedIp = parseIp(ipText);
        if (!parsedIp) {
          addError(ctx, r, "IP 地址", `「${ipText}」不是合法 IP 地址`, ipText);
          hasError = true;
          continue;
        }
        const linked = ctx.cache.ips.get(parsedIp.canonical);
        endpoints.push({
          ipAddressId: linked?.id ?? null,
          ipText: linked ? null : parsedIp.canonical,
          protocol: text(r, "protocol") ?? "tcp",
          port: int(r, "port"),
          isPrimary: bool(r, "isPrimary"),
          description: text(r, "description"),
        });
      }
      if (hasError) continue;
      const validated = await validateEndpoints(ctx.tx, endpoints);
      await ctx.tx.businessSystemEndpoint.deleteMany({ where: { systemId: system.id } });
      if (validated.length > 0) {
        await ctx.tx.businessSystemEndpoint.createMany({
          data: validated.map((e) => ({ ...e, systemId: system.id })),
        });
      }
      countWritten(ctx, "endpoints", rows.length);
    } catch (error) {
      recordApiError(ctx, first, "访问端点", error);
    }
  }
}

/* --------------------------------- 客户测试 --------------------------------- */

async function importCustomerTests(ctx: Ctx, parsed: ParsedWorkbook): Promise<void> {
  const max = await ctx.tx.customerTest.aggregate({ _max: { seqNo: true } });
  let nextSeq = max._max.seqNo ?? 0;

  for (const row of parsed.sheets.main ?? []) {
    const companyName = text(row, "companyName");
    const startAt = text(row, "startAt");
    if (!companyName || !startAt) continue;
    try {
      const endAt = text(row, "endAt") ?? addDays(startAt, 7);
      if (endAt < startAt) {
        addError(ctx, row, "测试结束日期", "测试结束日期不能早于开始日期", endAt);
        continue;
      }
      const customerName = text(row, "customerName");
      const customer = customerName ? resolveCustomer(ctx, customerName) : null;
      const converted = bool(row, "converted");
      const data = {
        customerId: customer?.id ?? null,
        companyName,
        salesperson: text(row, "salesperson"),
        content: text(row, "content"),
        startAt,
        endAt,
        accepted: converted ? true : bool(row, "accepted"),
        converted,
        status: text(row, "status"),
        notes: text(row, "notes"),
      };
      const providedSeq = int(row, "seqNo");
      if (providedSeq !== null) {
        const existing = await ctx.tx.customerTest.findUnique({
          where: { seqNo: providedSeq },
          select: { id: true },
        });
        if (existing) {
          await ctx.tx.customerTest.update({ where: { id: existing.id }, data });
          countRow(ctx, "main", "updated");
        } else {
          await ctx.tx.customerTest.create({ data: { ...data, seqNo: providedSeq } });
          countRow(ctx, "main", "created");
          nextSeq = Math.max(nextSeq, providedSeq);
        }
      } else {
        nextSeq += 1;
        await ctx.tx.customerTest.create({ data: { ...data, seqNo: nextSeq } });
        countRow(ctx, "main", "created");
      }
    } catch (error) {
      recordApiError(ctx, row, "客户测试", error);
    }
  }
}

/* --------------------------------- 分发与入口 -------------------------------- */

function initialSummary(spec: ModuleSpec): Map<string, SheetImportSummary> {
  return new Map(
    spec.sheets.map((sheet: SheetSpec) => [
      sheet.key,
      { sheet: sheet.name, rows: 0, created: 0, updated: 0 },
    ]),
  );
}

function finalizeSummary(
  spec: ModuleSpec,
  parsed: ParsedWorkbook,
  summary: Map<string, SheetImportSummary>,
): ImportSummary {
  const sheets = Array.from(summary.values());
  return {
    module: spec.key,
    label: spec.label,
    totalRows: parsed.totalRows,
    created: sheets.reduce((acc, s) => acc + s.created, 0),
    updated: sheets.reduce((acc, s) => acc + s.updated, 0),
    sheets,
  };
}

async function dispatch(ctx: Ctx, parsed: ParsedWorkbook): Promise<void> {
  const key = parsed.spec.key;
  switch (key) {
    case "salespersons":
      await importSalespersons(ctx, parsed);
      break;
    case "suppliers":
      await importSuppliers(ctx, parsed);
      break;
    case "customers":
      await importCustomers(ctx, parsed);
      break;
    case "racks":
      await importRacks(ctx, parsed);
      break;
    case "vlans":
      await importVlans(ctx, parsed);
      break;
    case "vxlans":
      await importVxlans(ctx, parsed);
      break;
    case "ip-blocks":
      await importIpBlocks(ctx, parsed);
      break;
    case "ip-addresses":
      await importIpAddresses(ctx, parsed);
      break;
    case "devices":
      await importDevices(ctx, parsed);
      break;
    case "lines":
      await importLines(ctx, parsed);
      break;
    case "broadbands":
      await importBroadbands(ctx, parsed);
      break;
    case "business-systems":
      await importBusinessSystems(ctx, parsed);
      break;
    case "customer-tests":
      await importCustomerTests(ctx, parsed);
      break;
    default:
      throw new ApiError(400, "未知的导入模块", "UNKNOWN_MODULE");
  }
}

export async function runWorkbookImport(
  parsed: ParsedWorkbook,
  user: SessionUser,
  dryRun: boolean,
): Promise<{ dryRun: boolean; summary: ImportSummary }> {
  if (parsed.errors.length > 0) {
    throw new ImportValidationError(parsed.errors);
  }

  try {
    const summary = await prisma.$transaction(
      async (tx) => {
        const ctx: Ctx = {
          tx,
          user,
          errors: [],
          summary: initialSummary(parsed.spec),
          cache: await loadCache(tx),
        };
        await dispatch(ctx, parsed);
        if (ctx.errors.length > 0) {
          throw new ImportValidationError(ctx.errors);
        }
        const result = finalizeSummary(parsed.spec, parsed, ctx.summary);
        if (dryRun) throw new DryRunRollback(result);

        await writeChangeLog(tx, {
          user,
          resource: parsed.spec.key,
          recordId: "batch",
          action: "IMPORT",
          summary: `导入${parsed.spec.label}：${result.totalRows} 行，新增 ${result.created}，更新 ${result.updated}`,
          after: result,
        });
        return result;
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
    return { dryRun: false, summary };
  } catch (error) {
    if (error instanceof DryRunRollback) {
      return { dryRun: true, summary: error.summary };
    }
    throw error;
  }
}
