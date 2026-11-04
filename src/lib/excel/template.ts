import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { fileStamp, formatDateTime } from "@/lib/dates";
import {
  IP_ADDRESS_STATUS,
  IP_BLOCK_STATUS,
  labelOf,
  LINE_STATUS,
  PARTY_LEVELS,
  PARTY_STATUS,
  SUPPLIER_CATEGORIES,
} from "@/lib/enums";
import {
  displayHeader,
  type ColumnSpec,
  type ModuleSpec,
  type RefKind,
  type SheetSpec,
} from "@/lib/excel/specs";

type RefRow = {
  type: string;
  level: string;
  parent: string;
  name: string;
  extra: string;
};

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F4E79" },
};

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFBFBFBF" } },
      left: { style: "thin", color: { argb: "FFBFBFBF" } },
      bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
      right: { style: "thin", color: { argb: "FFBFBFBF" } },
    };
  });
  row.height = 28;
}

function styleBodyCell(cell: ExcelJS.Cell) {
  cell.alignment = { vertical: "middle", wrapText: false };
  cell.border = {
    top: { style: "thin", color: { argb: "FFE0E0E0" } },
    left: { style: "thin", color: { argb: "FFE0E0E0" } },
    bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
    right: { style: "thin", color: { argb: "FFE0E0E0" } },
  };
}

