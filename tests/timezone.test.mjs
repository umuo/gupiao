import assert from "node:assert/strict";
import test from "node:test";
import { appDateKey, formatAppDate, formatAppDateTime, toAppIsoString } from "../app/timezone.ts";

test("treats SQLite CURRENT_TIMESTAMP values as UTC before displaying them in Shanghai", () => {
  const expected = "2026/08/10 10:54:05";

  assert.equal(formatAppDateTime("2026-08-10 02:54:05"), expected);
  assert.equal(formatAppDateTime("2026-08-10T02:54:05.000Z"), expected);
  assert.equal(formatAppDateTime("2026-08-10T10:54:05+08:00"), expected);
});

test("uses the same UTC normalization for date-only display and app date keys", () => {
  assert.equal(formatAppDate("2026-08-10 18:30:00"), "2026/08/11");
  assert.equal(appDateKey("2026-08-10 18:30:00"), "2026-08-11");
  assert.equal(toAppIsoString("2026-08-10 18:30:00"), "2026-08-11T02:30:00+08:00");
});

test("returns the display fallback for invalid timestamps", () => {
  assert.equal(formatAppDateTime("not-a-date"), "—");
  assert.equal(formatAppDate("not-a-date"), "—");
});
