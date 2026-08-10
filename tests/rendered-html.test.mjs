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
  const [authGate, authCryptoClient, auth, loginCrypto, loginRoute, passwordRoute, adminUsersRoute, userManagement] = await Promise.all([
    read("app/auth-gate.tsx"),
    read("app/auth-crypto-client.ts"),
    read("app/auth.ts"),
    read("app/login-crypto.ts"),
    read("app/api/auth/login/route.ts"),
    read("app/api/auth/password/route.ts"),
    read("app/api/admin/users/route.ts"),
    read("app/user-management.tsx"),
  ]);
  assert.match(authGate, /系统已关闭公开注册/);
  assert.doesNotMatch(authGate, /api\/auth\/register/);
  await assert.rejects(read("app/api/auth/register/route.ts"), { code: "ENOENT" });
  assert.match(auth, /DEFAULT_ADMIN_PASSWORD/);
  assert.match(auth, /ensureDefaultAdmin/);
  assert.match(authGate, /encryptAuthCredentials/);
  assert.match(authCryptoClient, /RSA-OAEP/);
  assert.match(authCryptoClient, /AES-GCM/);
  assert.doesNotMatch(authGate, /JSON\.stringify\(\{ email, password \}\)/);
  assert.match(loginCrypto, /LOGIN_PRIVATE_KEY_JWK/);
  assert.match(loginCrypto, /LOGIN_CHALLENGE_SECONDS/);
  assert.match(loginRoute, /decryptLoginEnvelope/);
  assert.doesNotMatch(loginRoute, /payload\.password/);
  assert.match(passwordRoute, /admin\.role !== "superadmin"/);
  assert.match(passwordRoute, /export async function GET/);
  assert.match(passwordRoute, /createLoginEncryptionOffer\(request, PASSWORD_CHALLENGE_PATH\)/);
  assert.match(passwordRoute, /verifyPassword\(currentPassword/);
  assert.match(passwordRoute, /管理员新密码需要12到128位/);
  assert.match(passwordRoute, /新密码不能与当前密码相同/);
  assert.match(passwordRoute, /db\.batch/);
  assert.match(passwordRoute, /db\.delete\(sessions\)/);
  assert.match(passwordRoute, /clearSessionCookie/);
  assert.match(adminUsersRoute, /admin\.role !== "superadmin"/);
  assert.match(adminUsersRoute, /role: "user"/);
  assert.match(adminUsersRoute, /export async function PATCH/);
  assert.match(adminUsersRoute, /export async function DELETE/);
  assert.match(adminUsersRoute, /超级管理员账号受保护/);
  assert.match(adminUsersRoute, /db\.batch/);
  assert.match(adminUsersRoute, /paperAccounts/);
  assert.match(adminUsersRoute, /notificationChannels/);
  assert.match(userManagement, /查找用户/);
  assert.match(userManagement, /重置密码（可选）/);
  assert.match(userManagement, /永久删除/);
  assert.match(userManagement, /修改管理员密码/);
  assert.match(userManagement, /当前管理员密码/);
  assert.match(userManagement, /修改密码并退出所有设备/);
  assert.match(userManagement, /encryptAuthCredentials/);
  assert.doesNotMatch(userManagement, /body: JSON\.stringify\(\{ currentAdminPassword/);
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

test("persists paper accounts and keeps simulated execution independent from notification delivery", async () => {
  const [schema, migration, center, accountRoute, refreshRoute, service, runner, tasks, page] = await Promise.all([
    read("db/schema.ts"),
    read("drizzle/0006_nostalgic_franklin_storm.sql"),
    read("app/paper-account-center.tsx"),
    read("app/api/paper-accounts/route.ts"),
    read("app/api/paper-accounts/refresh/route.ts"),
    read("app/paper-account-service.ts"),
    read("app/automation-runner.ts"),
    read("app/task-center.tsx"),
    read("app/page.tsx"),
  ]);
  assert.match(schema, /paperAccounts/);
  assert.match(schema, /paperPositions/);
  assert.match(schema, /paperTrades/);
  assert.match(schema, /paperEquitySnapshots/);
  assert.match(schema, /paperAccountId: text\("paper_account_id"\)/);
  assert.match(migration, /CREATE TABLE .*paper_accounts/);
  assert.match(migration, /idx_paper_trades_account_idempotency/);
  assert.match(migration, /PRAGMA optimize/);
  assert.match(accountRoute, /export async function GET/);
  assert.match(accountRoute, /export async function POST/);
  assert.match(accountRoute, /export async function PATCH/);
  assert.match(accountRoute, /export async function DELETE/);
  assert.match(refreshRoute, /fetchTickFlowKlines/);
  assert.match(service, /executePaperSignal/);
  assert.match(service, /db\.batch/);
  assert.match(runner, /refreshPaperAccountValuation/);
  assert.ok(runner.indexOf("executePaperSignal") < runner.indexOf("deliverNotification(channel"));
  assert.doesNotMatch(runner, /所有通知渠道均投递失败/);
  assert.match(center, /更新今日收益/);
  assert.match(center, /配置定时任务/);
  assert.match(tasks, /targetAccount/);
  assert.match(tasks, /关联模拟盘/);
  assert.match(page, /我的模拟盘/);
  assert.match(page, /临时回测资金/);
});

test("keeps every product surface reachable and usable on mobile", async () => {
  const [page, layout, styles] = await Promise.all([
    read("app/page.tsx"),
    read("app/layout.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(page, /mobile-nav/);
  assert.match(page, /手机端主导航/);
  assert.match(page, /onPointerDown=\{handlePointerDown\}/);
  assert.match(page, /onWheel=\{handleWheel\}/);
  assert.match(layout, /viewportFit: "cover"/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /height: 100dvh/);
  assert.match(styles, /\.notification-row/);
  assert.match(styles, /\.managed-user-list article/);
});

test("loads listing-to-present history and exposes interactive K-line strategy tabs", async () => {
  const [page, tickflowRoute, strategyModel, strategyEngine, styles] = await Promise.all([
    read("app/page.tsx"),
    read("app/api/tickflow/route.ts"),
    read("app/strategy-model.ts"),
    read("app/strategy-engine.ts"),
    read("app/globals.css"),
  ]);
  assert.match(page, /count=10000/);
  assert.match(tickflowRoute, /Math\.min\(10_000/);
  assert.match(page, /MA5/);
  assert.match(page, /MA10/);
  assert.match(page, /MA30/);
  assert.match(page, /自定义 MA/);
  assert.match(page, /拖动浏览历史K线/);
  assert.match(page, /短线策略/);
  assert.match(page, /中期策略/);
  assert.match(page, /长线策略/);
  assert.match(page, /role="tablist"/);
  assert.match(page, /MA5 回踩反转/);
  assert.match(page, /RSI 趋势修复/);
  assert.match(page, /长期多头排列/);
  assert.ok((page.match(/builtin: true/g) ?? []).length >= 12);
  assert.match(strategyModel, /ma30/);
  assert.match(strategyModel, /ma60/);
  assert.match(strategyEngine, /movingAverage\(bars, index, 30\)/);
  assert.match(strategyEngine, /movingAverage\(bars, index, 60\)/);
  assert.match(strategyEngine, /indicatorWarmup/);
  assert.match(styles, /\.chart-navigator/);
  assert.match(styles, /\.strategy-group/);
  assert.match(styles, /\.strategy-tabs/);
});

test("serves stock-name search from a generated catalog with bounded upstream waits", async () => {
  const [page, searchRoute, catalogSource, refreshScript] = await Promise.all([
    read("app/page.tsx"),
    read("app/api/tickflow/search/route.ts"),
    read("app/stock-catalog.generated.json"),
    read("scripts/refresh-stock-catalog.mjs"),
  ]);
  const catalog = JSON.parse(catalogSource);
  assert.ok(catalog.length > 5_000);
  assert.ok(catalog.some((item) => item.name === "中国移动" && item.symbol === "600941.SH"));
  assert.match(searchRoute, /stock-catalog\.generated\.json/);
  assert.match(searchRoute, /controller\.abort\(\), 6_000/);
  assert.doesNotMatch(searchRoute, /loadCatalog/);
  assert.match(page, /requestController\.abort\(\), 15_000/);
  assert.match(refreshScript, /exchanges = \["SH", "SZ", "BJ"\]/);
});

test("pins scheduling, notifications, and displayed records to Asia Shanghai", async () => {
  const [timezone, schema, automationRoute, runner, notificationTest, service, tasks, notifications, paperAccounts, users] = await Promise.all([
    read("app/timezone.ts"),
    read("db/schema.ts"),
    read("app/api/automations/route.ts"),
    read("app/automation-runner.ts"),
    read("app/api/notification-channels/test/route.ts"),
    read("app/paper-account-service.ts"),
    read("app/task-center.tsx"),
    read("app/notification-center.tsx"),
    read("app/paper-account-center.tsx"),
    read("app/user-management.tsx"),
  ]);
  assert.match(timezone, /APP_TIME_ZONE = "Asia\/Shanghai"/);
  assert.match(timezone, /\+08:00/);
  assert.match(schema, /timezone: text\("timezone"\).*default\("Asia\/Shanghai"\)/);
  assert.match(automationRoute, /timezone: APP_TIME_ZONE/);
  assert.match(runner, /timeZone: APP_TIME_ZONE/);
  assert.match(runner, /marketTime: toAppIsoString/);
  assert.match(notificationTest, /marketTime: toAppIsoString/);
  assert.match(service, /appDateKey/);
  assert.match(tasks, /所有任务统一使用/);
  assert.match(tasks, /item\.timezone/);
  assert.match(notifications, /DELIVERY LOG · ASIA\/SHANGHAI/);
  assert.match(paperAccounts, /TRADES · ASIA\/SHANGHAI/);
  const uiTimeRendering = [tasks, notifications, paperAccounts, users].join("\n");
  assert.doesNotMatch(uiTimeRendering, /new Date\([^\n]*\)\.toLocale(?:Date)?String/);
});

test("adds exchange-calendar scheduling, reliable execution history, bounded data access, and reproducible strategy snapshots", async () => {
  const [calendar, schema, migration, runner, runRoute, accountRoute, accountRefresh, taskCenter, paperCenter, strategyRoute, strategyStudio] = await Promise.all([
    read("app/trading-calendar.ts"),
    read("db/schema.ts"),
    read("drizzle/0007_cynical_miek.sql"),
    read("app/automation-runner.ts"),
    read("app/api/automation-runs/route.ts"),
    read("app/api/paper-accounts/route.ts"),
    read("app/api/paper-accounts/refresh/route.ts"),
    read("app/task-center.tsx"),
    read("app/paper-account-center.tsx"),
    read("app/api/strategies/route.ts"),
    read("app/strategy-studio.tsx"),
  ]);
  assert.match(calendar, /officialClosures/);
  assert.match(calendar, /2026-10-07/);
  assert.match(calendar, /nextAShareTradingDay/);
  assert.match(schema, /automationRuns/);
  assert.match(schema, /idx_automation_runs_schedule/);
  assert.match(schema, /strategyVersions/);
  assert.match(migration, /CREATE TABLE `automation_runs`/);
  assert.match(migration, /CREATE TABLE `strategy_versions`/);
  assert.match(migration, /PRAGMA optimize/);
  assert.match(runner, /scheduleKeyFor/);
  assert.match(runner, /RUN_LEASE_MS/);
  assert.match(runner, /mapWithConcurrency\(candidates, 4/);
  assert.match(runner, /status: retrying \? "retrying" : "failed"/);
  assert.match(runRoute, /nextCursor/);
  assert.match(accountRoute, /pageSize/);
  assert.doesNotMatch(accountRoute, /limit\(1000\)/);
  assert.match(accountRefresh, /mapSettledWithConcurrency/);
  assert.match(taskCenter, /运行记录/);
  assert.match(taskCenter, /交易所官方日历/);
  assert.match(paperCenter, /paper-pagination/);
  assert.match(strategyRoute, /strategySnapshotHash/);
  assert.match(strategyStudio, /不可变规则快照/);
});
