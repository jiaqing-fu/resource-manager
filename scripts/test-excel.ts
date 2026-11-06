import ExcelJS from "exceljs";
import { prisma } from "../src/lib/db";
import { MODULES, type ModuleSpec } from "../src/lib/excel/specs";
import { buildTemplateWorkbook, buildExportWorkbook } from "../src/lib/excel/template";
import { parseWorkbookBuffer } from "../src/lib/excel/parse";
import {
  ImportValidationError,
  runWorkbookImport,
} from "../src/server/services/excel-import";
import { buildExportData } from "../src/server/services/excel-export";
import { createAllocation } from "../src/server/services/allocations";
import type { SessionUser } from "../src/lib/auth";

const user: SessionUser = {
  id: "test-user",
  username: "tester",
  displayName: "测试员",
  role: "ADMIN",
};

async function importModule(
  key: string,
  fill: (wb: ExcelJS.Workbook, spec: ModuleSpec) => void,
) {
  const spec = MODULES[key];
  if (!spec) throw new Error(`unknown module ${key}`);
  const wb = await buildTemplateWorkbook(spec);
  fill(wb, spec);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const parsed = await parseWorkbookBuffer(buf, spec);
  if (parsed.errors.length) {
    console.error(`[${key}] parse errors`, parsed.errors.slice(0, 10));
    throw new Error(`parse failed for ${key}`);
  }
  const dry = await runWorkbookImport(parsed, user, true);
  if (!dry.dryRun) throw new Error("expected dry run");
  const real = await runWorkbookImport(parsed, user, false);
  console.log(
    `[${key}] rows=${real.summary.totalRows} created=${real.summary.created} updated=${real.summary.updated}`,
  );
  return real.summary;
}

async function expectImportError(
  key: string,
  fill: (wb: ExcelJS.Workbook, spec: ModuleSpec) => void,
  expected: string,
  real = false,
) {
  const spec = MODULES[key];
  if (!spec) throw new Error(`unknown module ${key}`);
  const wb = await buildTemplateWorkbook(spec);
  fill(wb, spec);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const parsed = await parseWorkbookBuffer(buf, spec);
  if (parsed.errors.length) {
    throw new Error(`parse failed for ${key}: ${parsed.errors[0]?.message}`);
  }

  let dryError: ImportValidationError | null = null;
  try {
    await runWorkbookImport(parsed, user, true);
  } catch (error) {
    if (!(error instanceof ImportValidationError)) throw error;
    dryError = error;
  }
  if (!dryError) throw new Error(`expected import error for ${key}`);
  const hit = dryError.errors.find((e) => e.message.includes(expected));
  if (!hit) {
    console.error(`[${key}] unexpected errors`, dryError.errors.slice(0, 10));
    throw new Error(`expected error containing "${expected}" for ${key}`);
  }
  console.log(`PASS [${key}] 行级错误：${hit.message}`);
  if (!real) return;

  try {
    await runWorkbookImport(parsed, user, false);
  } catch (error) {
    if (!(error instanceof ImportValidationError)) throw error;
    const realHit = error.errors.find((e) => e.message.includes(expected));
    if (!realHit) {
      console.error(`[${key}] unexpected real-import errors`, error.errors.slice(0, 10));
      throw new Error(`expected real-import error containing "${expected}" for ${key}`);
    }
    console.log(`PASS [${key}] 真实导入整批回滚：${realHit.message}`);
    return;
  }
  throw new Error(`expected real import error for ${key}`);
}

