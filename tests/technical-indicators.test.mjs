import assert from "node:assert/strict";
import test from "node:test";
import {
  activityRatio,
  atrPercent,
  bollingerBand,
  calculateRsi,
  exponentialMovingAverage,
  macdValue,
  movingAverage,
  previousExtreme,
  rateOfChange,
} from "../app/technical-indicators.ts";

const bars = Array.from({ length: 160 }, (_, index) => {
  const close = index + 1;
  return { open: close - 0.5, high: close + 1, low: close - 1, close, volume: index === 159 ? 200 : 100, amount: index === 159 ? 3_000 : 1_000 };
});

test("calculates trend and MACD indicators on a rising series", () => {
  assert.equal(movingAverage(bars, 119, 120), 60.5);
  assert.ok(exponentialMovingAverage(bars, 159, 12) > exponentialMovingAverage(bars, 159, 26));
  assert.ok(macdValue(bars, 159, "dif") > 0);
  assert.ok(macdValue(bars, 159, "signal") > 0);
  assert.ok(macdValue(bars, 159, "histogram") >= 0);
});

test("calculates momentum, volatility, activity, and breakout indicators", () => {
  const upper = bollingerBand(bars, 159, "upper");
  const lower = bollingerBand(bars, 159, "lower");
  assert.ok(upper > movingAverage(bars, 159, 20));
  assert.ok(lower < movingAverage(bars, 159, 20));
  assert.equal(calculateRsi(bars, 159), 100);
  assert.ok(Math.abs(rateOfChange(bars, 159) - 14.28571428571428) < 1e-9);
  assert.equal(atrPercent(bars, 159), 1.25);
  assert.equal(activityRatio(bars, 159, "volume"), 2);
  assert.equal(activityRatio(bars, 159, "amount"), 3);
  assert.equal(previousExtreme(bars, 159, "high"), 160);
  assert.equal(previousExtreme(bars, 159, "low"), 139);
});
