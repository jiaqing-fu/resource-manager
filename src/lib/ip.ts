import * as ipaddr from "ipaddr.js";

export type IpVersion = 4 | 6;

export type ParsedIp = {
  canonical: string;
  version: IpVersion;
  addr: ipaddr.IPv4 | ipaddr.IPv6;
};

export type ParsedCidr = {
  canonical: string;
  version: IpVersion;
  prefix: number;
  addr: ipaddr.IPv4 | ipaddr.IPv6;
};

export type ParsedIpRange = {
  start: string;
  end: string;
  version: IpVersion;
  canonical: string;
  /** IPv4 闭区间地址数；IPv6 区间不受支持，因此为 null。 */
  size: number | null;
  startLong: number | null;
  endLong: number | null;
};

export type ParsedBlock = {
  kind: "cidr" | "range";
  canonical: string;
  version: IpVersion;
  prefix: number | null;
  startIp: string;
  endIp: string;
  startLong: number | null;
  endLong: number | null;
  /** IPv4 闭区间地址数；IPv6 为 null。 */
  size: number | null;
};

export const MAX_RANGE_ADDRESSES = 4096;
export const MAX_RANGE_ALLOCATION_ADDRESSES = 4096;

function versionOf(addr: ipaddr.IPv4 | ipaddr.IPv6): IpVersion {
  return addr.kind() === "ipv4" ? 4 : 6;
}

function ipv4BytesToLong(bytes: number[]): number {
  return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
}

export function ipv4LongToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
}

const longToIpv4 = ipv4LongToIp;

function maskBytes(bytes: number[], prefix: number): number[] {
  const out = bytes.slice();
  let remaining = prefix;
  for (let i = 0; i < out.length; i++) {
    if (remaining >= 8) {
      remaining -= 8;
    } else if (remaining > 0) {
      out[i] = out[i] & (0xff << (8 - remaining)) & 0xff;
      remaining = 0;
    } else {
      out[i] = 0;
    }
  }
  return out;
}

/** 将 16 字节 IPv6 转成压缩小写形式。 */
export function ipv6BytesToString(bytes: number[]): string {
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);

  let bestStart = -1;
  let bestLen = 1;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart === -1) return hex.join(":");
  const left = hex.slice(0, bestStart).join(":");
  const right = hex.slice(bestStart + bestLen).join(":");
  return `${left}::${right}`;
}

export function parseIp(input: string): ParsedIp | null {
  const s = (input ?? "").trim();
  if (!s || s.includes("/")) return null;
  try {
    const addr = ipaddr.parse(s);
    if (addr.kind() === "ipv6") {
      const v6 = addr as ipaddr.IPv6;
      if (v6.zoneId) return null;
    }
    return { canonical: addr.toString().toLowerCase(), version: versionOf(addr), addr };
  } catch {
    return null;
  }
}

export function parseCidr(input: string): ParsedCidr | null {
  const s = (input ?? "").trim();
  if (!s || !s.includes("/")) return null;
  try {
    const [addr, prefix] = ipaddr.parseCIDR(s);
    const version = versionOf(addr);
    const max = version === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
    const bytes = maskBytes(addr.toByteArray(), prefix);
    const canonical =
      version === 4
        ? `${longToIpv4(ipv4BytesToLong(bytes))}/${prefix}`
        : `${ipv6BytesToString(bytes)}/${prefix}`;
    return { canonical, version, prefix, addr };
  } catch {
    return null;
  }
}

export function cidrContainsCidr(parent: string, child: string): boolean {
  const p = parseCidr(parent);
  const c = parseCidr(child);
  if (!p || !c || p.version !== c.version) return false;
  if (c.prefix < p.prefix) return false;
  return c.addr.match(p.addr, p.prefix);
}

export function cidrsOverlap(a: string, b: string): boolean {
  return cidrContainsCidr(a, b) || cidrContainsCidr(b, a);
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const a = parseIp(ip);
  const c = parseCidr(cidr);
  if (!a || !c || a.version !== c.version) return false;
  return a.addr.match(c.addr, c.prefix);
}

