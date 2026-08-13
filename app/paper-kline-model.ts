type DatedBar = { timestamp: number };
type DatedTrade = { id: string; action: "buy" | "sell"; barTimestamp: number };

function normalizedTimestamp(value: number) {
  return value < 1_000_000_000_000 ? value * 1_000 : value;
}

export function paperMarketDateKey(value: number) {
  const date = new Date(normalizedTimestamp(value));
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function mapPaperTradesToBars<T extends DatedTrade>(bars: DatedBar[], trades: T[], firstBuyTradeId: string | null) {
  const barsByDate = new Map(bars.map((bar, index) => [paperMarketDateKey(bar.timestamp), index]));
  return trades.flatMap((trade) => {
    const index = barsByDate.get(paperMarketDateKey(trade.barTimestamp));
    return index == null ? [] : [{ ...trade, index, firstBuy: trade.id === firstBuyTradeId }];
  });
}

export function initialPaperKlineWindow(barCount: number, markerIndexes: number[]) {
  if (barCount <= 0) return { visibleCount: 1, endOffset: 0 };
  if (!markerIndexes.length) return { visibleCount: Math.min(120, barCount), endOffset: 0 };
  const earliest = Math.max(0, Math.min(...markerIndexes) - 10);
  return { visibleCount: Math.max(1, barCount - earliest), endOffset: 0 };
}
