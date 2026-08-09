export const APP_TIME_ZONE = "Asia/Shanghai";
export const APP_TIME_ZONE_LABEL = "北京时间";

const appDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const appDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timestampFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function validDate(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatAppDateTime(value: string | number | Date) {
  const date = validDate(value);
  return date ? appDateTimeFormatter.format(date) : "—";
}

export function formatAppDate(value: string | number | Date) {
  const date = validDate(value);
  return date ? appDateFormatter.format(date) : "—";
}

export function appDateKey(value: string | number | Date = new Date()) {
  const date = validDate(value);
  if (!date) throw new Error("时间格式无效");
  const parts = timestampFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function toAppIsoString(value: string | number | Date) {
  const date = validDate(value);
  if (!date) throw new Error("时间格式无效");
  const parts = timestampFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}+08:00`;
}
