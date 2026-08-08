const TICKFLOW_FREE_API = "https://free-api.tickflow.org";
const SYMBOL_PATTERN = /^\d{6}\.(SH|SZ|BJ)$/;

type CompactKlines = {
  timestamp: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  amount?: number[];
};

async function fetchKlines(symbol: string, count: number) {
  const params = new URLSearchParams({
    symbol,
    period: "1d",
    count: String(count),
    adjust: "forward",
  });
  const response = await fetch(`${TICKFLOW_FREE_API}/v1/klines?${params}`, {
    headers: { Accept: "application/json", "User-Agent": "paper-alpha/1.0" },
  });

  if (!response.ok) {
    throw new Error(`TickFlow returned ${response.status}`);
  }

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = (url.searchParams.get("symbols") ?? "601939.SH")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const symbols = [...new Set(requested)].slice(0, 8);
  const count = Math.min(260, Math.max(30, Number(url.searchParams.get("count")) || 220));

  if (!symbols.length || symbols.some((symbol) => !SYMBOL_PATTERN.test(symbol))) {
    return Response.json({ error: "Invalid A-share symbol" }, { status: 400 });
  }

  const settled = await Promise.allSettled(symbols.map(async (symbol) => [symbol, await fetchKlines(symbol, count)] as const));
  const data: Record<string, Awaited<ReturnType<typeof fetchKlines>>> = {};
  const errors: Record<string, string> = {};

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") data[result.value[0]] = result.value[1];
    else errors[symbols[index]] = result.reason instanceof Error ? result.reason.message : "Unknown TickFlow error";
  });

  if (!Object.keys(data).length) {
    return Response.json({ error: "TickFlow data is temporarily unavailable", details: errors }, { status: 502 });
  }

  return Response.json(
    {
      source: "TickFlow Free",
      period: "1d",
      adjustment: "forward",
      realtime: false,
      fetchedAt: new Date().toISOString(),
      data,
      errors,
    },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600" } },
  );
}
