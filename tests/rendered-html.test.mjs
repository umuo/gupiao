import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("builds the strategy automation and realtime configuration surfaces", async () => {
  const [page, tasks, notifications, worker] = await Promise.all([
    read("app/page.tsx"),
    read("app/task-center.tsx"),
    read("app/notification-center.tsx"),
    read("worker/index.ts"),
  ]);
  assert.match(page, /定时任务/);
  assert.match(page, /通知配置/);
  assert.match(tasks, /实时任务需要先配置 TickFlow Key/);
  assert.doesNotMatch(tasks, /Webhook URL/);
  assert.match(notifications, /Webhook URL/);
  assert.match(notifications, /Message Template/);
  assert.match(notifications, /Content-Type/);
  assert.match(worker, /scheduled/);
  assert.match(worker, /runDueAutomations/);
});

test("keeps TickFlow credentials protected and persists notification state", async () => {
  const [schema, migration, channelMigration, separationMigration, secretBox, tickflowRoute, runner, delivery] = await Promise.all([
    read("db/schema.ts"),
    read("drizzle/0002_flat_aaron_stack.sql"),
    read("drizzle/0003_nappy_robbie_robertson.sql"),
    read("drizzle/0004_fuzzy_freak.sql"),
    read("app/secret-box.ts"),
    read("app/api/settings/tickflow/route.ts"),
    read("app/automation-runner.ts"),
    read("app/notification-delivery.ts"),
  ]);
  assert.match(schema, /tickflowApiKeyEncrypted/);
  assert.match(schema, /notificationLogs/);
  assert.match(migration, /CREATE TABLE `automations`/);
  assert.match(migration, /CREATE TABLE `notification_logs`/);
  assert.match(channelMigration, /CREATE TABLE `notification_channels`/);
  assert.match(separationMigration, /DROP COLUMN `webhook_url`/);
  assert.match(secretBox, /AES-GCM/);
  assert.doesNotMatch(tickflowRoute, /tickflowApiKeyEncrypted[^\n]*Response\.json/);
  assert.match(runner, /x-api-key|fetchTickFlowQuote/);
  assert.match(runner, /相同信号今日已通知/);
  assert.match(delivery, /headersEncrypted/);
  assert.match(delivery, /renderMessageTemplate/);
});
