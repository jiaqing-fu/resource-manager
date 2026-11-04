import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApiError, jsonOk, queryValue, requireUser } from "@/lib/api";
import { computeRackUsage } from "@/server/services/inventory";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

type Slot = {
  u: number;
  device: null | {
    id: string;
    name: string;
    type: string;
    status: string;
    manufacturer: string | null;
    model: string | null;
    uStart: number;
    uHeight: number;
    face: string;
    isStart: boolean;
  };
};

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const { id } = await params;
    const face = queryValue(req, "face") === "rear" ? "rear" : "front";
    const rack = await prisma.rack.findUnique({
      where: { id },
    });
    if (!rack) throw new ApiError(404, "机柜不存在", "NOT_FOUND");

    const devices = await prisma.device.findMany({
      where: { rackId: id, face, uStart: { not: null } },
      orderBy: { uStart: "asc" },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        manufacturer: true,
        model: true,
        uStart: true,
        uHeight: true,
        face: true,
      },
    });

    const byU = new Map<number, Slot["device"]>();
    for (const d of devices) {
      const start = d.uStart!;
      for (let u = start; u < start + d.uHeight; u++) {
        byU.set(u, { ...d, uStart: start, isStart: u === start });
      }
    }
    const slots: Slot[] = [];
    for (let u = rack.uEnd; u >= rack.uStart; u--) {
      slots.push({ u, device: byU.get(u) ?? null });
    }
    const usage = computeRackUsage(devices);
    return jsonOk({
      rack: {
        id: rack.id,
        code: rack.code,
        location: rack.location,
        uStart: rack.uStart,
        uEnd: rack.uEnd,
        width: rack.width,
        status: rack.status,
      },
      face,
      slots,
      usedU: usage.usedU,
      usedUFront: usage.usedUFront,
      usedURear: usage.usedURear,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
