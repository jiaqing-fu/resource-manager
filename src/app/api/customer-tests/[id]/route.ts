import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, readJson, requireAdmin, requireUser } from "@/lib/api";
import { customerTestUpdateSchema } from "@/lib/customer-test-schema";
import { computeTestStatus } from "@/server/services/status";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const test = await prisma.customerTest.findUnique({
      where: { id },
      include: { customer: { select: { id: true, name: true, level: true } } },
    });
    if (!test) throw new ApiError(404, "测试记录不存在", "NOT_FOUND");
    return jsonOk({ ...test, displayStatus: computeTestStatus(test) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = customerTestUpdateSchema.parse(await readJson(req));
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.customerTest.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "测试记录不存在", "NOT_FOUND");

      const startAt = body.startAt ?? existing.startAt;
      const endAt = body.endAt ?? existing.endAt;
      if (endAt < startAt) {
        throw new ApiError(422, "测试结束时间不能早于开始时间", "INVALID_DATE_RANGE");
      }
      const converted = body.converted ?? existing.converted;
      const accepted = converted ? true : body.accepted ?? existing.accepted;

      const data: Record<string, unknown> = { startAt, endAt, converted, accepted };
      for (const key of [
        "customerId",
        "companyName",
        "salesperson",
        "content",
        "status",
        "notes",
      ] as const) {
        if (body[key] !== undefined) data[key] = body[key];
      }
      const test = await tx.customerTest.update({
        where: { id },
        data,
        include: { customer: { select: { id: true, name: true } } },
      });
      await writeChangeLog(tx, {
        user,
        resource: "customerTest",
        recordId: id,
        action: "UPDATE",
        summary: `修改客户测试 #${test.seqNo} ${test.companyName}`,
        before: existing,
        after: test,
      });
      return test;
    });
    return jsonOk({ ...updated, displayStatus: computeTestStatus(updated) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAdmin(req);
    const { id } = await params;
    await prisma.$transaction(async (tx) => {
      const existing = await tx.customerTest.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, "测试记录不存在", "NOT_FOUND");
      await tx.customerTest.delete({ where: { id } });
      await writeChangeLog(tx, {
        user,
        resource: "customerTest",
        recordId: id,
        action: "DELETE",
        summary: `删除客户测试 #${existing.seqNo} ${existing.companyName}`,
        before: existing,
      });
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