export function ipv4ToLong(ip: string): number | null {
  const p = parseIp(ip);
  if (!p || p.version !== 4) return null;
  return ipv4BytesToLong(p.addr.toByteArray());
}

/** IPv4 网段可用地址数（排除网络地址与广播地址）。 */
export function ipv4UsableCount(prefix: number): number {
  if (prefix === 32) return 1;
  if (prefix === 31) return 2;
  return Math.max(0, 2 ** (32 - prefix) - 2);
}

export function usableCount(version: IpVersion, prefix: number): number | null {
  if (version === 4) return ipv4UsableCount(prefix);
  return null; // IPv6 地址空间过大，利用率只展示已用数量
}

export type Ipv4Range = { network: number; broadcast: number; first: number; last: number };

export function ipv4Range(cidr: string): Ipv4Range | null {
  const c = parseCidr(cidr);
  if (!c || c.version !== 4) return null;
  const network = ipv4BytesToLong(maskBytes(c.addr.toByteArray(), c.prefix));
  const mask = c.prefix === 0 ? 0 : (0xffffffff << (32 - c.prefix)) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const first = c.prefix <= 30 ? network + 1 : network;
  const last = c.prefix <= 30 ? broadcast - 1 : broadcast;
  return { network, broadcast, first, last };
}

/**
 * 枚举 IPv4 可用地址，排除网络/广播地址与指定地址（如网关）。
 * 返回结果不超过 limit 个。
 */
export function listIpv4Hosts(cidr: string, limit: number, exclude: Set<string> = new Set()): string[] {
  const range = ipv4Range(cidr);
  if (!range) return [];
  const out: string[] = [];
  for (let n = range.first; n <= range.last && out.length < limit; n++) {
    const ip = longToIpv4(n);
    if (!exclude.has(ip)) out.push(ip);
  }
  return out;
}

export function normalizedCidrAddress(cidr: string): string | null {
  const c = parseCidr(cidr);
  if (!c) return null;
  return c.canonical.split("/")[0];
}

function compareIpv6Bytes(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/** 解析闭区间 `start-end`。任意 IPv6 区间可以解析，但业务层不支持。 */
export function parseIpRange(input: string): ParsedIpRange | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const parts = s.split("-");
  if (parts.length !== 2) return null;
  const start = parseIp(parts[0]);
  const end = parseIp(parts[1]);
  if (!start || !end || start.version !== end.version) return null;

  if (start.version === 4) {
    const startLong = ipv4BytesToLong(start.addr.toByteArray());
    const endLong = ipv4BytesToLong(end.addr.toByteArray());
    if (startLong > endLong) return null;
    return {
      start: start.canonical,
      end: end.canonical,
      version: 4,
      canonical: `${start.canonical}-${end.canonical}`,
      size: endLong - startLong + 1,
      startLong,
      endLong,
    };
  }

  if (compareIpv6Bytes(start.addr.toByteArray(), end.addr.toByteArray()) > 0) {
    return null;
  }
  return {
    start: start.canonical,
    end: end.canonical,
    version: 6,
    canonical: `${start.canonical}-${end.canonical}`,
    size: null,
    startLong: null,
    endLong: null,
  };
}

function cidrEdgeIps(cidr: ParsedCidr): { startIp: string; endIp: string } {
  const bytes = maskBytes(cidr.addr.toByteArray(), cidr.prefix);
  const last = bytes.slice();
  let remaining = cidr.prefix;
  for (let i = 0; i < last.length; i++) {
    if (remaining >= 8) {
      remaining -= 8;
    } else if (remaining > 0) {
      last[i] = (last[i] | (0xff >>> remaining)) & 0xff;
      remaining = 0;
    } else {
      last[i] = 0xff;
    }
  }
  if (cidr.version === 4) {
    return {
      startIp: ipv4LongToIp(ipv4BytesToLong(bytes)),
      endIp: ipv4LongToIp(ipv4BytesToLong(last)),
    };
  }
  return { startIp: ipv6BytesToString(bytes), endIp: ipv6BytesToString(last) };
}

