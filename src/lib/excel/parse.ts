import ExcelJS from "exceljs";
import { isValidDateStr } from "@/lib/dates";
import {
  displayHeader,
  MODULES,
  normalizeHeader,
  type ColumnSpec,
  type ModuleSpec,
  type SheetSpec,
} from "@/lib/excel/specs";

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type ImportCellError = {
  sheet: string;
  row: number;
  column: string;
  message: string;
  value: string;
};

export type ParsedCell = string | number | boolean | null;

export type ParsedRow = {
  sheetKey: string;
  sheetName: string;
  rowNumber: number;
  values: Record<string, ParsedCell>;
};

export type ParsedWorkbook = {
  spec: ModuleSpec;
  sheets: Record<string, ParsedRow[]>;
  errors: ImportCellError[];
  totalRows: number;
};

type CellLike = ExcelJS.CellValue | undefined;

function richTextValue(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.richText)) {
    return obj.richText
      .map((part) => {
        if (typeof part === "object" && part && "text" in part) {
          return String((part as { text: unknown }).text);
        }
        return "";
      })
      .join("");
  }
  if ("result" in obj) return cellString(obj.result as CellLike);
  if (typeof obj.text === "string") return obj.text;
  if ("error" in obj) return String(obj.error);
  return null;
}

/** 将 ExcelJS 单元格值转为去空格后的文本；日期按 UTC 日期部分输出。 */
export function cellString(value: CellLike): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const rich = richTextValue(value);
  return rich === null ? "" : rich.trim();
}

function isFormulaObject(value: unknown): value is { result?: CellLike } {
  return typeof value === "object" && value !== null && "formula" in value;
}

function rawValue(value: CellLike): CellLike {
  if (isFormulaObject(value)) return value.result ?? null;
  return value;
}

