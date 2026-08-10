import { writeFile } from "node:fs/promises";

const API_BASE = "https://free-api.tickflow.org";
const exchanges = ["SH", "SZ", "BJ"];
const output = new URL("../app/stock-catalog.generated.json", import.meta.url);

async function loadExchange(exchange) {
  const response = await fetch(`${API_BASE}/v1/exchanges/${exchange}/instruments?type=stock`, {
    headers: { Accept: "application/json", "User-Agent": "paper-alpha-catalog/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${exchange} catalog returned ${response.status}`);
  const payload = await response.json();
  return (payload.data ?? []).map(({ symbol, code, name, exchange: market }) => ({ symbol, code, name, exchange: market }));
}

const catalog = (await Promise.all(exchanges.map(loadExchange)))
  .flat()
  .sort((left, right) => left.code.localeCompare(right.code));

await writeFile(output, `${JSON.stringify(catalog)}\n`, "utf8");
console.log(`Wrote ${catalog.length} A-share instruments to ${output.pathname}`);
