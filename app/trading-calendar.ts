export const A_SHARE_CALENDAR_VERSION = "SSE-2026-2025-12-22";
export const A_SHARE_CALENDAR_SOURCE = "https://www.sse.com.cn/disclosure/dealinstruc/closed/";

type Closure = { from: string; to: string; label: string };

const officialClosures: Record<number, Closure[]> = {
  2025: [
    { from: "2025-01-01", to: "2025-01-01", label: "元旦休市" },
    { from: "2025-01-28", to: "2025-02-04", label: "春节休市" },
    { from: "2025-04-04", to: "2025-04-06", label: "清明节休市" },
    { from: "2025-05-01", to: "2025-05-05", label: "劳动节休市" },
    { from: "2025-05-31", to: "2025-06-02", label: "端午节休市" },
    { from: "2025-10-01", to: "2025-10-08", label: "国庆节、中秋节休市" },
  ],
  2026: [
    { from: "2026-01-01", to: "2026-01-03", label: "元旦休市" },
    { from: "2026-02-15", to: "2026-02-23", label: "春节休市" },
    { from: "2026-04-04", to: "2026-04-06", label: "清明节休市" },
    { from: "2026-05-01", to: "2026-05-05", label: "劳动节休市" },
    { from: "2026-06-19", to: "2026-06-21", label: "端午节休市" },
    { from: "2026-09-25", to: "2026-09-27", label: "中秋节休市" },
    { from: "2026-10-01", to: "2026-10-07", label: "国庆节休市" },
  ],
};

function dateFromKey(date: string) {
  return new Date(`${date}T12:00:00+08:00`);
}

function weekday(date: string) {
  const day = dateFromKey(date).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDays(date: string, days: number) {
  const value = dateFromKey(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shanghaiDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export type TradingDayStatus = {
  date: string;
  isTradingDay: boolean;
  reason: string;
  coverage: "official" | "weekday-fallback";
  calendarVersion: string;
  sourceUrl: string;
};

export function aShareTradingDayStatus(input: string | Date = new Date()): TradingDayStatus {
  const date = typeof input === "string" ? input : shanghaiDateKey(input);
  const day = weekday(date);
  const year = Number(date.slice(0, 4));
  const closures = officialClosures[year];
  const coverage = closures ? "official" : "weekday-fallback";
  if (day >= 6) return { date, isTradingDay: false, reason: "周末休市", coverage, calendarVersion: A_SHARE_CALENDAR_VERSION, sourceUrl: A_SHARE_CALENDAR_SOURCE };
  const closure = closures?.find((item) => date >= item.from && date <= item.to);
  if (closure) return { date, isTradingDay: false, reason: closure.label, coverage, calendarVersion: A_SHARE_CALENDAR_VERSION, sourceUrl: A_SHARE_CALENDAR_SOURCE };
  return {
    date,
    isTradingDay: true,
    reason: coverage === "official" ? "A股交易日" : "交易所尚未发布该年度安排，暂按工作日判断",
    coverage,
    calendarVersion: A_SHARE_CALENDAR_VERSION,
    sourceUrl: A_SHARE_CALENDAR_SOURCE,
  };
}

export function isAShareTradingDay(input: string | Date = new Date()) {
  return aShareTradingDayStatus(input).isTradingDay;
}

export function nextAShareTradingDay(input: string | Date = new Date()) {
  let date = typeof input === "string" ? input : shanghaiDateKey(input);
  for (let index = 0; index < 370; index += 1) {
    date = addDays(date, 1);
    if (isAShareTradingDay(date)) return date;
  }
  throw new Error("无法计算下一个 A 股交易日");
}
