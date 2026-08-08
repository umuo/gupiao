import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("builds the strategy automation and realtime configuration surfaces", async () => {
  const [page, center, worker] = await Promise.all([
    read("app/page.tsx"),
    read("app/automation-center.tsx"),
    read("worker/index.ts"),
  ]);
  assert.match(page, /定时任务与通知/);
  assert.match(center, /实时任务需要先配置 TickFlow Key/);
  assert.match(center, /测试 Webhook/);
  assert.match(center, /09:30–11:30、13:00–15:00/);
  assert.match(worker, /scheduled/);
  assert.match(worker, /runDueAutomations/);
});

test("keeps TickFlow credentials protected and persists notification state", async () => {
  const [schema, migration, secretBox, tickflowRoute, runner] = await Promise.all([
    read("db/schema.ts"),
    read("drizzle/0002_flat_aaron_stack.sql"),
    read("app/secret-box.ts"),
    read("app/api/settings/tickflow/route.ts"),
    read("app/automation-runner.ts"),
  ]);
  assert.match(schema, /tickflowApiKeyEncrypted/);
  assert.match(schema, /notificationLogs/);
  assert.match(migration, /CREATE TABLE `automations`/);
  assert.match(migration, /CREATE TABLE `notification_logs`/);
  assert.match(secretBox, /AES-GCM/);
  assert.doesNotMatch(tickflowRoute, /tickflowApiKeyEncrypted[^\n]*Response\.json/);
  assert.match(runner, /x-api-key|fetchTickFlowQuote/);
  assert.match(runner, /相同信号今日已通知/);
});
