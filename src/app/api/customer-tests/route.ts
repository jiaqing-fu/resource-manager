import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  ApiError,
  getPaging,
  handleApiError,
  jsonOk,
  listResult,
  queryValue,
  readJson,
  requireUser,
} from "@/lib/api";
import { customerTestSchema } from "@/lib/customer-test-schema";
import { addDays, todayStr } from "@/lib/dates";
import { computeTestStatus, testStatusWhere } from "@/server/services/status";
import { writeChangeLog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const paging = getPaging(req);
    const and: Record<string, unknown>[] = [];
    if (paging.keyword) {
      and.push({
        OR: [
          { companyName: { contains: paging.keyword } },
          { salesperson: { contains: paging.keyword } },
          { content: { contains: paging.keyword } },
          { notes: { contains: paging.keyword } },
        ],
      });
    }
    const status = queryValue(req, "status");
    if (status) and.push(testStatusWhere(status));
    const customerId = queryValue(req, "customerId");
    if (customerId) and.push({ customerId });
    const salesperson = queryValue(req, "salesperson");
    if (salesperson) and.push({ salesperson });
    const accepted = queryValue(req, "accepted");
    if (accepted === "true" || accepted === "false") and.push({ accepted: accepted === "true" });
    const converted = queryValue(req, "converted");
    if (converted === "true" || converted === "false") and.push({ converted: converted === "true" });
    const endFrom = queryValue(req, "endFrom");
    const endTo = queryValue(req, "endTo");
    if (endFrom || endTo) {
      and.push({
        endAt: {
          ...(endFrom ? { gte: endFrom } : {}),
          ...(endTo ? { lte: endTo } : {}),
        },
      });
    }
    const where = and.length > 0 ? { AND: and } : {};

    const [rows, total] = await Promise.all([
      prisma.customerTest.findMany({
        where,
        orderBy: [{ endAt: "desc" }, { seqNo: "desc" }],
        skip: paging.skip,
        take: paging.pageSize,
        include: { customer: { select: { id: true, name: true } } },
      }),
      prisma.customerTest.count({ where }),
    ]);
    const today = todayStr();
    const items = rows.map((r) => ({
      ...r,
      displayStatus: computeTestStatus(r, today),
    }));
    return jsonOk(listResult(items, total, paging));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = customerTestSchema.parse(await readJson(req));
    const startAt = body.startAt ?? todayStr();
    const endAt = body.endAt ?? addDays(startAt, 7);
    if (endAt < startAt) {
      throw new ApiError(422, "测试结束时间不能早于开始时间", "INVALID_DATE_RANGE");
    }
    const accepted = body.converted ? true : body.accepted;
    const created = await prisma.$transaction(async (tx) => {
      const max = await tx.customerTest.aggregate({ _max: { seqNo: true } });
      const seqNo = (max._max.seqNo ?? 0) + 1;
      const test = await tx.customerTest.create({
        data: {
          seqNo,
          customerId: body.customerId ?? null,
          companyName: body.companyName,
          salesperson: body.salesperson ?? null,
          content: body.content ?? null,
          startAt,
          endAt,
          accepted,
          converted: body.converted,
          status: body.status ?? null,
          notes: body.notes ?? null,
        },
        include: { customer: { select: { id: true, name: true } } },
      });
      await writeChangeLog(tx, {
        user,
        resource: "customerTest",
        recordId: test.id,
        action: "CREATE",
        summary: `创建客户测试 #${test.seqNo} ${test.companyName}`,
        after: test,
      });
      return test;
    });
    return jsonOk({ ...created, displayStatus: computeTestStatus(created) }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
