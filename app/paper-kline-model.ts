type DatedBar = { timestamp: number };
type DatedTrade = { id: string; action: "buy" | "sell"; barTimestamp: number };

export type PaperKlineBar = DatedBar & {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  provisional?: boolean;
};

export type PaperIntradayQuote = {
  timestamp: number;
  lastPrice: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  amount?: number;
};

type PricedTrade = DatedTrade & { executionPrice: number };

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

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function appendPaperIntradayBars(bars: PaperKlineBar[], trades: PricedTrade[], quote: PaperIntradayQuote | null = null) {
  const existingDates = new Set(bars.map((bar) => paperMarketDateKey(bar.timestamp)));
  const latestCompletedDate = bars.reduce((latest, bar) => {
    const date = paperMarketDateKey(bar.timestamp);
    return date > latest ? date : latest;
  }, "");
  const tradesByDate = new Map<string, PricedTrade[]>();

  trades.forEach((trade) => {
    const date = paperMarketDateKey(trade.barTimestamp);
    if (!date || existingDates.has(date) || (latestCompletedDate && date <= latestCompletedDate) || positiveNumber(trade.executionPrice) == null) return;
    tradesByDate.set(date, [...(tradesByDate.get(date) ?? []), trade]);
  });

  const quoteDate = quote ? paperMarketDateKey(quote.timestamp) : "";
  const dates = new Set(tradesByDate.keys());
  if (quoteDate && !existingDates.has(quoteDate) && (!latestCompletedDate || quoteDate > latestCompletedDate) && positiveNumber(quote?.lastPrice) != null) dates.add(quoteDate);

  const provisionalBars = [...dates].sort().flatMap((date) => {
    const dayTrades = [...(tradesByDate.get(date) ?? [])].sort((left, right) => normalizedTimestamp(left.barTimestamp) - normalizedTimestamp(right.barTimestamp));
    const dayQuote = quoteDate === date ? quote : null;
    const tradePrices = dayTrades.map((trade) => positiveNumber(trade.executionPrice)).filter((price): price is number => price != null);
    const lastPrice = positiveNumber(dayQuote?.lastPrice) ?? tradePrices.at(-1) ?? null;
    if (lastPrice == null) return [];
    const open = positiveNumber(dayQuote?.open) ?? tradePrices[0] ?? lastPrice;
    const quotedHigh = positiveNumber(dayQuote?.high);
    const quotedLow = positiveNumber(dayQuote?.low);
    const high = Math.max(open, lastPrice, quotedHigh ?? 0, ...tradePrices);
    const low = Math.min(open, lastPrice, quotedLow ?? Number.POSITIVE_INFINITY, ...tradePrices);
    const timestamp = dayQuote?.timestamp ?? dayTrades.at(-1)?.barTimestamp;
    if (timestamp == null) return [];
    return [{
      timestamp: normalizedTimestamp(timestamp),
      open,
      high,
      low,
      close: lastPrice,
      volume: Math.max(0, Number(dayQuote?.volume) || 0),
      amount: Math.max(0, Number(dayQuote?.amount) || 0),
      provisional: true,
    } satisfies PaperKlineBar];
  });

  return [...bars, ...provisionalBars].sort((left, right) => normalizedTimestamp(left.timestamp) - normalizedTimestamp(right.timestamp));
}

export function initialPaperKlineWindow(barCount: number, markerIndexes: number[]) {
  if (barCount <= 0) return { visibleCount: 1, endOffset: 0 };
  if (!markerIndexes.length) return { visibleCount: Math.min(120, barCount), endOffset: 0 };
  const earliest = Math.max(0, Math.min(...markerIndexes) - 10);
  return { visibleCount: Math.max(1, barCount - earliest), endOffset: 0 };
}
