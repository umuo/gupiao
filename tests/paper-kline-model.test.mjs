import assert from "node:assert/strict";
import test from "node:test";
import { initialPaperKlineWindow, mapPaperTradesToBars, paperMarketDateKey } from "../app/paper-kline-model.ts";

test("maps paper trades to their Shanghai daily K-line and marks the first buy", () => {
  const bars = [
    { timestamp: Date.parse("2026-08-12T07:00:00.000Z") },
    { timestamp: Date.parse("2026-08-13T07:00:00.000Z") },
  ];
  const trades = [
    { id: "first-buy", action: "buy", barTimestamp: Date.parse("2026-08-12T01:37:00.000Z"), shares: 100 },
    { id: "sell", action: "sell", barTimestamp: Date.parse("2026-08-13T01:31:00.000Z"), shares: 100 },
  ];
  const markers = mapPaperTradesToBars(bars, trades, "first-buy");
  assert.deepEqual(markers.map(({ id, index, firstBuy }) => ({ id, index, firstBuy })), [
    { id: "first-buy", index: 0, firstBuy: true },
    { id: "sell", index: 1, firstBuy: false },
  ]);
});

test("normalizes second timestamps and drops trades without a matching daily bar", () => {
  assert.equal(paperMarketDateKey(Date.parse("2026-08-13T01:00:00.000Z") / 1_000), "2026-08-13");
  const markers = mapPaperTradesToBars([{ timestamp: Date.parse("2026-08-13T07:00:00.000Z") }], [{ id: "old", action: "buy", barTimestamp: Date.parse("2026-08-12T01:00:00.000Z") }], "old");
  assert.equal(markers.length, 0);
});

test("shows the complete trade range initially and defaults to 120 recent bars without trades", () => {
  assert.deepEqual(initialPaperKlineWindow(200, [20, 90, 160]), { visibleCount: 190, endOffset: 0 });
  assert.deepEqual(initialPaperKlineWindow(200, []), { visibleCount: 120, endOffset: 0 });
});