function columnLetter(index: number): string {
  let n = index;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export async function loadReferenceRows(kinds: RefKind[]): Promise<RefRow[]> {
  const rows: RefRow[] = [];
  const unique = Array.from(new Set(kinds));

  for (const kind of unique) {
    if (kind === "supplier") {
      const list = await prisma.supplier.findMany({
        include: { parent: { select: { name: true } } },
        orderBy: [{ level: "asc" }, { name: "asc" }],
      });
      for (const s of list) {
        rows.push({
          type: "供应商",
          level: labelOf(PARTY_LEVELS, s.level),
          parent: s.parent?.name ?? "",
          name: s.name,
          extra: `${labelOf(SUPPLIER_CATEGORIES, s.category)} / ${labelOf(PARTY_STATUS, s.status)}`,
        });
      }
    } else if (kind === "customer") {
      const list = await prisma.customer.findMany({
        include: {
          parent: { select: { name: true } },
          salesperson: { select: { name: true } },
        },
        orderBy: [{ level: "asc" }, { name: "asc" }],
      });
      for (const c of list) {
        rows.push({
          type: "客户",
          level: labelOf(PARTY_LEVELS, c.level),
          parent: c.parent?.name ?? "",
          name: c.name,
          extra: `${labelOf(PARTY_STATUS, c.status)}${
            c.salesperson ? ` / ${c.salesperson.name}` : ""
          }`,
        });
      }
    } else if (kind === "salesperson") {
      const list = await prisma.salesperson.findMany({
        orderBy: [{ status: "asc" }, { name: "asc" }],
      });
      for (const s of list) {
        rows.push({
          type: "业务员",
          level: "",
          parent: "",
          name: s.name,
          extra: `${labelOf(PARTY_STATUS, s.status)}${s.phone ? ` / ${s.phone}` : ""}`,
        });
      }
    } else if (kind === "rack") {
      const list = await prisma.rack.findMany({
        orderBy: [{ location: "asc" }, { code: "asc" }, { uStart: "asc" }],
      });
      for (const r of list) {
        rows.push({
          type: "机柜",
          level: "",
          parent: r.location ?? "",
          name: r.code,
          extra: `[${r.uStart}-${r.uEnd}]U`,
        });
      }
    } else if (kind === "vlan") {
      const list = await prisma.vlan.findMany({
        include: { supplier: { select: { name: true } } },
        orderBy: [{ vid: "asc" }],
      });
      for (const v of list) {
        rows.push({
          type: "VLAN",
          level: "",
          parent: v.supplier?.name ?? "",
          name: String(v.vid),
          extra: v.name,
        });
      }
    } else if (kind === "ipBlock") {
      const list = await prisma.ipBlock.findMany({ orderBy: { cidr: "asc" } });
      for (const b of list) {
        rows.push({
          type: "IP段",
          level: "",
          parent: "",
          name: b.cidr,
          extra: labelOf(IP_BLOCK_STATUS, b.status),
        });
      }
    } else if (kind === "ipAddress") {
      const list = await prisma.ipAddress.findMany({
        include: { block: { select: { cidr: true } } },
        orderBy: { address: "asc" },
        take: 5000,
      });
      for (const ip of list) {
        rows.push({
          type: "IP地址",
          level: "",
          parent: ip.block?.cidr ?? "",
          name: ip.address,
          extra: labelOf(IP_ADDRESS_STATUS, ip.status),
        });
      }
    } else if (kind === "device") {
      const list = await prisma.device.findMany({ orderBy: { name: "asc" } });
      for (const d of list) {
        rows.push({
          type: "设备",
          level: "",
          parent: "",
          name: d.name,
          extra: [d.manufacturer, d.model, d.serialNo].filter(Boolean).join(" / "),
        });
      }
    } else if (kind === "line") {
      const list = await prisma.line.findMany({ orderBy: { code: "asc" } });
      for (const l of list) {
        rows.push({
          type: "线路",
          level: "",
          parent: "",
          name: l.code,
          extra: `${l.name} / ${labelOf(LINE_STATUS, l.status)}`,
        });
      }
    } else if (kind === "system") {
      const list = await prisma.businessSystem.findMany({ orderBy: { name: "asc" } });
      for (const s of list) {
        rows.push({
          type: "业务系统",
          level: "",
          parent: "",
          name: s.name,
          extra: [s.code, s.owner].filter(Boolean).join(" / "),
        });
      }
    }
  }
  return rows;
}

function addInstructionsSheet(wb: ExcelJS.Workbook, spec: ModuleSpec) {
  const ws = wb.addWorksheet("填写说明", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  ws.columns = [
    { width: 22 },
    { width: 10 },
    { width: 16 },
    { width: 70 },
  ];
  ws.mergeCells("A1:D1");
  ws.getCell("A1").value = `${spec.label} — 标准导入模板`;
  ws.getCell("A1").font = { size: 16, bold: true, color: { argb: "FF1F4E79" } };
  ws.getRow(1).height = 28;

  ws.mergeCells("A2:D2");
  ws.getCell("A2").value =
    `模板版本 ${spec.version} ｜ 生成时间 ${formatDateTime(new Date())} ｜ 单次最多 5000 行 / 5MB ｜ 日期格式 YYYY-MM-DD`;
  ws.getCell("A2").font = { size: 10, color: { argb: "FF666666" } };

  ws.mergeCells("A3:D3");
  ws.getCell("A3").value = `导入提示：${spec.importHint}`;
  ws.getCell("A3").font = { size: 10, color: { argb: "FF9C6500" } };

  let rowNo = 5;
  for (const sheet of spec.sheets) {
    ws.mergeCells(rowNo, 1, rowNo, 4);
    ws.getCell(rowNo, 1).value = `工作表「${sheet.name}」：${sheet.description}`;
    ws.getCell(rowNo, 1).font = { bold: true, size: 11, color: { argb: "FF1F4E79" } };
    rowNo++;

    const header = ws.getRow(rowNo);
    header.values = ["列名", "必填", "类型", "说明 / 示例"];
    styleHeader(header);
    rowNo++;

    for (const col of sheet.columns) {
      const typeLabel: Record<ColumnSpec["type"], string> = {
        text: "文本",
        int: "整数",
        number: "数字",
        date: "日期",
        enum: "枚举",
        boolean: "是/否",
        ref: "引用",
      };
      let note = col.note ?? "";
      if (col.type === "enum" && col.options) {
        note = `${note ? `${note} ` : ""}可选值：${col.options.map((o) => o.label).join("、")}`;
      }
      if (col.type === "ref" && !note) {
        note = "填写“参考数据”工作表中的对应名称/编号";
      }
      if (col.example) note = `${note ? `${note} ` : ""}示例：${col.example}`;
      const row = ws.getRow(rowNo);
      row.values = [displayHeader(col), col.required ? "是" : "否", typeLabel[col.type], note];
      row.eachCell((cell) => styleBodyCell(cell));
      row.getCell(1).font = { bold: Boolean(col.required) };
      rowNo++;
    }
    rowNo++;
  }

  ws.mergeCells(rowNo, 1, rowNo, 4);
  ws.getCell(rowNo, 1).value = "填写规则";
  ws.getCell(rowNo, 1).font = { bold: true, size: 11, color: { argb: "FF1F4E79" } };
  rowNo++;
  const rules = [
    "请勿修改工作表名称、表头文字、列顺序或删除列；否则导入会失败。",
    "带 * 的列为必填项；枚举列请使用下拉选项中的中文值。",
    "引用列按“参考数据”工作表中的名称填写；重名或找不到引用时会报错。",
    "日期统一填写 YYYY-MM-DD（例如 2026-11-01），不要使用“2026年11月1日”。",
    "导入前先执行校验（dryRun），返回逐行错误；全部通过后才会在事务中一次性写入，任何一行失败都不会写入数据。",
    "已存在的记录按自然键更新（供应商/客户按层级+上级+名称，IP 按地址，IP 段按 CIDR，线路按编号等）。",
    "本模板由系统生成，请勿传给不同模块使用；模板版本变化后请重新下载。",
  ];
  for (const rule of rules) {
    ws.mergeCells(rowNo, 1, rowNo, 4);
    ws.getCell(rowNo, 1).value = `· ${rule}`;
    ws.getCell(rowNo, 1).alignment = { wrapText: true, vertical: "top" };
    rowNo++;
  }

  // 示例行（放在说明页，不混入数据页）
  rowNo++;
  ws.mergeCells(rowNo, 1, rowNo, 4);
  ws.getCell(rowNo, 1).value = "示例行（仅示意，不会导入）";
  ws.getCell(rowNo, 1).font = { bold: true, size: 11, color: { argb: "FF1F4E79" } };
  rowNo++;
  for (const sheet of spec.sheets) {
    const headers = sheet.columns.map((c) => displayHeader(c));
    const values = sheet.columns.map((c) => c.example ?? "");
    const hRow = ws.getRow(rowNo);
    hRow.values = [`[${sheet.name}]`, "", "", ""];
    hRow.getCell(1).font = { italic: true, color: { argb: "FF666666" } };
    rowNo++;
    const exampleRow = ws.getRow(rowNo);
    ws.mergeCells(rowNo, 1, rowNo, 4);
    exampleRow.getCell(1).value = headers
      .map((h, i) => `${h}: ${values[i] || "—"}`)
      .join(" ｜ ");
    exampleRow.getCell(1).alignment = { wrapText: true, vertical: "top" };
    rowNo++;
  }
}

function addDataSheet(wb: ExcelJS.Workbook, sheet: SheetSpec) {
  const ws = wb.addWorksheet(sheet.name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = sheet.columns.map((col) => ({
    header: displayHeader(col),
    key: col.key,
    width: col.width ?? 18,
  }));
  styleHeader(ws.getRow(1));
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columns.length },
  };
  ws.getRow(1).height = 30;

  const dv = (ws as unknown as {
    dataValidations: {
      add: (address: string, validation: ExcelJS.DataValidation) => void;
    };
  }).dataValidations;

  sheet.columns.forEach((col, idx) => {
    const letter = columnLetter(idx + 1);
    const range = `${letter}2:${letter}5001`;
    if (col.type === "enum" || col.type === "boolean") {
      if (!col.options) return;
      const list = col.options.map((o) => o.label).join(",");
      dv.add(range, {
        type: "list",
        allowBlank: true,
        formulae: [`"${list}"`],
        showErrorMessage: true,
        errorTitle: "取值不合法",
        error: `请从下拉列表中选择：${col.options.map((o) => o.label).join("、")}`,
        showInputMessage: true,
        promptTitle: col.header,
        prompt: col.options.map((o) => o.label).join(" / "),
      });
    } else if (col.type === "date") {
      dv.add(range, {
        type: "date",
        operator: "between",
        allowBlank: true,
        formulae: [new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2100, 11, 31))],
        showErrorMessage: true,
        errorTitle: "日期格式不正确",
        error: "请填写 YYYY-MM-DD 格式的有效日期，例如 2026-11-01。",
        showInputMessage: true,
        promptTitle: col.header,
        prompt: "格式：YYYY-MM-DD，例如 2026-11-01",
      });
    }
  });
  return ws;
}