/**
 * 解析网段定义：CIDR 或 IPv4 闭区间 `start-end`。
 * IPv6 任意区间不属于业务支持范围，返回 null。
 */
export function parseBlockSpec(input: string): ParsedBlock | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (s.includes("/")) {
    const c = parseCidr(s);
    if (!c) return null;
    const { startIp, endIp } = cidrEdgeIps(c);
    if (c.version === 4) {
      const startLong = ipv4ToLong(startIp);
      const endLong = ipv4ToLong(endIp);
      if (startLong === null || endLong === null) return null;
      return {
        kind: "cidr",
        canonical: c.canonical,
        version: 4,
        prefix: c.prefix,
        startIp,
        endIp,
        startLong,
        endLong,
        size: endLong - startLong + 1,
      };
    }
    return {
      kind: "cidr",
      canonical: c.canonical,
      version: 6,
      prefix: c.prefix,
      startIp,
      endIp,
      startLong: null,
      endLong: null,
      size: null,
    };
  }
  if (!s.includes("-")) return null;
  const r = parseIpRange(s);
  if (!r || r.version !== 4) return null;
  return {
    kind: "range",
    canonical: r.canonical,
    version: 4,
    prefix: null,
    startIp: r.start,
    endIp: r.end,
    startLong: r.startLong,
    endLong: r.endLong,
    size: r.size,
  };
}

/** 将已解析的 IPv4 区间转为统一的段定义；IPv6 区间返回 null。 */
export function rangeToBlock(range: ParsedIpRange): ParsedBlock | null {
  if (range.version !== 4) return null;
  return {
    kind: "range",
    canonical: range.canonical,
    version: 4,
    prefix: null,
    startIp: range.start,
    endIp: range.end,
    startLong: range.startLong,
    endLong: range.endLong,
    size: range.size,
  };
}

export type StoredBlock = {
  kind?: string | null;
  cidr: string;
  rangeStart?: string | null;
  rangeEnd?: string | null;
};

/** 从数据库行还原段定义（兼容历史 CIDR 行）。 */
export function parseStoredBlock(block: StoredBlock): ParsedBlock | null {
  if (block.kind === "range" && block.rangeStart && block.rangeEnd) {
    return parseBlockSpec(`${block.rangeStart}-${block.rangeEnd}`);
  }
  return parseBlockSpec(block.cidr);
}

export function ipInBlock(ip: string, block: ParsedBlock): boolean {
  const parsed = parseIp(ip);
  if (!parsed || parsed.version !== block.version) return false;
  if (parsed.version === 4) {
    if (block.startLong === null || block.endLong === null) return false;
    const n = ipv4BytesToLong(parsed.addr.toByteArray());
    return n >= block.startLong && n <= block.endLong;
  }
  return ipInCidr(parsed.canonical, block.canonical);
}

/** parent 的覆盖范围是否完整包含 child（允许等覆盖，调用方按需拒绝相等）。 */
export function blockContainsBlock(parent: ParsedBlock, child: ParsedBlock): boolean {
  if (parent.version !== child.version) return false;
  if (parent.version === 4) {
    if (
      parent.startLong === null ||
      parent.endLong === null ||
      child.startLong === null ||
      child.endLong === null
    ) {
      return false;
    }
    return parent.startLong <= child.startLong && parent.endLong >= child.endLong;
  }
  return cidrContainsCidr(parent.canonical, child.canonical);
}

export function blockOverlapsBlock(a: ParsedBlock, b: ParsedBlock): boolean {
  if (a.version !== b.version) return false;
  if (a.version === 4) {
    if (
      a.startLong === null ||
      a.endLong === null ||
      b.startLong === null ||
      b.endLong === null
    ) {
      return false;
    }
    return a.startLong <= b.endLong && b.startLong <= a.endLong;
  }
  return cidrsOverlap(a.canonical, b.canonical);
}
