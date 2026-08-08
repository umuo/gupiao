const TICKFLOW_FREE_API = "https://free-api.tickflow.org";
const EXCHANGES = ["SH", "SZ", "BJ"] as const;
const CATALOG_TTL = 6 * 60 * 60 * 1000;

type Instrument = {
  symbol: string;
  code: string;
  name: string;
  exchange: string;
  region: string;
  type: string;
};

let catalogCache: { expiresAt: number; items: Instrument[] } | null = null;
let catalogRequest: Promise<Instrument[]> | null = null;

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "paper-alpha/1.0" },
  });
  if (!response.ok) throw new Error(`TickFlow returned ${response.status}`);
  return response.json() as Promise<{ data?: Instrument[] }>;
}

async function loadCatalog() {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.items;
  if (catalogRequest) return catalogRequest;

  catalogRequest = Promise.all(
    EXCHANGES.map(async (exchange) => {
      const payload = await fetchJson(`${TICKFLOW_FREE_API}/v1/exchanges/${exchange}/instruments?type=stock`);
      return payload.data ?? [];
    }),
  ).then((groups) => {
    const items = groups.flat().filter((item) => item.region === "CN" && item.type === "stock");
    catalogCache = { expiresAt: Date.now() + CATALOG_TTL, items };
    catalogRequest = null;
    return items;
  }).catch((error) => {
    catalogRequest = null;
    throw error;
  });

  return catalogRequest;
}

function score(item: Instrument, query: string) {
  if (item.code === query || item.name === query) return 0;
  if (item.code.startsWith(query) || item.name.startsWith(query)) return 1;
  return 2;
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 30) ?? "";
  if (!query) return Response.json({ source: "TickFlow Free", results: [] });

  try {
    let matches: Instrument[];
    if (/^\d{6}$/.test(query)) {
      const exchange = query.startsWith("6") ? "SH" : query.startsWith("0") || query.startsWith("3") ? "SZ" : "BJ";
      const payload = await fetchJson(`${TICKFLOW_FREE_API}/v1/instruments?symbols=${query}.${exchange}`);
      matches = payload.data ?? [];
    } else {
      const normalized = query.toLowerCase();
      const catalog = await loadCatalog();
      matches = catalog
        .filter((item) => item.code.includes(normalized) || item.name.toLowerCase().includes(normalized))
        .sort((a, b) => score(a, normalized) - score(b, normalized) || a.code.localeCompare(b.code))
        .slice(0, 10);
    }

    return Response.json(
      {
        source: "TickFlow Free",
        results: matches.map(({ symbol, code, name, exchange }) => ({ symbol, code, name, exchange })),
      },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=21600, stale-while-revalidate=86400" } },
    );
  } catch {
    return Response.json({ error: "TickFlow instrument search is temporarily unavailable" }, { status: 502 });
  }
}
