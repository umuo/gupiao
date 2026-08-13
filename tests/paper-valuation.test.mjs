import assert from "node:assert/strict";
import test from "node:test";
import { shouldApplyPaperValuation } from "../app/paper-valuation.ts";

test("rejects a daily valuation older than the account's current market date", () => {
  assert.equal(shouldApplyPaperValuation("2026-08-13", "2026-08-12"), false);
});

test("accepts same-day realtime updates and newer market dates", () => {
  assert.equal(shouldApplyPaperValuation("2026-08-13", "2026-08-13"), true);
  assert.equal(shouldApplyPaperValuation("2026-08-13", "2026-08-14"), true);
  assert.equal(shouldApplyPaperValuation(null, "2026-08-13"), true);
});

test("rejects malformed incoming market dates", () => {
  assert.equal(shouldApplyPaperValuation("2026-08-13", ""), false);
  assert.equal(shouldApplyPaperValuation("2026-08-13", "08/13/2026"), false);
});