function addReferenceSheet(wb: ExcelJS.Workbook, rows: RefRow[]) {
  if (rows.length === 0) return;
  const ws = wb.addWorksheet("参考数据", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = [
    { header: "类型", key: "type", width: 12 },
    { header: "层级", key: "level", width: 10 },
    { header: "上级 / 位置", key: "parent", width: 24 },
    { header: "名称 / 编号", key: "name", width: 32 },
    { header: "附加信息", key: "extra", width: 36 },
  ];
  styleHeader(ws.getRow(1));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } };
  for (const r of rows) {
    const row = ws.addRow(r);
    row.eachCell((cell) => styleBodyCell(cell));
  }
}

export async function buildTemplateWorkbook(spec: ModuleSpec): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "技术部资源管理系统";
  wb.created = new Date();

  const info = wb.addWorksheet("模板信息");
  info.state = "veryHidden";
  info.getCell("A1").value = "模块";
  info.getCell("B1").value = spec.key;
  info.getCell("A2").value = "版本";
  info.getCell("B2").value = spec.version;
  info.getCell("A3").value = "生成时间";
  info.getCell("B3").value = formatDateTime(new Date());

  addInstructionsSheet(wb, spec);
  for (const sheet of spec.sheets) addDataSheet(wb, sheet);
  addReferenceSheet(wb, await loadReferenceRows(spec.refs));
  return wb;
}

export async function templateBuffer(spec: ModuleSpec): Promise<Buffer> {
  const wb = await buildTemplateWorkbook(spec);
  const data = await wb.xlsx.writeBuffer();
  return Buffer.from(data);
}

export function templateFilename(spec: ModuleSpec): string {
  return `${spec.label.replace(/[\\/:*?"<>|]/g, "_")}-标准模板-${fileStamp()}.xlsx`;
}

export function exportFilename(spec: ModuleSpec): string {
  return `${spec.label.replace(/[\\/:*?"<>|]/g, "_")}-导出-${fileStamp()}.xlsx`;
}

/** 导出时按模板结构写入数据；行值顺序与模板列一致。 */
export async function buildExportWorkbook(
  spec: ModuleSpec,
  data: Record<string, Array<Array<string | number | boolean | null>>>,
): Promise<ExcelJS.Workbook> {
  const wb = await buildTemplateWorkbook(spec);
  for (const sheet of spec.sheets) {
    const ws = wb.getWorksheet(sheet.name);
    if (!ws) continue;
    const rows = data[sheet.key] ?? [];
    rows.forEach((values) => {
      const row = ws.addRow(values);
      row.eachCell((cell) => styleBodyCell(cell));
    });
  }
  return wb;
}

export type { RefRow };