async function main() {
  if (process.env.ALLOW_DESTRUCTIVE_TESTS !== "1") {
    console.error(
      "拒绝执行：该脚本会清空全部业务数据，仅用于开发环境。设置 ALLOW_DESTRUCTIVE_TESTS=1 后再运行。",
    );
    process.exit(1);
  }

  await prisma.$transaction(async (tx) => {
    await tx.changeLog.deleteMany();
    await tx.resourceAllocation.deleteMany();
    await tx.broadband.deleteMany();
    await tx.businessSystemEndpoint.deleteMany();
    await tx.businessSystem.deleteMany();
    await tx.customerTest.deleteMany();
    await tx.lineTermination.deleteMany();
    await tx.line.deleteMany();
    await tx.ipAddress.deleteMany();
    await tx.device.deleteMany();
    await tx.ipBlock.updateMany({ data: { parentId: null } });
    await tx.ipBlock.deleteMany();
    await tx.vxlan.deleteMany();
    await tx.vlan.deleteMany();
    await tx.rack.deleteMany();
    await tx.supplierContact.deleteMany();
    await tx.supplier.updateMany({ data: { parentId: null } });
    await tx.supplier.deleteMany();
    await tx.customer.updateMany({ data: { parentId: null } });
    await tx.customer.deleteMany();
    await tx.salesperson.deleteMany();
  });

  await importModule("suppliers", (wb) => {
    const main = wb.getWorksheet("供应商")!;
    main.addRow(["中国电信", "一级", "", "运营商", 4134, "张三", "13800000000", "a@example.com", "", "启用", ""]);
    main.addRow(["电信支公司", "二级", "中国电信", "运营商", "", "李四", "", "", "", "启用", ""]);
    const contacts = wb.getWorksheet("联系方式")!;
    contacts.addRow(["中国电信", "", "张三", "客户经理", "13800000000", "", "", "是", ""]);
    contacts.addRow(["电信支公司", "中国电信", "李四", "技术", "", "", "", "是", ""]);
  });

  await importModule("salespersons", (wb) => {
    wb.getWorksheet("业务员")!.addRow(["王五", "13900000000", "启用", "客户业务员"]);
  });
  await importModule("salespersons", (wb) => {
    wb.getWorksheet("业务员")!.addRow(["王五", "13900000001", "启用", "更新业务员"]);
  });

  await importModule("customers", (wb) => {
    const main = wb.getWorksheet("客户")!;
    main.addRow(["测试客户", "一级", "", "王五", "王五", "13900000000", "", "", "启用", ""]);
    main.addRow(["测试二级客户", "二级", "测试客户", "王五", "李四", "13900000002", "", "", "启用", ""]);
    main.addRow(["冲突客户", "一级", "", "", "", "", "", "", "启用", ""]);
  });

  await expectImportError(
    "customers",
    (wb) => {
      wb.getWorksheet("客户")!.addRow([
        "未知业务员客户", "一级", "", "不存在业务员", "", "", "", "", "启用", "",
      ]);
    },
    "业务员「不存在业务员」不存在",
  );

  const importedCustomer = await prisma.customer.findFirst({
    where: { name: "测试客户" },
    include: { salesperson: { select: { name: true } } },
  });
  if (importedCustomer?.salesperson?.name !== "王五") {
    throw new Error("客户导入未按姓名绑定业务员");
  }
  console.log("PASS 客户导入按姓名绑定业务员 王五");

  const testCustomer = await prisma.customer.findFirst({
    where: { name: "测试客户", level: 1 },
  });
  const testChildCustomer = testCustomer
    ? await prisma.customer.findFirst({
        where: { name: "测试二级客户", level: 2, parentId: testCustomer.id },
      })
    : null;
  const conflictCustomer = await prisma.customer.findFirst({
    where: { name: "冲突客户", level: 1 },
  });
  if (!testCustomer || !testChildCustomer || !conflictCustomer) {
    throw new Error("IP 导入测试所需的一级/二级/冲突客户未创建");
  }

  await importModule("racks", (wb) => {
    wb.getWorksheet("机柜")!.addRow([
      "测试位置", "A01", "在用", "19", 1, 42, "双路", "SN-RACK-1", "中国电信", "自动化测试",
    ]);
  });

  await importModule("vlans", (wb) => {
    const main = wb.getWorksheet("VLAN")!;
    main.addRow([100, "业务VLAN", "在用", "中国电信", "测试客户", "", "自动化测试"]);
    main.addRow([101, "未绑定VLAN", "在用", "中国电信", "", "", "客户列留空"]);
  });

  await importModule("vxlans", (wb) => {
    wb.getWorksheet("VXLAN")!.addRow([
      10010, "测试VXLAN", "在用", 100, "", "测试客户", "测试二级客户", "供应商由 VLAN 继承",
    ]);
  });

  await importModule("ip-blocks", (wb) => {
    const main = wb.getWorksheet("IP段")!;
    main.addRow(["10.99.0.0/16", "在用", "内部", "", 100, "中国电信", "", "测试父段", ""]);
    main.addRow(["10.99.1.0/24", "在用", "内部", "10.99.0.0/16", 100, "", "10.99.1.1", "测试子段", ""]);
    main.addRow(["10.40.0.0-10.40.0.15", "在用", "内部", "", "", "中国电信", "", "测试 IP 区间", ""]);
  });

  const rangeBlock = await prisma.ipBlock.findUnique({
    where: { cidr: "10.40.0.0-10.40.0.15" },
    include: { _count: { select: { ipAddresses: true } } },
  });
  if (
    rangeBlock?.kind !== "range" ||
    rangeBlock._count.ipAddresses !== 16 ||
    !(await prisma.ipAddress.findUnique({ where: { address: "10.40.0.0" } })) ||
    !(await prisma.ipAddress.findUnique({ where: { address: "10.40.0.15" } }))
  ) {
    throw new Error("IP 区间导入未自动生成 16 个地址（含起止地址）");
  }
  console.log("PASS IP 区间导入自动生成 16 个地址");

  await importModule("ip-blocks", (wb) => {
    wb.getWorksheet("IP段")!.addRow([
      "10.40.0.0-10.40.0.15", "在用", "内部", "", "", "中国电信", "", "再次导入测试幂等", "",
    ]);
  });
  if ((await prisma.ipAddress.count({ where: { blockId: rangeBlock.id } })) !== 16) {
    throw new Error("重复导入 IP 区间产生了重复地址");
  }
  console.log("PASS IP 区间重复导入幂等");

  await importModule("devices", (wb) => {
    wb.getWorksheet("设备")!.addRow([
      "核心路由器-01", "路由器", "核心", "在用", "MikroTik", "CCR2004", "SN-DEV-1", "AT-1", "7.15", "AA:BB:CC:DD:EE:FF",
      "A01", 1, 1, "前面板", "", "测试客户", "", "王五", "2026-11-01", "2026-01-01", "2028-01-01",
      "", "供应商由机柜继承",
    ]);
  });

  await importModule("lines", (wb) => {
    wb.getWorksheet("线路")!.addRow([
      "LN-TEST-001", "测试线路", "互联网", "在用", "中国电信", "测试客户", "测试二级客户",
      100, 1000, "CIR-1", "2026-01-01", "2027-01-01", "",
    ]);
    wb.getWorksheet("线路端点")!.addRow([
      "LN-TEST-001", "A 端", "A01", "核心路由器-01", "ether1", "",
    ]);
  });

  const vlan100 = await prisma.vlan.findFirst({ where: { vid: 100 } });
  const vlan101 = await prisma.vlan.findFirst({ where: { vid: 101 } });
  const vxlan10010 = await prisma.vxlan.findUnique({ where: { vni: 10010 } });
  const coreRouter = await prisma.device.findFirst({ where: { name: "核心路由器-01" } });
  const testLine = await prisma.line.findUnique({ where: { code: "LN-TEST-001" } });
  if (!vlan100 || !vlan101 || !vxlan10010 || !coreRouter || !testLine) {
    throw new Error("资源导入后未找到 VLAN/VXLAN/设备/线路测试记录");
  }

  const vlan100Alloc = await prisma.resourceAllocation.findFirst({
    where: { resourceType: "vlan", vlanId: vlan100.id, releasedAt: null },
    select: { id: true, customerId: true, notes: true, allocatedAt: true },
  });
  const vlan101AllocCount = await prisma.resourceAllocation.count({
    where: { resourceType: "vlan", vlanId: vlan101.id, releasedAt: null },
  });
  const vxlan10010Alloc = await prisma.resourceAllocation.findFirst({
    where: { resourceType: "vxlan", vxlanId: vxlan10010.id, releasedAt: null },
    select: { id: true, customerId: true, notes: true },
  });
  const deviceAlloc = await prisma.resourceAllocation.findFirst({
    where: { resourceType: "device", deviceId: coreRouter.id, releasedAt: null },
    select: { customerId: true, notes: true },
  });
  const lineAlloc = await prisma.resourceAllocation.findFirst({
    where: { resourceType: "line", lineId: testLine.id, releasedAt: null },
    select: { id: true, customerId: true, notes: true },
  });

  if (
    vlan100.customerId !== testCustomer.id ||
    vlan100Alloc?.customerId !== testCustomer.id ||
    vlan100Alloc.notes !== "Excel 批量导入" ||
    !vlan100Alloc.allocatedAt
  ) {
    throw new Error("VLAN 导入未按一级客户创建资源分配");
  }
  if (vlan101.customerId !== null || vlan101AllocCount !== 0) {
    throw new Error("客户列留空的 VLAN 不应创建分配");
  }
  if (
    vxlan10010.customerId !== testChildCustomer.id ||
    vxlan10010Alloc?.customerId !== testChildCustomer.id ||
    vxlan10010Alloc.notes !== "Excel 批量导入"
  ) {
    throw new Error("VXLAN 导入未按二级客户创建资源分配");
  }
  if (coreRouter.customerId !== testCustomer.id || deviceAlloc?.customerId !== testCustomer.id) {
    throw new Error("设备导入未按一级客户创建资源分配");
  }
  if (
    testLine.customerId !== testChildCustomer.id ||
    lineAlloc?.customerId !== testChildCustomer.id
  ) {
    throw new Error("线路导入未按二级客户创建资源分配");
  }
  console.log("PASS VLAN/VXLAN/设备/线路导入按一级/二级客户创建资源分配，留空不创建");

  await importModule("vlans", (wb) => {
    const main = wb.getWorksheet("VLAN")!;
    main.addRow([100, "业务VLAN", "在用", "中国电信", "测试客户", "", "自动化测试"]);
    main.addRow([101, "未绑定VLAN", "在用", "中国电信", "", "", "客户列留空"]);
  });
  await importModule("vxlans", (wb) => {
    wb.getWorksheet("VXLAN")!.addRow([
      10010, "测试VXLAN", "在用", 100, "", "测试客户", "测试二级客户", "供应商由 VLAN 继承",
    ]);
  });
  await importModule("devices", (wb) => {
    wb.getWorksheet("设备")!.addRow([
      "核心路由器-01", "路由器", "核心", "在用", "MikroTik", "CCR2004", "SN-DEV-1", "AT-1", "7.15", "AA:BB:CC:DD:EE:FF",
      "A01", 1, 1, "前面板", "", "测试客户", "", "王五", "2026-11-01", "2026-01-01", "2028-01-01",
      "", "供应商由机柜继承",
    ]);
  });
  await importModule("lines", (wb) => {
    wb.getWorksheet("线路")!.addRow([
      "LN-TEST-001", "测试线路", "互联网", "在用", "中国电信", "测试客户", "测试二级客户",
      100, 1000, "CIR-1", "2026-01-01", "2027-01-01", "",
    ]);
  });

  const reimportedVlanAlloc = await prisma.resourceAllocation.findMany({
    where: { resourceType: "vlan", vlanId: vlan100.id, releasedAt: null },
    select: { id: true, customerId: true, notes: true, allocatedAt: true },
  });
  const reimportedVxlanAllocCount = await prisma.resourceAllocation.count({
    where: { resourceType: "vxlan", vxlanId: vxlan10010.id, releasedAt: null },
  });
  const reimportedDeviceAllocCount = await prisma.resourceAllocation.count({
    where: { resourceType: "device", deviceId: coreRouter.id, releasedAt: null },
  });
  const reimportedLineAlloc = await prisma.resourceAllocation.findMany({
    where: { resourceType: "line", lineId: testLine.id, releasedAt: null },
    select: { id: true, customerId: true, notes: true },
  });
  if (
    reimportedVlanAlloc.length !== 1 ||
    reimportedVlanAlloc[0].id !== vlan100Alloc.id ||
    reimportedVlanAlloc[0].notes !== vlan100Alloc.notes ||
    reimportedVlanAlloc[0].allocatedAt?.getTime() !== vlan100Alloc.allocatedAt?.getTime() ||
    reimportedVxlanAllocCount !== 1 ||
    reimportedDeviceAllocCount !== 1 ||
    reimportedLineAlloc.length !== 1 ||
    reimportedLineAlloc[0].id !== lineAlloc.id
  ) {
    throw new Error("重复导入同一客户不应重复创建或修改分配");
  }
  console.log("PASS VLAN/VXLAN/设备/线路重复导入同一客户保持幂等");

  await expectImportError(
    "vlans",
    (wb) => {
      wb.getWorksheet("VLAN")!.addRow([
        102, "不存在客户VLAN", "在用", "中国电信", "不存在的客户", "", "",
      ]);
    },
    "一级客户「不存在的客户」不存在",
  );
  if (await prisma.vlan.findFirst({ where: { vid: 102 } })) {
    throw new Error("客户不存在时不应写入 VLAN");
  }
  await expectImportError(
    "vlans",
    (wb) => {
      wb.getWorksheet("VLAN")!.addRow([
        103, "缺一级VLAN", "在用", "中国电信", "", "测试二级客户", "",
      ]);
    },
    "必须同时填写一级客户",
  );
  if (await prisma.vlan.findFirst({ where: { vid: 103 } })) {
    throw new Error("只填二级客户时不应写入 VLAN");
  }
  await expectImportError(
    "vlans",
    (wb) => {
      wb.getWorksheet("VLAN")!.addRow([
        100, "被冲突改写", "在用", "中国电信", "冲突客户", "", "",
      ]);
    },
    "已分配给客户「测试客户」",
    true,
  );
  const vlanAfterConflict = await prisma.vlan.findFirst({ where: { vid: 100 } });
  const vlanAllocAfterConflict = await prisma.resourceAllocation.findFirst({
    where: { resourceType: "vlan", vlanId: vlan100.id, releasedAt: null },
    select: { customerId: true },
  });
  if (
    vlanAfterConflict?.name !== "业务VLAN" ||
    vlanAfterConflict.customerId !== testCustomer.id ||
    vlanAllocAfterConflict?.customerId !== testCustomer.id
  ) {
    throw new Error("VLAN 客户冲突导致真实导入失败后，资源与分配应整批回滚");
  }
  console.log("PASS VLAN 客户不存在/二级缺一级/已分配其他客户均阻止导入并回滚");

  const customerIpRow = (
    address: string,
    level1: string,
    level2: string,
    blockCidr = "10.99.1.0/24",
  ) => [
    address,
    blockCidr,
    "在用",
    "客户",
    "中国电信",
    level1,
    level2,
    "",
    "",
    "",
    "否",
    "",
    "",
    "2026-11-01",
  ];

  const fillIpAddressRows = (wb: ExcelJS.Workbook) => {
    const main = wb.getWorksheet("IP地址")!;
    main.addRow([
      "10.99.1.10", "10.99.1.0/24", "在用", "管理", "",
      "测试客户", "",
      "A01", "核心路由器-01", "", "否", "core-1", "", "2026-11-01",
    ]);
    main.addRow([
      "10.99.1.11", "10.99.1.0/24", "在用", "客户", "中国电信",
      "测试客户", "测试二级客户",
      "", "", "LN-TEST-001", "否", "srv-1", "", "2026-11-01",
    ]);
    main.addRow([
      "10.40.0.10", "10.40.0.0-10.40.0.15", "在用", "管理", "中国电信",
      "", "",
      "", "", "", "否", "range-10", "", "2026-11-01",
    ]);
  };

  await importModule("ip-addresses", fillIpAddressRows);

  const rangeIp = await prisma.ipAddress.findUnique({ where: { address: "10.40.0.10" } });
  if (rangeIp?.blockId !== rangeBlock.id || rangeIp.dnsName !== "range-10") {
    throw new Error("IP 地址导入未能按 IP 区间标签解析所属段");
  }
  console.log("PASS IP 地址导入按区间标签匹配所属段");

  const ip1010 = await prisma.ipAddress.findUnique({ where: { address: "10.99.1.10" } });
  const ip1011 = await prisma.ipAddress.findUnique({ where: { address: "10.99.1.11" } });
  if (ip1010?.customerId !== testCustomer.id) {
    throw new Error("10.99.1.10 未分配给一级客户 测试客户");
  }
  if (ip1011?.customerId !== testChildCustomer.id) {
    throw new Error("10.99.1.11 未分配给二级客户 测试二级客户");
  }
  const alloc1010 = await prisma.resourceAllocation.findFirst({
    where: { resourceType: "ipAddress", ipAddressId: ip1010.id, releasedAt: null },
    select: { customerId: true, allocatedAt: true, notes: true },
  });
  if (
    alloc1010?.customerId !== testCustomer.id ||
    alloc1010.allocatedAt.toISOString().slice(0, 10) !== "2026-11-01" ||
    alloc1010.notes !== "Excel 批量导入"
  ) {
    throw new Error("10.99.1.10 未创建正确的资源分配");
  }
  const alloc1011 = await prisma.resourceAllocation.findFirst({
    where: { resourceType: "ipAddress", ipAddressId: ip1011.id, releasedAt: null },
    select: { customerId: true },
  });
  if (alloc1011?.customerId !== testChildCustomer.id) {
    throw new Error("10.99.1.11 未创建二级客户的资源分配");
  }
  const allocRangeBlank = await prisma.resourceAllocation.count({
    where: { resourceType: "ipAddress", ipAddressId: rangeIp.id, releasedAt: null },
  });
  if (rangeIp.customerId !== null || allocRangeBlank !== 0) {
    throw new Error("未填写客户列的 IP 不应创建分配");
  }
  console.log("PASS IP 导入按一级/二级客户创建资源分配，留空不创建");

  await importModule("ip-addresses", fillIpAddressRows);
  const idempotent1010 = await prisma.resourceAllocation.count({
    where: { resourceType: "ipAddress", ipAddressId: ip1010.id, releasedAt: null },
  });
  const idempotent1011 = await prisma.resourceAllocation.count({
    where: { resourceType: "ipAddress", ipAddressId: ip1011.id, releasedAt: null },
  });
  if (idempotent1010 !== 1 || idempotent1011 !== 1) {
    throw new Error("重复导入同一客户不应重复创建分配");
  }
  console.log("PASS 重复导入同一客户不重复创建分配");

  await expectImportError(
    "ip-addresses",
    (wb) => {
      wb.getWorksheet("IP地址")!.addRow(customerIpRow("10.99.1.20", "不存在的客户", ""));
    },
    "一级客户「不存在的客户」不存在",
  );
  await expectImportError(
    "ip-addresses",
    (wb) => {
      wb.getWorksheet("IP地址")!.addRow(customerIpRow("10.99.1.21", "", "测试二级客户"));
    },
    "必须同时填写一级客户",
  );
  await expectImportError(
    "ip-addresses",
    (wb) => {
      wb.getWorksheet("IP地址")!.addRow(customerIpRow("10.99.1.22", "测试客户", "不存在的二级客户"));
    },
    "一级客户「测试客户」下不存在二级客户「不存在的二级客户」",
  );
  await expectImportError(
    "ip-addresses",
    (wb) => {
      wb.getWorksheet("IP地址")!.addRow(customerIpRow("10.99.1.23", "冲突客户", "测试二级客户"));
    },
    "二级客户「测试二级客户」不属于一级客户「冲突客户」",
  );
  await expectImportError(
    "ip-addresses",
    (wb) => {
      wb.getWorksheet("IP地址")!.addRow(customerIpRow("10.99.1.10", "冲突客户", ""));
    },
    "已分配给客户「测试客户」",
  );
  const unexpectedIps = await prisma.ipAddress.findMany({
    where: { address: { in: ["10.99.1.20", "10.99.1.21", "10.99.1.22", "10.99.1.23"] } },
    select: { address: true },
  });
  if (unexpectedIps.length > 0) {
    throw new Error(`客户校验失败的 IP 不应写入：${unexpectedIps.map((ip) => ip.address).join(",")}`);
  }
  const still1010 = await prisma.resourceAllocation.findFirst({
    where: { resourceType: "ipAddress", ipAddressId: ip1010.id, releasedAt: null },
    select: { customerId: true },
  });
  if (still1010?.customerId !== testCustomer.id) {
    throw new Error("客户冲突的预校验不应改变原分配");
  }
  console.log("PASS 客户不存在/二级无一级/二级跨父级/IP 已分配其他客户均阻止导入");

  await expectImportError(
    "ip-addresses",
    (wb) => {
      const main = wb.getWorksheet("IP地址")!;
      main.addRow(customerIpRow("10.99.1.30", "测试客户", ""));
      main.addRow(customerIpRow("10.99.1.10", "冲突客户", ""));
    },
    "已分配给客户「测试客户」",
    true,
  );
  if (await prisma.ipAddress.findUnique({ where: { address: "10.99.1.30" } })) {
    throw new Error("真实导入失败后，首行新建的 IP 应回滚");
  }
  const afterRollback1010 = await prisma.resourceAllocation.findFirst({
    where: { resourceType: "ipAddress", ipAddressId: ip1010.id, releasedAt: null },
    select: { customerId: true },
  });
  if (afterRollback1010?.customerId !== testCustomer.id) {
    throw new Error("真实导入失败后，冲突 IP 的原分配应保持不变");
  }
  console.log("PASS 客户冲突时真实导入整批回滚");

  await prisma.$transaction(async (tx) => {
    await createAllocation(tx, {
      customerId: testCustomer.id,
      resourceType: "ipRange",
      resourceId: rangeBlock.id,
      ipList: "10.40.0.11",
    });
  });
  await importModule("ip-addresses", (wb) => {
    wb.getWorksheet("IP地址")!.addRow(
      customerIpRow("10.40.0.11", "测试客户", "", "10.40.0.0-10.40.0.15"),
    );
  });
  const rangeOwnedIp = await prisma.ipAddress.findUnique({ where: { address: "10.40.0.11" } });
  const rangeOwnedSingle = rangeOwnedIp
    ? await prisma.resourceAllocation.count({
        where: { resourceType: "ipAddress", ipAddressId: rangeOwnedIp.id, releasedAt: null },
      })
    : -1;
  if (!rangeOwnedIp || rangeOwnedIp.customerId !== testCustomer.id || rangeOwnedSingle !== 0) {
    throw new Error("区间已分配给同一客户时，IP 导入不应重复创建单 IP 分配");
  }
  console.log("PASS 区间归属同一客户时导入不重复分配");
  await expectImportError(
    "ip-addresses",
    (wb) => {
      wb.getWorksheet("IP地址")!.addRow(
        customerIpRow("10.40.0.11", "冲突客户", "", "10.40.0.0-10.40.0.15"),
      );
    },
    "已分配给客户「测试客户」",
  );

  const expectedIpColumns = [
    "address", "blockCidr", "status", "role", "supplierName",
    "customerLevel1", "customerLevel2",
    "rackCode", "deviceName", "lineCode", "isPrimary", "dnsName", "description", "assignedAt",
  ];
  const ipSheet = MODULES["ip-addresses"].sheets[0];
  if (!ipSheet) throw new Error("IP 地址模块缺少主表定义");
  const actualIpColumns = ipSheet.columns.map((column) => column.key);
  if (JSON.stringify(actualIpColumns) !== JSON.stringify(expectedIpColumns)) {
    throw new Error(`IP 地址模板列顺序不符：${actualIpColumns.join(",")}`);
  }
  const ipExport = await buildExportData("ip-addresses", new URLSearchParams());
  const exportedRows = ipExport.main ?? [];
  const exportedByAddress = new Map(exportedRows.map((row) => [String(row[0]), row]));
  const export1010 = exportedByAddress.get("10.99.1.10");
  const export1011 = exportedByAddress.get("10.99.1.11");
  const export104010 = exportedByAddress.get("10.40.0.10");
  if (
    export1010?.[5] !== "测试客户" ||
    export1010?.[6] !== null ||
    export1011?.[5] !== "测试客户" ||
    export1011?.[6] !== "测试二级客户" ||
    export104010?.[5] !== null ||
    export104010?.[6] !== null
  ) {
    throw new Error("IP 地址导出的客户列不正确");
  }
  console.log("PASS IP 地址导出包含一级/二级客户列");

  const expectedCustomerColumns: Record<string, string[]> = {
    vlans: [
      "vid", "name", "status", "supplierName",
      "customerLevel1", "customerLevel2", "description",
    ],
    vxlans: [
      "vni", "name", "status", "vlanVid", "supplierName",
      "customerLevel1", "customerLevel2", "description",
    ],
    devices: [
      "name", "type", "role", "status", "manufacturer", "model", "serialNo", "assetTag",
      "osVersion", "mac", "rackCode", "uStart", "uHeight", "face", "supplierName",
      "customerLevel1", "customerLevel2", "owner", "lastInventoryAt", "purchaseDate",
      "warrantyEnd", "managementIp", "notes",
    ],
    lines: [
      "code", "name", "type", "status", "supplierName",
      "customerLevel1", "customerLevel2", "bandwidthMbps", "monthlyFeeYuan",
      "circuitNo", "installDate", "expireDate", "description",
    ],
  };
  for (const [key, expected] of Object.entries(expectedCustomerColumns)) {
    const actual = MODULES[key].sheets[0].columns.map((column) => column.key);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${key} 模板列顺序不符：${actual.join(",")}`);
    }
  }
  for (const key of ["racks", "ip-blocks", "broadbands"]) {
    const keys = MODULES[key].sheets.flatMap((sheet) =>
      sheet.columns.map((column) => column.key),
    );
    if (keys.includes("customerLevel1") || keys.includes("customerLevel2")) {
      throw new Error(`${key} 模板不应包含客户绑定列`);
    }
  }

  const vlanExportRows = (await buildExportData("vlans", new URLSearchParams())).main ?? [];
  const vlanExport = vlanExportRows.find((row) => Number(row[0]) === 100);
  const vlanExport101 = vlanExportRows.find((row) => Number(row[0]) === 101);
  const vxlanExportRows = (await buildExportData("vxlans", new URLSearchParams())).main ?? [];
  const vxlanExport = vxlanExportRows.find((row) => Number(row[0]) === 10010);
  const deviceExportRows = (await buildExportData("devices", new URLSearchParams())).main ?? [];
  const deviceExport = deviceExportRows.find((row) => row[0] === "核心路由器-01");
  const lineExportRows = (await buildExportData("lines", new URLSearchParams())).main ?? [];
  const lineExport = lineExportRows.find((row) => row[0] === "LN-TEST-001");

  if (
    vlanExport?.[4] !== "测试客户" ||
    vlanExport?.[5] !== null ||
    vlanExport101?.[4] !== null ||
    vlanExport101?.[5] !== null ||
    vxlanExport?.[5] !== "测试客户" ||
    vxlanExport?.[6] !== "测试二级客户" ||
    deviceExport?.[15] !== "测试客户" ||
    deviceExport?.[16] !== null ||
    lineExport?.[5] !== "测试客户" ||
    lineExport?.[6] !== "测试二级客户"
  ) {
    throw new Error("VLAN/VXLAN/设备/线路导出的客户列不正确");
  }
  console.log("PASS VLAN/VXLAN/设备/线路导出包含一级/二级客户列");

  await importModule("broadbands", (wb) => {
    wb.getWorksheet("宽带")!.addRow([
      "BW-TEST-001", "中国电信", 1000, "正常", "2027-01-01", "bw-account", "bw-password", "测试地址",
      "A01", "核心路由器-01", "LN-TEST-001", "10.99.1.11", 1000, "HT-1", "测试宽带", "",
    ]);
  });

  await importModule("business-systems", (wb) => {
    wb.getWorksheet("业务系统")!.addRow([
      "计费系统", "BILL", "王五", "技术部", "生产", "核心", "在用", "https://bill.example.com", "bill.example.com", "2026-01-01", "",
    ]);
    wb.getWorksheet("访问端点")!.addRow(["计费系统", "10.99.1.11", 443, "TCP", "是", ""]);
  });

  await importModule("customer-tests", (wb) => {
    wb.getWorksheet("客户测试")!.addRow([
      "", "测试客户", "测试客户", "王五", "链路测试", "2026-11-01", "2026-11-08", "是", "否", "", "",
    ]);
  });

  const checks = {
    suppliers: await prisma.supplier.count(),
    customers: await prisma.customer.count(),
    salespeople: await prisma.salesperson.count(),
    boundCustomers: await prisma.customer.count({ where: { salespersonId: { not: null } } }),
    racks: await prisma.rack.count(),
    vlans: await prisma.vlan.count(),
    vxlans: await prisma.vxlan.count(),
    blocks: await prisma.ipBlock.count(),
    ips: await prisma.ipAddress.count(),
    devices: await prisma.device.count(),
    lines: await prisma.line.count(),
    broadbands: await prisma.broadband.count(),
    systems: await prisma.businessSystem.count(),
    tests: await prisma.customerTest.count(),
    primaryIps: await prisma.ipAddress.count({ where: { isPrimary: true } }),
    blockParents: await prisma.ipBlock.findMany({ select: { cidr: true, parent: { select: { cidr: true } } } }),
    nullSuppliers: {
      racks: await prisma.rack.count({ where: { supplierId: null } }),
      vlans: await prisma.vlan.count({ where: { supplierId: null } }),
      vxlans: await prisma.vxlan.count({ where: { supplierId: null } }),
      blocks: await prisma.ipBlock.count({ where: { supplierId: null } }),
      ips: await prisma.ipAddress.count({ where: { supplierId: null } }),
      devices: await prisma.device.count({ where: { supplierId: null } }),
      lines: await prisma.line.count({ where: { supplierId: null } }),
      broadbands: await prisma.broadband.count({ where: { supplierId: null } }),
    },
  };
  console.log("checks", JSON.stringify(checks, null, 2));

  for (const key of Object.keys(MODULES)) {
    const spec = MODULES[key];
    const data = await buildExportData(key, new URLSearchParams());
    const wb = await buildExportWorkbook(spec, data);
    const buf = await wb.xlsx.writeBuffer();
    console.log(`export ${key}: ${buf.byteLength} bytes, main rows=${data.main?.length ?? 0}`);
  }

  // 多个同编号区间：设备按 rackCode + uStart 唯一匹配。
  await importModule("racks", (wb) => {
    const main = wb.getWorksheet("机柜")!;
    main.addRow(["测试位置", "A20", "在用", "19", 1, 2, "", "", "中国电信", "多区间"]);
    main.addRow(["测试位置", "A20", "在用", "19", 3, 4, "", "", "中国电信", "多区间"]);
  });
  await importModule("devices", (wb) => {
    wb.getWorksheet("设备")!.addRow([
      "多区间设备", "交换机", "接入", "在用", "", "", "SN-MULTI-1", "", "", "",
      "A20", 3, 1, "前面板", "", "", "", "王五", "2026-11-01", "", "",
      "", "供应商由机柜继承",
    ]);
  });
  const matchedDevice = await prisma.device.findFirst({
    where: { name: "多区间设备" },
    include: { rack: { select: { code: true, uStart: true, uEnd: true } } },
  });
  if (matchedDevice?.rack?.code !== "A20" || matchedDevice.rack.uStart !== 3) {
    throw new Error("设备未按 rackCode + uStart 匹配到 A20 [3-4]U");
  }
  if (
    matchedDevice.customerId !== null ||
    (await prisma.resourceAllocation.count({
      where: { resourceType: "device", deviceId: matchedDevice.id, releasedAt: null },
    })) !== 0
  ) {
    throw new Error("客户列留空的设备不应创建分配");
  }
  console.log("PASS 设备按 rackCode + uStart 匹配多区间机柜，留空客户不分配");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
