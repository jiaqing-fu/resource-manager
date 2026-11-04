import { NextRequest } from "next/server";
import { ApiError, handleApiError, requireUser } from "@/lib/api";
import { moduleSpec } from "@/lib/excel/specs";
import { buildExportWorkbook, exportFilename } from "@/lib/excel/template";
import { buildExportData } from "@/server/services/excel-export";
import { xlsxResponse } from "@/lib/excel/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ module: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { module } = await params;
    const spec = moduleSpec(module);
    if (!spec) throw new ApiError(404, "导出模块不存在", "MODULE_NOT_FOUND");

    const data = await buildExportData(spec.key, req.nextUrl.searchParams);
    const workbook = await buildExportWorkbook(spec, data);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return xlsxResponse(buffer, exportFilename(spec));
  } catch (error) {
    return handleApiError(error);
  }
}
