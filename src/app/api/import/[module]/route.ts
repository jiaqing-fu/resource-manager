import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleApiError, requireAdmin } from "@/lib/api";
import { moduleSpec } from "@/lib/excel/specs";
import {
  MAX_IMPORT_BYTES,
  parseWorkbookBuffer,
} from "@/lib/excel/parse";
import {
  ImportValidationError,
  runWorkbookImport,
} from "@/server/services/excel-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ module: string }> };

function isUploadFile(value: unknown): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
    "name" in value &&
    "size" in value
  );
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAdmin(req);
    const { module } = await params;
    const spec = moduleSpec(module);
    if (!spec) throw new ApiError(404, "导入模块不存在", "MODULE_NOT_FOUND");

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiError(400, "上传内容格式不正确", "BAD_UPLOAD");
    }
    const file = form.get("file");
    if (!isUploadFile(file)) {
      throw new ApiError(400, "请选择要上传的 .xlsx 文件", "FILE_REQUIRED");
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      throw new ApiError(400, "仅支持 .xlsx 格式的 Excel 文件", "INVALID_FILE_TYPE");
    }
    if (file.size <= 0) {
      throw new ApiError(400, "上传文件为空", "EMPTY_FILE");
    }
    if (file.size > MAX_IMPORT_BYTES) {
      throw new ApiError(413, "文件不能超过 5MB", "FILE_TOO_LARGE");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseWorkbookBuffer(buffer, spec);
    if (parsed.errors.length > 0) {
      throw new ImportValidationError(parsed.errors);
    }
    const dryRunParam = req.nextUrl.searchParams.get("dryRun");
    const dryRun = dryRunParam === "1" || dryRunParam === "true";
    const result = await runWorkbookImport(parsed, user, dryRun);
    return NextResponse.json({
      dryRun: result.dryRun,
      committed: !result.dryRun,
      ...result.summary,
    });
  } catch (error) {
    if (error instanceof ImportValidationError) {
      return NextResponse.json(
        {
          error: {
            code: "IMPORT_VALIDATION_FAILED",
            message: error.message,
            errors: error.errors,
          },
        },
        { status: 422 },
      );
    }
    return handleApiError(error);
  }
}
