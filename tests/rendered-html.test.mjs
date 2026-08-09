import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("builds the strategy automation and realtime configuration surfaces", async () => {
  const [page, tasks, notifications, users, worker] = await Promise.all([
    read("app/page.tsx"),
    read("app/task-center.tsx"),
    read("app/notification-center.tsx"),
    read("app/user-management.tsx"),
    read("worker/index.ts"),
  ]);
  assert.match(page, /定时任务/);
  assert.match(page, /通知配置/);
  assert.match(page, /chart-tooltip/);
  assert.match(page, /左右方向键查看具体价格/);
  assert.match(tasks, /实时任务需要先配置 TickFlow Key/);
  assert.match(tasks, /可多选/);
  assert.match(tasks, /notificationChannelIds/);
  assert.match(tasks, /设置渠道/);
  assert.doesNotMatch(tasks, /Webhook URL/);
  assert.match(notifications, /Webhook URL/);
  assert.match(notifications, /Message Template/);
  assert.match(notifications, /Content-Type/);
  assert.match(notifications, /钉钉通知/);
  assert.match(notifications, /飞书通知/);
  assert.match(notifications, /测试连通性/);
  assert.match(page, /用户管理/);
  assert.match(users, /新增普通用户/);
  assert.match(users, /\/api\/admin\/users/);
  assert.match(worker, /scheduled/);
  assert.match(worker, /runDueAutomations/);
});

test("keeps public registration closed and initializes the administrator securely", async () => {
  const [authGate, auth, loginCrypto, loginRoute, adminUsersRoute] = await Promise.all([
    read("app/auth-gate.tsx"),
    read("app/auth.ts"),
    read("app/login-crypto.ts"),
    read("app/api/auth/login/route.ts"),
    read("app/api/admin/users/route.ts"),
  ]);
  assert.match(authGate, /系统已关闭公开注册/);
  assert.doesNotMatch(authGate, /api\/auth\/register/);
  await assert.rejects(read("app/api/auth/register/route.ts"), { code: "ENOENT" });
  assert.match(auth, /DEFAULT_ADMIN_PASSWORD/);
  assert.match(auth, /ensureDefaultAdmin/);
  assert.match(authGate, /RSA-OAEP/);
  assert.match(authGate, /AES-GCM/);
  assert.doesNotMatch(authGate, /JSON\.stringify\(\{ email, password \}\)/);
  assert.match(loginCrypto, /LOGIN_PRIVATE_KEY_JWK/);
  assert.match(loginCrypto, /LOGIN_CHALLENGE_SECONDS/);
  assert.match(loginRoute, /decryptLoginEnvelope/);
  assert.doesNotMatch(loginRoute, /payload\.password/);
  assert.match(adminUsersRoute, /admin\.role !== "superadmin"/);
  assert.match(adminUsersRoute, /role: "user"/);
});

test("keeps TickFlow credentials protected and persists notification state", async () => {
  const [schema, migration, channelMigration, separationMigration, multiChannelMigration, secretBox, tickflowRoute, runner, delivery] = await Promise.all([
    read("db/schema.ts"),
    read("drizzle/0002_flat_aaron_stack.sql"),
    read("drizzle/0003_nappy_robbie_robertson.sql"),
    read("drizzle/0004_fuzzy_freak.sql"),
    read("drizzle/0005_silly_nick_fury.sql"),
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
  assert.match(multiChannelMigration, /CREATE TABLE `automation_notification_channels`/);
  assert.match(multiChannelMigration, /DROP COLUMN `notification_channel_id`/);
  assert.match(secretBox, /AES-GCM/);
  assert.doesNotMatch(tickflowRoute, /tickflowApiKeyEncrypted[^\n]*Response\.json/);
  assert.match(runner, /x-api-key|fetchTickFlowQuote/);
  assert.match(runner, /相同信号今日已通知/);
  assert.match(runner, /Promise\.all\(channels\.map/);
  assert.match(delivery, /headersEncrypted/);
  assert.match(delivery, /renderMessageTemplate/);
});
