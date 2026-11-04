import dayjs from "dayjs";

/** 深拷贝表单值；Dayjs 保留原型并 clone。 */
export function cloneFormValue<T>(value: T): T {
  if (dayjs.isDayjs(value)) {
    return value.clone() as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneFormValue(item)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = cloneFormValue(item);
    }
    return out as T;
  }
  return value;
}
