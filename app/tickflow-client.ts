import type { Kline } from "./strategy-engine";

const TICKFLOW_FREE_API = "https://free-api.tickflow.org";
const TICKFLOW_API = "https://api.tickflow.org";

type CompactKlines = {
  timestamp: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  amount?: number[];
};

export async function fetchTickFlowKlines(symbol: string, count: number): Promise<Kline[]> {
  const params = new URLSearchParams({ symbol, period: "1d", count: String(count), adjust: "forward" });
  const response = await fetch(`${TICKFLOW_FREE_API}/v1/klines?${params}`, {
    headers: { Accept: "application/json", "User-Agent": "paper-alpha/1.0" },
  });
  if (!response.ok) throw new Error(`TickFlow returned ${response.status}`);
  const payload = (await response.json()) as { data?: CompactKlines };
  if (!payload.data?.timestamp?.length) throw new Error("TickFlow returned no K-line data");
  const compact = payload.data;
  return compact.timestamp.map((timestamp, index) => ({
    timestamp,
    open: compact.open[index],
    high: compact.high[index],
    low: compact.low[index],
    close: compact.close[index],
    volume: compact.volume[index],
    amount: compact.amount?.[index] ?? 0,
  }));
}

export type TickFlowQuote = {
  symbol: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  lastPrice: number;
  previousClose: number;
  volume: number;
  amount: number;
  name: string;
};

export async function fetchTickFlowQuote(symbol: string, apiKey: string): Promise<TickFlowQuote> {
  const params = new URLSearchParams({ symbols: symbol });
  const response = await fetch(`${TICKFLOW_API}/v1/quotes?${params}`, {
    headers: { Accept: "application/json", "x-api-key": apiKey, "User-Agent": "paper-alpha/1.0" },
  });
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403 ? "TickFlow Key 无效或套餐无实时行情权限" : `TickFlow 实时行情返回 ${response.status}`;
    throw new Error(message);
  }
  const payload = await response.json() as {
    data?: Array<{
      symbol?: string;
      timestamp?: number;
      open?: number;
      high?: number;
      low?: number;
      last_price?: number;
      prev_close?: number;
      volume?: number;
      amount?: number;
      ext?: { name?: string };
    }>;
  };
  const quote = payload.data?.find((item) => item.symbol === symbol) ?? payload.data?.[0];
  const lastPrice = Number(quote?.last_price);
  if (!quote || !Number.isFinite(lastPrice) || lastPrice <= 0) throw new Error("TickFlow 未返回有效实时行情");
  let timestamp = Number(quote.timestamp);
  if (!Number.isFinite(timestamp)) timestamp = Date.now();
  if (timestamp < 1_000_000_000_000) timestamp *= 1000;
  return {
    symbol: String(quote.symbol ?? symbol),
    timestamp,
    open: Number(quote.open) || lastPrice,
    high: Number(quote.high) || lastPrice,
    low: Number(quote.low) || lastPrice,
    lastPrice,
    previousClose: Number(quote.prev_close) || lastPrice,
    volume: Number(quote.volume) || 0,
    amount: Number(quote.amount) || 0,
    name: String(quote.ext?.name ?? ""),
  };
}
