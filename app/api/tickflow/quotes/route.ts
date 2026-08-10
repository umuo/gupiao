import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { userSettings } from "../../../../db/schema";
import { getAppUser } from "../../../auth";
import { decryptSecret } from "../../../secret-box";
import { fetchTickFlowQuotes } from "../../../tickflow-client";

const SYMBOL_PATTERN = /^\d{6}\.(SH|SZ|BJ)$/;

export async function GET(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ configured: false, error: "请先登录" }, { status: 401 });

  const url = new URL(request.url);
  const requested = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const symbols = [...new Set(requested)].slice(0, 8);
  if (!symbols.length || symbols.some((symbol) => !SYMBOL_PATTERN.test(symbol))) {
    return Response.json({ configured: true, error: "股票代码格式无效" }, { status: 400 });
  }

  const [settings] = await getDb()
    .select({ encrypted: userSettings.tickflowApiKeyEncrypted })
    .from(userSettings)
    .where(eq(userSettings.userId, user.userId))
    .limit(1);
  if (!settings?.encrypted) {
    return Response.json({ configured: false, error: "请先配置 TickFlow 实时行情 Key" }, { status: 409 });
  }

  try {
    const quotes = await fetchTickFlowQuotes(symbols, await decryptSecret(settings.encrypted));
    return Response.json(
      {
        configured: true,
        fetchedAt: new Date().toISOString(),
        quotes: Object.fromEntries(quotes.map((quote) => [quote.symbol, quote])),
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    return Response.json(
      { configured: true, error: error instanceof Error ? error.message : "实时行情读取失败" },
      { status: 502, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
}
