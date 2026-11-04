type ErrorBody = { error?: { message?: string } };

function filenameFromHeader(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export async function downloadNotificationDocx(id: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api/notifications/${id}/download`);
  if (!res.ok) {
    if (res.status === 401) {
      window.location.replace("/login");
      throw new Error("请先登录");
    }
    let message = `下载失败（${res.status}）`;
    try {
      const body = (await res.json()) as ErrorBody;
      message = body.error?.message ?? message;
    } catch {
      // 非 JSON 响应
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const filename = filenameFromHeader(res.headers.get("Content-Disposition")) ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".docx") ? filename : `${filename}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
