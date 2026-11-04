export class ClientApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;

  constructor(status: number, message: string, code = "ERROR", fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

type ApiErrorBody = {
  error?: { code?: string; message?: string; fields?: Record<string, string> };
};

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // 非 JSON 响应
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !url.includes("/api/auth/login")) {
      window.location.replace("/login");
    }
    const body = (data ?? {}) as ApiErrorBody;
    throw new ClientApiError(
      res.status,
      body.error?.message ?? `请求失败（${res.status}）`,
      body.error?.code ?? "ERROR",
      body.error?.fields,
    );
  }
  return data as T;
}

export const fetcher = <T>(url: string): Promise<T> => apiFetch<T>(url);

export function buildQuery(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "操作失败，请稍后重试";
}
