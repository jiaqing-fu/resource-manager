import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handleApiError, jsonOk, queryValue, requireUser } from "@/lib/api";
import { addDays, diffDays, todayStr } from "@/lib/dates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const raw = Number.parseInt(queryValue(req, "days") ?? "30", 10);
    const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, raw)) : 30;
    const today = todayStr();
    const until = addDays(today, days);

    const [lines, broadbands, devices, tests] = await Promise.all([
      prisma.line.findMany({
        where: {
          expireDate: { not: null, gte: today, lte: until },
          status: { not: "deprovisioned" },
        },
        orderBy: { expireDate: "asc" },
        take: 20,
        select: {
          id: true,
          code: true,
          name: true,
          expireDate: true,
          status: true,
          supplier: { select: { name: true } },
        },
      }),
      prisma.broadband.findMany({
        where: {
          expireDate: { not: null, gte: today, lte: until },
          status: { not: "terminated" },
        },
        orderBy: { expireDate: "asc" },
        take: 20,
        select: {
          id: true,
          name: true,
          expireDate: true,
          status: true,
          supplier: { select: { name: true } },
        },
      }),
      prisma.device.findMany({
        where: { warrantyEnd: { not: null, gte: today, lte: until } },
        orderBy: { warrantyEnd: "asc" },
        take: 20,
        select: {
          id: true,
          name: true,
          manufacturer: true,
          model: true,
          warrantyEnd: true,
          status: true,
        },
      }),
      prisma.customerTest.findMany({
        where: { status: null, converted: false, endAt: { lt: today } },
        orderBy: { endAt: "asc" },
        take: 20,
        select: {
          id: true,
          seqNo: true,
          companyName: true,
          salesperson: true,
          endAt: true,
          accepted: true,
        },
      }),
    ]);

    return jsonOk({
      days,
      today,
      lines: lines.map((l) => ({
        ...l,
        daysLeft: l.expireDate ? diffDays(today, l.expireDate) : null,
      })),
      broadbands: broadbands.map((b) => ({
        ...b,
        daysLeft: b.expireDate ? diffDays(today, b.expireDate) : null,
      })),
      devices: devices.map((d) => ({
        ...d,
        daysLeft: d.warrantyEnd ? diffDays(today, d.warrantyEnd) : null,
      })),
      tests: tests.map((t) => ({ ...t, daysExpired: diffDays(t.endAt, today) })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
