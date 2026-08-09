import assert from "node:assert/strict";
import test from "node:test";

import { aShareTradingDayStatus, nextAShareTradingDay } from "../app/trading-calendar.ts";

test("uses the official 2026 A-share holiday calendar", () => {
  assert.equal(aShareTradingDayStatus("2026-02-23").isTradingDay, false);
  assert.equal(aShareTradingDayStatus("2026-02-23").reason, "春节休市");
  assert.equal(nextAShareTradingDay("2026-02-13"), "2026-02-24");
  assert.equal(aShareTradingDayStatus("2026-10-08").isTradingDay, true);
});

test("always closes weekends and labels uncovered years as fallback", () => {
  assert.equal(aShareTradingDayStatus("2027-01-02").reason, "周末休市");
  assert.equal(aShareTradingDayStatus("2027-01-04").coverage, "weekday-fallback");
});
