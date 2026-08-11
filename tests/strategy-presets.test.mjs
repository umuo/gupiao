import assert from "node:assert/strict";
import test from "node:test";
import { indicatorGroups, indicatorLabels, sanitizeStrategyDraft, strategyPresets } from "../app/strategy-model.ts";

test("groups every supported indicator exactly once", () => {
  const grouped = indicatorGroups.flatMap((group) => group.keys);
  assert.equal(grouped.length, new Set(grouped).size);
  assert.deepEqual(new Set(grouped), new Set(Object.keys(indicatorLabels)));
  assert.ok(grouped.includes("macdDif"));
  assert.ok(grouped.includes("bollingerLower20"));
  assert.ok(grouped.includes("atr14Percent"));
  assert.ok(grouped.includes("roc20"));
  assert.ok(grouped.includes("amountRatio20"));
});

test("provides editable, valid one-click strategy presets", () => {
  assert.equal(strategyPresets.length, 5);
  assert.deepEqual(strategyPresets.map((preset) => preset.id), ["steady-trend", "macd-trend", "bollinger-reversion", "volume-breakout", "low-vol-defense"]);
  strategyPresets.forEach((preset) => {
    assert.deepEqual(sanitizeStrategyDraft(preset.draft), preset.draft);
    assert.ok(preset.draft.entryRules.length <= 5);
    assert.ok(preset.draft.exitRules.length <= 5);
  });
});
