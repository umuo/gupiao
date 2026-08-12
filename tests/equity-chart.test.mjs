import assert from "node:assert/strict";
import test from "node:test";
import { calculateEquityAxisScale, formatEquityAxisMoney } from "../app/equity-chart.ts";

test("scales the Y axis from observed equity instead of forcing initial capital into view", () => {
  const scale = calculateEquityAxisScale([20_724, 20_780]);
  assert.ok(scale);
  assert.ok(scale.minimum < 20_724);
  assert.ok(scale.maximum > 20_780);
  assert.ok(scale.minimum > 20_000);
});

test("creates a readable range around a single equity snapshot", () => {
  const scale = calculateEquityAxisScale([20_724]);
  assert.ok(scale);
  assert.equal(scale.ticks.length, 5);
  assert.ok(scale.minimum < 20_724);
  assert.ok(scale.maximum > 20_724);
  assert.equal(new Set(scale.ticks.map((value) => formatEquityAxisMoney(value, scale.step))).size, 5);
});

test("keeps both gains and losses inside the dynamic Y axis range", () => {
  const scale = calculateEquityAxisScale([19_420, 20_000, 20_735]);
  assert.ok(scale);
  assert.ok(scale.minimum < 19_420);
  assert.ok(scale.maximum > 20_735);
});

test("formats ordinary account values as distinct exact amounts", () => {
  assert.equal(formatEquityAxisMoney(20_750, 250), "¥20,750");
  assert.equal(formatEquityAxisMoney(20_725.5, .5), "¥20,725.5");
});
