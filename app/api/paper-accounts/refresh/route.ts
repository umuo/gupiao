import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { paperAccounts } from "../../../../db/schema";
import { getAppUser } from "../../../auth";
import { refreshPaperAccountValuation, shanghaiDate } from "../../../paper-account-service";
import { fetchTickFlowKlines } from "../../../tickflow-client";

async function mapSettledWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try { results[index] = { status: "fulfilled", value: await mapper(items[index]) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }));
  return results;
}

export async function POST(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const payload = await request.json().catch(() => ({})) as { id?: string };
  const rows = payload.id
    ? await getDb().select().from(paperAccounts).where(and(eq(paperAccounts.userId, user.userId), eq(paperAccounts.id, payload.id))).limit(1)
    : await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId, user.userId)).limit(100);
  const priceBySymbol = new Map<string, { price: number; date: string }>();
  const symbols = [...new Set(rows.map((row) => row.symbol))];
  const quotes = await mapSettledWithConcurrency(symbols, 4, async (symbol) => {
    const bars = await fetchTickFlowKlines(symbol, 5);
    const bar = bars.at(-1);
    if (!bar) throw new Error("没有可用日K");
    return { symbol, price: bar.close, date: shanghaiDate(new Date(bar.timestamp)) };
  });
  quotes.forEach((result) => { if (result.status === "fulfilled") priceBySymbol.set(result.value.symbol, result.value); });
  const refreshed = await mapSettledWithConcurrency(rows, 4, async (row) => {
    const quote = priceBySymbol.get(row.symbol);
    if (!quote) throw new Error(`${row.stockName}行情读取失败`);
    await refreshPaperAccountValuation(row.id, user.userId, quote.price, quote.date);
    return row.id;
  });
  return Response.json({
    updated: refreshed.filter((result) => result.status === "fulfilled").length,
    failed: refreshed.filter((result) => result.status === "rejected").map((result) => result.reason instanceof Error ? result.reason.message : "更新失败"),
  });
}
