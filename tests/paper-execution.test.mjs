import assert from "node:assert/strict";
import test from "node:test";
import { calculatePaperBuyOrder } from "../app/paper-execution.ts";

test("rejects an order when the configured position cannot buy one A-share lot", () => {
  const order = calculatePaperBuyOrder({ cash: 10_000, positionPercent: 30, signalPrice: 65.4, commissionRate: 0.00025, slippageRate: 0.001 });
  assert.equal(order.shares, 0);
  assert.equal(order.allocation, 3_000);
  assert.equal(order.minimumPositionPercent, 66);
  assert.ok(order.requiredForOneLot > 6_550 && order.requiredForOneLot < 6_552);
});

test("buys one lot after the configured position covers price, slippage and commission", () => {
  const order = calculatePaperBuyOrder({ cash: 10_000, positionPercent: 66, signalPrice: 65.4, commissionRate: 0.00025, slippageRate: 0.001 });
  assert.equal(order.shares, 100);
  assert.ok(order.grossAmount + order.commission <= order.allocation);
});
