import assert from "node:assert/strict";
import test from "node:test";
import { notificationSignalKeyAfterDelivery, repeatedNotificationAlreadySent, skipRepeatedSignalBeforeExecution } from "../app/automation-outcome.ts";

test("does not suppress a signal that was recorded without a successful notification", () => {
  const key = "buy:2026-08-12:signal";
  assert.equal(repeatedNotificationAlreadySent(key, key, null), false);
  assert.equal(notificationSignalKeyAfterDelivery(key, key, 0), null);
});

test("deduplicates only after at least one channel actually accepted the notification", () => {
  const key = "buy:2026-08-12:signal";
  const notifiedKey = notificationSignalKeyAfterDelivery(key, null, 1);
  assert.equal(notifiedKey, key);
  assert.equal(repeatedNotificationAlreadySent(key, notifiedKey, "2026-08-12T05:30:00.000Z"), true);
});

test("keeps retrying paper execution after a rejected order without resending the same warning", () => {
  assert.equal(skipRepeatedSignalBeforeExecution(true, true), false);
  assert.equal(skipRepeatedSignalBeforeExecution(true, false), true);
});
