import { fetchTickFlowKlines } from "../../tickflow-client";

const SYMBOL_PATTERN = /^\d{6}\.(SH|SZ|BJ)$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = (url.searchParams.get("symbols") ?? "601939.SH")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const symbols = [...new Set(requested)].slice(0, 8);
  // TickFlow allows up to 10,000 bars per request. A-share daily history is
  // shorter than that, so a single-symbol request can cover listing to today.
  const count = Math.min(10_000, Math.max(30, Number(url.searchParams.get("count")) || 220));

  if (!symbols.length || symbols.some((symbol) => !SYMBOL_PATTERN.test(symbol))) {
    return Response.json({ error: "Invalid A-share symbol" }, { status: 400 });
  }

  const settled = await Promise.allSettled(symbols.map(async (symbol) => [symbol, await fetchTickFlowKlines(symbol, count)] as const));
  const data: Record<string, Awaited<ReturnType<typeof fetchTickFlowKlines>>> = {};
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