function excelSerialToDateStr(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const ms = Math.round((serial - 25569) * 86_400_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseDateValue(value: CellLike): { value: string | null; error?: string } {
  const v = rawValue(value);
  if (v === null || v === undefined || v === "") return { value: null };
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { value: null, error: "日期无效" };
    return { value: v.toISOString().slice(0, 10) };
  }
  if (typeof v === "number") {
    const s = excelSerialToDateStr(v);
    return s ? { value: s } : { value: null, error: "日期无效" };
  }
  const s = cellString(v);
  if (!s) return { value: null };
  if (isValidDateStr(s)) return { value: s };
  return { value: null, error: `日期须为 YYYY-MM-DD，当前值「${s}」` };
}

function parseEnumValue(col: ColumnSpec, text: string): { value: string | null; error?: string } {
  const options = col.options ?? [];
  const found =
    options.find((o) => o.label === text) ??
    options.find((o) => o.value.toLowerCase() === text.toLowerCase());
  if (found) return { value: found.value };
  return {
    value: null,
    error: `「${text}」不是有效选项，可选：${options.map((o) => o.label).join("、")}`,
  };
}

function parseBooleanValue(text: string): { value: boolean | null; error?: string } {
  const s = text.toLowerCase();
  if (["是", "true", "1", "y", "yes", "√"].includes(s)) return { value: true };
  if (["否", "false", "0", "n", "no", "×"].includes(s)) return { value: false };
  return { value: null, error: `只能填写“是”或“否”，当前值「${text}」` };
}

function coerceCell(
  col: ColumnSpec,
  value: CellLike,
): { value: ParsedCell; error?: string } {
  const v = rawValue(value);
  const blank = v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  if (blank) return { value: null };

  if (col.type === "date") return parseDateValue(v);

  const text = cellString(v);
  if (!text) return { value: null };

  if (col.type === "text" || col.type === "ref") {
    // 导出时为防公式注入会加单引号前缀，回导时还原。
    const unescaped = /^'[=+\-@\t\r]/.test(text) ? text.slice(1) : text;
    return { value: unescaped };
  }

  if (col.type === "enum") {
    return parseEnumValue(col, text);
  }

  if (col.type === "boolean") {
    return parseBooleanValue(text);
  }

  if (col.type === "int" || col.type === "number") {
    const normalized = text.replace(/,/g, "").replace(/，/g, "");
    const n = Number(normalized);
    if (!Number.isFinite(n)) {
      return { value: null, error: `「${text}」不是有效数字` };
    }
    if (col.type === "int" && !Number.isInteger(n)) {
      return { value: null, error: `「${text}」必须是整数` };
    }
    if (col.max !== undefined && Math.abs(n) > col.max) {
      return { value: null, error: `数值不能超过 ${col.max}` };
    }
    return { value: n };
  }

  return { value: text };
}

function rowIsEmpty(row: ExcelJS.Row, count: number): boolean {
  for (let i = 1; i <= count; i++) {
    if (cellString(row.getCell(i).value) !== "") return false;
  }
  return true;
}

function verifyHeaders(
  ws: ExcelJS.Worksheet,
  sheet: SheetSpec,
  errors: ImportCellError[],
): boolean {
  let ok = true;
  const expected = sheet.columns.map((c) => displayHeader(c));
  const width = Math.max(ws.columnCount, expected.length);
  for (let i = 1; i <= width; i++) {
    const actual = cellString(ws.getRow(1).getCell(i).value);
    const wanted = expected[i - 1] ?? "";
    if (normalizeHeader(actual) !== normalizeHeader(wanted)) {
      errors.push({
        sheet: sheet.name,
        row: 1,
        column: i <= expected.length ? expected[i - 1] : `第 ${i} 列`,
        message: wanted
          ? `表头不一致：应为「${wanted}」，实际为「${actual || "空"}」`
          : `存在多余列「${actual}」，请删除或使用标准模板`,
        value: actual,
      });
      ok = false;
    }
  }
  return ok;
}

function verifyTemplateInfo(
  wb: ExcelJS.Workbook,
  spec: ModuleSpec,
  errors: ImportCellError[],
): boolean {
  const info = wb.getWorksheet("模板信息");
  if (!info) {
    errors.push({
      sheet: "模板信息",
      row: 1,
      column: "模块",
      message: "无法识别该文件：缺少模板信息页。请从系统下载标准模板后填写。",
      value: "",
    });
    return false;
  }
  const moduleKey = cellString(info.getCell("B1").value);
  const version = cellString(info.getCell("B2").value);
  let ok = true;
  if (moduleKey !== spec.key) {
    const other = MODULES[moduleKey];
    errors.push({
      sheet: "模板信息",
      row: 1,
      column: "模块",
      message: other
        ? `该文件是「${other.label}」模板，不能导入到「${spec.label}」。`
        : `模板模块标识「${moduleKey || "空"}」不匹配，请重新下载模板。`,
      value: moduleKey,
    });
    ok = false;
  }
  if (version !== spec.version) {
    errors.push({
      sheet: "模板信息",
      row: 1,
      column: "版本",
      message: `模板版本「${version || "空"}」与当前版本「${spec.version}」不一致，请重新下载模板。`,
      value: version,
    });
    ok = false;
  }
  return ok;
}

export async function parseWorkbookBuffer(
  buffer: Buffer,
  spec: ModuleSpec,
): Promise<ParsedWorkbook> {
  const errors: ImportCellError[] = [];
  const sheets: Record<string, ParsedRow[]> = {};
  let totalRows = 0;

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    errors.push({
      sheet: "-",
      row: 0,
      column: "-",
      message: "无法解析该文件，请确认是 .xlsx 格式且未损坏。",
      value: "",
    });
    return { spec, sheets, errors, totalRows };
  }

  const infoOk = verifyTemplateInfo(wb, spec, errors);

  for (const sheet of spec.sheets) {
    sheets[sheet.key] = [];
    const ws = wb.getWorksheet(sheet.name);
    if (!ws) {
      errors.push({
        sheet: sheet.name,
        row: 0,
        column: "-",
        message: `缺少工作表「${sheet.name}」，请使用标准模板。`,
        value: "",
      });
      continue;
    }
    if (!infoOk) continue;
    if (!verifyHeaders(ws, sheet, errors)) continue;

    const lastRow = Math.max(ws.rowCount, 1);
    for (let r = 2; r <= lastRow; r++) {
      const row = ws.getRow(r);
      if (rowIsEmpty(row, sheet.columns.length)) continue;
      if (totalRows >= MAX_IMPORT_ROWS) {
        errors.push({
          sheet: sheet.name,
          row: r,
          column: "-",
          message: `数据行数超过上限 ${MAX_IMPORT_ROWS} 行，请分批导入。`,
          value: "",
        });
        break;
      }
      totalRows++;
      const values: Record<string, ParsedCell> = {};
      let rowHasError = false;
      sheet.columns.forEach((col, idx) => {
        const cellValue = row.getCell(idx + 1).value;
        const result = coerceCell(col, cellValue);
        if (result.error) {
          errors.push({
            sheet: sheet.name,
            row: r,
            column: col.header,
            message: result.error,
            value: cellString(cellValue),
          });
          rowHasError = true;
          values[col.key] = null;
          return;
        }
        if (
          col.required &&
          (result.value === null || result.value === "")
        ) {
          errors.push({
            sheet: sheet.name,
            row: r,
            column: col.header,
            message: "必填项不能为空",
            value: "",
          });
          rowHasError = true;
        }
        values[col.key] = result.value;
      });
      if (rowHasError) continue;
      sheets[sheet.key].push({
        sheetKey: sheet.key,
        sheetName: sheet.name,
        rowNumber: r,
        values,
      });
    }
  }

  if (errors.length === 0 && totalRows === 0) {
    errors.push({
      sheet: "-",
      row: 0,
      column: "-",
      message: "模板中没有可导入的数据行。",
      value: "",
    });
  }

  return { spec, sheets, errors, totalRows };
}
