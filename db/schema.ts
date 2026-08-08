import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["user", "superadmin"] }).notNull().default("user"),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_users_email").on(table.email)]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_sessions_user_id").on(table.userId), index("idx_sessions_expires_at").on(table.expiresAt)]);

export const customStrategies = sqliteTable("custom_strategies", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  tag: text("tag").notNull().default("自定义"),
  definition: text("definition").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_custom_strategies_user_id").on(table.userId)]);

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id").primaryKey(),
  aiBaseUrl: text("ai_base_url").notNull().default("https://api.openai.com/v1"),
  aiModel: text("ai_model").notNull().default("gpt-4.1-mini"),
  tickflowApiKeyEncrypted: text("tickflow_api_key_encrypted"),
  tickflowKeyHint: text("tickflow_key_hint"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const notificationChannels = sqliteTable("notification_channels", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  type: text("type", { enum: ["webhook", "dingtalk", "feishu"] }).notNull().default("webhook"),
  url: text("url").notNull(),
  method: text("method", { enum: ["GET", "POST", "PUT", "PATCH"] }).notNull().default("POST"),
  headersEncrypted: text("headers_encrypted").notNull(),
  headerNames: text("header_names").notNull().default("[]"),
  contentType: text("content_type", { enum: ["application/json", "application/x-www-form-urlencoded", "text/plain"] }).notNull().default("application/json"),
  messageTemplate: text("message_template").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastTestAt: text("last_test_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_notification_channels_user_id").on(table.userId)]);

export const automations = sqliteTable("automations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  stockName: text("stock_name").notNull(),
  strategyId: text("strategy_id").notNull(),
  strategyName: text("strategy_name").notNull(),
  strategyDefinition: text("strategy_definition").notNull(),
  dataMode: text("data_mode", { enum: ["daily", "realtime"] }).notNull().default("daily"),
  runTime: text("run_time").notNull().default("09:35"),
  intervalMinutes: integer("interval_minutes").notNull().default(5),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  weekdays: text("weekdays").notNull().default("[1,2,3,4,5]"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  positionState: text("position_state", { enum: ["flat", "holding"] }).notNull().default("flat"),
  entryPrice: real("entry_price"),
  stopLoss: real("stop_loss").notNull().default(8),
  takeProfit: real("take_profit").notNull().default(22),
  lastCheckedBar: integer("last_checked_bar"),
  lastRunDate: text("last_run_date"),
  lastRunAt: text("last_run_at"),
  lastSignalKey: text("last_signal_key"),
  lastNotifiedAt: text("last_notified_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_automations_user_id").on(table.userId),
  index("idx_automations_enabled_time").on(table.enabled, table.runTime),
]);

export const automationNotificationChannels = sqliteTable("automation_notification_channels", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  automationId: text("automation_id").notNull(),
  notificationChannelId: text("notification_channel_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_automation_channels_automation_id").on(table.automationId),
  index("idx_automation_channels_channel_id").on(table.notificationChannelId),
  uniqueIndex("idx_automation_channels_unique").on(table.automationId, table.notificationChannelId),
]);

export const notificationLogs = sqliteTable("notification_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  automationId: text("automation_id"),
  notificationChannelId: text("notification_channel_id"),
  type: text("type", { enum: ["buy", "sell", "test", "error"] }).notNull(),
  status: text("status", { enum: ["success", "failed"] }).notNull(),
  symbol: text("symbol").notNull(),
  price: real("price"),
  reason: text("reason").notNull().default(""),
  payload: text("payload").notNull().default("{}"),
  httpStatus: integer("http_status"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_notification_logs_user_created").on(table.userId, table.createdAt),
  index("idx_notification_logs_automation_id").on(table.automationId),
]);
