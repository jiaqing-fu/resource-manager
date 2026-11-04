import { NextRequest } from "next/server";
import { handleApiError, jsonOk, requireUser } from "@/lib/api";
import { MODULES } from "@/lib/excel/specs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const items = Object.values(MODULES).map((spec) => ({
      key: spec.key,
      label: spec.label,
      version: spec.version,
      importHint: spec.importHint,
      refs: spec.refs,
      sheets: spec.sheets.map((sheet) => ({
        key: sheet.key,
        name: sheet.name,
        description: sheet.description,
        columns: sheet.columns.map((col) => ({
          key: col.key,
          header: col.header,
          required: Boolean(col.required),
          type: col.type,
          options: col.options?.map((o) => o.label) ?? null,
        })),
      })),
    }));
    return jsonOk({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
