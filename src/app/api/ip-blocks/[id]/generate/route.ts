import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { handleApiError, jsonOk, readJson, requireUser } from "@/lib/api";
import { IP_ADDRESS_ROLES, IP_ADDRESS_STATUS } from "@/lib/enums";
import { generateAddresses } from "@/server/services/ipam";
import { writeChangeLog } from "@/lib/changelog";
import { optionalText, zEnum } from "@/lib/validators";

export const dynamic = "force-dynamic";

const schema = z.object({
  count: z.coerce.number().int().min(1, "至少生成 1 个").max(4096, "单次最多生成 4096 个").default(10),
  status: zEnum(IP_ADDRESS_STATUS, "IP 状态").default("active"),
  role: zEnum(IP_ADDRESS_ROLES, "IP 角色").default("other"),
  description: optionalText(500),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = schema.parse(await readJson(req));
    const result = await prisma.$transaction(async (tx) => {
      const generated = await generateAddresses(tx, id, body);
      await writeChangeLog(tx, {
        user,
        resource: "ipAddress",
        recordId: id,
        action: "CREATE",
        summary: `在 IP 段中批量生成 ${generated.created} 个 IP（${generated.first} ~ ${generated.last}）`,
        after: generated,
      });
      return generated;
    });
    return jsonOk(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
