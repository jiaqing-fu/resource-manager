import { NextRequest } from "next/server";
import { ApiError, handleApiError, requireUser } from "@/lib/api";
import { moduleSpec } from "@/lib/excel/specs";
import { templateBuffer, templateFilename } from "@/lib/excel/template";
import { xlsxResponse } from "@/lib/excel/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ module: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { module } = await params;
    const spec = moduleSpec(module);
    if (!spec) throw new ApiError(404, "模板模块不存在", "MODULE_NOT_FOUND");
    const buffer = await templateBuffer(spec);
    return xlsxResponse(buffer, templateFilename(spec));
  } catch (error) {
    return handleApiError(error);
  }
}
