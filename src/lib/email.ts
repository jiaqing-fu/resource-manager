export const MAX_EMAIL_RECIPIENTS = 20;

const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** 按逗号、分号、空白（含中文标点）拆分邮箱列表。 */
export function splitEmailList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\s,;，；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

export type EmailListResult = {
  emails: string[];
  invalid: string[];
  tooMany: boolean;
};

/** 校验、去重并规范化邮箱列表；返回的问题由调用方转成字段错误。 */
export function checkEmailList(value: string | null | undefined): EmailListResult {
  const invalid: string[] = [];
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const raw of splitEmailList(value)) {
    const email = raw.toLowerCase();
    if (!isValidEmail(email)) {
      invalid.push(raw);
      continue;
    }
    if (!seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  }
  return {
    emails,
    invalid,
    tooMany: emails.length > MAX_EMAIL_RECIPIENTS,
  };
}

/** 规范化后的逗号分隔列表（用于入库和邮件头）。 */
export function normalizeEmailList(value: string | null | undefined): string {
  return checkEmailList(value).emails.join(", ");
}

export function emailListError(result: EmailListResult, label: string): string | null {
  if (result.invalid.length > 0) {
    return `${label}包含无效邮箱：${result.invalid.slice(0, 5).join("、")}`;
  }
  if (result.tooMany) {
    return `${label}最多 ${MAX_EMAIL_RECIPIENTS} 个地址`;
  }
  return null;
}
