import assert from "node:assert/strict";
import test from "node:test";
import { paperPositionSellEligibility, paperTradeExecutionKey } from "../app/paper-trading-rules.ts";

test("uses the automation run id so separate intraday signals cannot share a trade key", () => {
  const first = paperTradeExecutionKey("task-1", "run-0931", "sell");
  const retry = paperTradeExecutionKey("task-1", "run-0931", "sell");
  const laterSignal = paperTradeExecutionKey("task-1", "run-0943", "sell");
  assert.equal(first, retry);
  assert.notEqual(first, laterSignal);
});

test("blocks selling an A-share position on its Shanghai purchase date", () => {
  const openedAt = "2026-08-13T01:37:37.473Z";
  const sameShanghaiDate = new Date("2026-08-13T07:00:00.000Z");
  const result = paperPositionSellEligibility(openedAt, sameShanghaiDate);
  assert.equal(result.allowed, false);
  assert.match(result.reason, /T\+1/);
});

test("allows selling after the Shanghai purchase date has passed", () => {
  const openedAt = "2026-08-13T01:37:37.473Z";
  const nextShanghaiDate = new Date("2026-08-14T01:30:00.000Z");
  assert.equal(paperPositionSellEligibility(openedAt, nextShanghaiDate).allowed, true);
});

test("does not treat a weekend as the next sellable trading day", () => {
  const fridayPosition = "2026-08-14T01:37:37.473Z";
  const saturday = new Date("2026-08-15T01:30:00.000Z");
  const monday = new Date("2026-08-17T01:30:00.000Z");
  assert.equal(paperPositionSellEligibility(fridayPosition, saturday).allowed, false);
  assert.equal(paperPositionSellEligibility(fridayPosition, monday).allowed, true);
});

test("fails closed when a position has an invalid opening date", () => {
  assert.equal(paperPositionSellEligibility("invalid", new Date("2026-08-14T01:30:00.000Z")).allowed, false);
});
