import { z } from "zod";
import { dateStr, optionalText } from "@/lib/validators";
import { checkEmailList, emailListError } from "@/lib/email";

const jsonObject = z.custom<Record<string, unknown>>(
  (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  "正文格式不正确",
);

const subjectText = z.preprocess(
  (v) => (v === "" ? null : v),
  z
    .string()
    .max(200, "邮件主题不能超过 200 个字符")
    .refine((v) => !/[\r\n]/.test(v), "邮件主题不能包含换行")
    .nullable()
    .optional(),
);

/** 新建/保存草稿允许不完整；发送前另行强校验。 */
export const notificationSchema = z.object({
  title: z.string().trim().max(200, "标题不能超过 200 个字符").default(""),
  recipient: z.string().max(4000, "收件人过长").default(""),
  cc: optionalText(4000),
  subject: subjectText,
  contentJson: jsonObject,
  signature: optionalText(2000),
  documentDate: dateStr,
});

export type NotificationInput = z.infer<typeof notificationSchema>;

/** 返回字段级错误；空对象表示可发送。 */
export function notificationSendErrors(input: {
  title: string;
  recipient: string;
  cc: string | null;
  contentText: string;
  documentDate: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.title.trim()) errors.title = "发送前请填写通知标题";
  const to = checkEmailList(input.recipient);
  const toError = emailListError(to, "收件人");
  if (!toError && to.emails.length === 0) errors.recipient = "请至少填写一个收件人邮箱";
  else if (toError) errors.recipient = toError;
  const ccError = emailListError(checkEmailList(input.cc), "抄送");
  if (ccError) errors.cc = ccError;
  if (!input.contentText.trim()) errors.contentJson = "发送前请填写正文";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.documentDate)) {
    errors.documentDate = "日期格式应为 YYYY-MM-DD";
  }
  return errors;
}
