import assert from "node:assert/strict";
import test from "node:test";
import { appendPaperIntradayBars, initialPaperKlineWindow, mapPaperTradesToBars, paperMarketDateKey } from "../app/paper-kline-model.ts";

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

test("adds a provisional current-day K-line so every intraday trade gets a marker", () => {
  const bars = [{ timestamp: Date.parse("2026-08-12T00:00:00.000Z"), open: 66.46, high: 66.77, low: 64.51, close: 65.6, volume: 1, amount: 1 }];
  const trades = [
    { id: "first-buy", action: "buy", barTimestamp: Date.parse("2026-08-12T05:56:00.000Z"), executionPrice: 65.2652 },
    { id: "sell", action: "sell", barTimestamp: Date.parse("2026-08-13T01:31:00.000Z"), executionPrice: 67.29264 },
    { id: "buy-again", action: "buy", barTimestamp: Date.parse("2026-08-13T01:37:00.000Z"), executionPrice: 67.64758 },
  ];
  const chartBars = appendPaperIntradayBars(bars, trades, {
    timestamp: Date.parse("2026-08-13T01:40:00.000Z"),
    lastPrice: 67.5,
  });
  assert.equal(chartBars.length, 2);
  assert.deepEqual(chartBars[1], {
    timestamp: Date.parse("2026-08-13T01:40:00.000Z"),
    open: 67.29264,
    high: 67.64758,
    low: 67.29264,
    close: 67.5,
    volume: 0,
    amount: 0,
    provisional: true,
  });
  assert.deepEqual(mapPaperTradesToBars(chartBars, trades, "first-buy").map(({ id, index }) => ({ id, index })), [
    { id: "first-buy", index: 0 },
    { id: "sell", index: 1 },
    { id: "buy-again", index: 1 },
  ]);
});

test("uses realtime quote OHLC values for the provisional current-day K-line", () => {
  const bars = [{ timestamp: Date.parse("2026-08-12T00:00:00.000Z"), open: 66, high: 67, low: 65, close: 66, volume: 1, amount: 1 }];
  const chartBars = appendPaperIntradayBars(bars, [], {
    timestamp: Date.parse("2026-08-13T02:00:00.000Z"),
    open: 66.8,
    high: 68.2,
    low: 66.5,
    lastPrice: 67.9,
    volume: 123,
    amount: 456,
  });
  assert.deepEqual(chartBars[1], {
    timestamp: Date.parse("2026-08-13T02:00:00.000Z"),
    open: 66.8,
    high: 68.2,
    low: 66.5,
    close: 67.9,
    volume: 123,
    amount: 456,
    provisional: true,
  });
});

test("shows the complete trade range initially and defaults to 120 recent bars without trades", () => {
  assert.deepEqual(initialPaperKlineWindow(200, [20, 90, 160]), { visibleCount: 190, endOffset: 0 });
  assert.deepEqual(initialPaperKlineWindow(200, []), { visibleCount: 120, endOffset: 0 });
});
