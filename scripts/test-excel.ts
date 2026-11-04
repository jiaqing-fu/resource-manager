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
  try {
    await runWorkbookImport(parsed, user, true);
  } catch (error) {
    if (!(error instanceof ImportValidationError)) throw error;
    const hit = error.errors.find((e) => e.message.includes(expected));
    if (!hit) {
      console.error(`[${key}] unexpected errors`, error.errors.slice(0, 10));
      throw new Error(`expected error containing "${expected}" for ${key}`);
    }
    console.log(`PASS [${key}] 行级错误：${hit.message}`);
    return;
  }
  throw new Error(`expected import error for ${key}`);
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

  await importModule("racks", (wb) => {
    wb.getWorksheet("机柜")!.addRow([
      "测试位置", "A01", "在用", "19", 1, 42, "双路", "SN-RACK-1", "中国电信", "自动化测试",
    ]);
  });

  await importModule("vlans", (wb) => {
    wb.getWorksheet("VLAN")!.addRow([100, "业务VLAN", "在用", "中国电信", "自动化测试"]);
  });

  await importModule("vxlans", (wb) => {
    wb.getWorksheet("VXLAN")!.addRow([10010, "测试VXLAN", "在用", 100, "", "供应商由 VLAN 继承"]);
  });

  await importModule("ip-blocks", (wb) => {
    const main = wb.getWorksheet("IP段")!;
    main.addRow(["10.99.0.0/16", "在用", "内部", "", 100, "中国电信", "", "测试父段", ""]);
    main.addRow(["10.99.1.0/24", "在用", "内部", "10.99.0.0/16", 100, "", "10.99.1.1", "测试子段", ""]);
  });

  await importModule("devices", (wb) => {
    wb.getWorksheet("设备")!.addRow([
      "核心路由器-01", "路由器", "核心", "在用", "MikroTik", "CCR2004", "SN-DEV-1", "AT-1", "7.15", "AA:BB:CC:DD:EE:FF",
      "A01", 1, 1, "前面板", "", "王五", "2026-11-01", "2026-01-01", "2028-01-01",
      "", "供应商由机柜继承",
    ]);
  });

  await importModule("lines", (wb) => {
    wb.getWorksheet("线路")!.addRow([
      "LN-TEST-001", "测试线路", "互联网", "在用", "中国电信", 100, 1000, "CIR-1", "2026-01-01", "2027-01-01", "",
    ]);
    wb.getWorksheet("线路端点")!.addRow([
      "LN-TEST-001", "A 端", "A01", "核心路由器-01", "ether1", "",
    ]);
  });

  await importModule("ip-addresses", (wb) => {
    const main = wb.getWorksheet("IP地址")!;
    main.addRow(["10.99.1.10", "10.99.1.0/24", "在用", "管理", "", "A01", "核心路由器-01", "", "否", "core-1", "", "2026-11-01"]);
    main.addRow(["10.99.1.11", "10.99.1.0/24", "在用", "客户", "中国电信", "", "", "LN-TEST-001", "否", "srv-1", "", "2026-11-01"]);
  });

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
      "A20", 3, 1, "前面板", "", "王五", "2026-11-01", "", "",
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
  console.log("PASS 设备按 rackCode + uStart 匹配多区间机柜");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
