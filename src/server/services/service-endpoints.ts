import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { parseIp } from "@/lib/ip";

type Tx = Prisma.TransactionClient;

export type EndpointInput = {
  ipAddressId?: string | null;
  ipText?: string | null;
  protocol?: string;
  port?: number | null;
  isPrimary?: boolean;
  description?: string | null;
};

export type NormalizedEndpoint = {
  ipAddressId: string | null;
  ipText: string | null;
  protocol: string;
  port: number | null;
  isPrimary: boolean;
  description: string | null;
};

/** 业务系统端点：可关联 IP 台账，或填写独立 IP 文本；二者至少其一。 */
export async function validateEndpoints(
  tx: Tx,
  endpoints: EndpointInput[],
): Promise<NormalizedEndpoint[]> {
  const out: NormalizedEndpoint[] = [];
  for (let i = 0; i < endpoints.length; i++) {
    const e = endpoints[i];
    const rowLabel = `第 ${i + 1} 个端点`;
    let ipAddressId: string | null = e.ipAddressId ?? null;
    let ipText: string | null = e.ipText ?? null;

    if (ipAddressId) {
      const ip = await tx.ipAddress.findUnique({
        where: { id: ipAddressId },
        select: { id: true, address: true },
      });
      if (!ip) throw new ApiError(422, `${rowLabel}关联的 IP 不存在`, "IP_NOT_FOUND");
      ipText = null;
    } else {
      if (!ipText) {
        throw new ApiError(422, `${rowLabel}必须关联 IP 台账或填写 IP 地址`, "ENDPOINT_IP_REQUIRED");
      }
      const parsed = parseIp(ipText);
      if (!parsed) throw new ApiError(422, `${rowLabel}的 IP 地址格式不正确`, "INVALID_IP");
      ipText = parsed.canonical;
      ipAddressId = null;
    }

    const port = e.port ?? null;
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new ApiError(422, `${rowLabel}的端口必须在 1-65535 之间`, "INVALID_PORT");
    }
    out.push({
      ipAddressId,
      ipText,
      protocol: e.protocol ?? "tcp",
      port,
      isPrimary: e.isPrimary ?? false,
      description: e.description ?? null,
    });
  }
  return out;
}
