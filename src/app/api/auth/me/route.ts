import { NextRequest } from "next/server";
import { handleApiError, jsonOk, requireUser } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    return jsonOk({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
