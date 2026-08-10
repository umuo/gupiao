import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { automationNotificationChannels, automationRuns, automations, notificationChannels, notificationLogs, userSettings } from "../db/schema";
import { deliverNotification } from "./notification-delivery";
import { decryptSecret } from "./secret-box";
import { executePaperSignal, paperAccountState, paperStrategiesFrom, refreshPaperAccountValuation, shanghaiDate } from "./paper-account-service";
import { combinedSignalFor } from "./strategy-combination";
import { type Kline, type SignalStrategy } from "./strategy-engine";
import { parseStrategySnapshots } from "./strategy-version";
import { fetchTickFlowKlines, fetchTickFlowQuote } from "./tickflow-client";
import { APP_TIME_ZONE, toAppIsoString } from "./timezone";
import { aShareTradingDayStatus } from "./trading-calendar";

type AutomationRow = typeof automations.$inferSelect;
type AutomationRunRow = typeof automationRuns.$inferSelect;

type ShanghaiClock = {
  date: string;
  weekday: number;
  minuteOfDay: number;
};

const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function shanghaiClock(date = new Date()): ShanghaiClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: weekdayMap[value("weekday")] ?? 7,
    minuteOfDay: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function parseMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function weekdaysOf(row: AutomationRow) {
  try {
    const values = JSON.parse(row.weekdays) as unknown;
    return Array.isArray(values) ? values.map(Number).filter((value) => value >= 1 && value <= 7) : [1, 2, 3, 4, 5];
  } catch {
    return [1, 2, 3, 4, 5];
  }
}

function inMainlandTradingSession(minuteOfDay: number) {
  return (minuteOfDay >= 570 && minuteOfDay <= 690) || (minuteOfDay >= 780 && minuteOfDay <= 900);
}

export function automationIsDue(row: AutomationRow, now = new Date()) {
  const clock = shanghaiClock(now);
  if (!row.enabled || !weekdaysOf(row).includes(clock.weekday) || !aShareTradingDayStatus(clock.date).isTradingDay) return false;
  if (row.dataMode === "daily") {
    if (clock.minuteOfDay < parseMinutes(row.runTime) || row.lastRunDate === clock.date) return false;
    return !row.lastRunAt || now.getTime() - new Date(row.lastRunAt).getTime() >= 15 * 60_000;
  }
  if (!inMainlandTradingSession(clock.minuteOfDay)) return false;
  if (!row.lastRunAt) return true;
  return now.getTime() - new Date(row.lastRunAt).getTime() >= row.intervalMinutes * 60_000;
}

function scheduleKeyFor(row: AutomationRow, now = new Date()) {
  const clock = shanghaiClock(now);
  if (row.dataMode === "daily") return `daily:${clock.date}`;
  const bucket = Math.floor(clock.minuteOfDay / row.intervalMinutes) * row.intervalMinutes;
  return `realtime:${clock.date}:${String(Math.floor(bucket / 60)).padStart(2, "0")}:${String(bucket % 60).padStart(2, "0")}`;
}

function strategiesFrom(row: AutomationRow): Array<SignalStrategy & { id: string; name: string }> {
  return parseStrategySnapshots(row.strategySnapshots, {
    id: row.strategyId,
    name: row.strategyName,
    definition: row.strategyDefinition,
    version: row.strategyVersion,
    contentHash: row.strategySnapshotHash,
  });
}

function mergeQuoteIntoDailyBars(bars: Kline[], quote: Awaited<ReturnType<typeof fetchTickFlowQuote>>) {
  const quoteDate = shanghaiClock(new Date(quote.timestamp)).date;
  const next = [...bars];
  const bar: Kline = {
    timestamp: quote.timestamp,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    close: quote.lastPrice,
    volume: quote.volume,
    amount: quote.amount,
  };
  const latest = next.at(-1);
  if (latest && shanghaiClock(new Date(latest.timestamp)).date === quoteDate) next[next.length - 1] = bar;
  else next.push(bar);
  return next;
}

async function writeLog(row: AutomationRow, input: {
  type: "buy" | "sell" | "test" | "error";
  status: "success" | "failed";
  price?: number;
  reason: string;
  payload?: Record<string, unknown>;
  httpStatus?: number;
  notificationChannelId?: string | null;
}) {
  await getDb().insert(notificationLogs).values({
    id: crypto.randomUUID(),
    userId: row.userId,
    automationId: row.id,
    notificationChannelId: input.notificationChannelId ?? null,
    type: input.type,
    status: input.status,
    symbol: row.symbol,
    price: input.price,
    reason: input.reason.slice(0, 500),
    payload: JSON.stringify(input.payload ?? {}),
    httpStatus: input.httpStatus,
  });
}

export async function runAutomation(row: AutomationRow) {
  const now = new Date();
  const clock = shanghaiClock(now);
  const paperState = row.paperAccountId ? await paperAccountState(row.paperAccountId, row.userId) : null;
  if (row.paperAccountId && !paperState) throw new Error("关联的模拟盘不存在");
  if (paperState?.account.status === "paused") throw new Error("关联的模拟盘已暂停");
  const symbol = paperState?.account.symbol ?? row.symbol;
  const stockName = paperState?.account.stockName ?? row.stockName;
  const stopLoss = paperState?.account.stopLoss ?? row.stopLoss;
  const takeProfit = paperState?.account.takeProfit ?? row.takeProfit;
  let bars = await fetchTickFlowKlines(symbol, 220);
  let source = "TickFlow 免费历史日K";

  if (row.dataMode === "realtime") {
    const tradingDay = aShareTradingDayStatus(clock.date);
    if (!tradingDay.isTradingDay) throw new Error(`当前为${tradingDay.reason}，本次不检查实时信号`);
    if (!weekdaysOf(row).includes(clock.weekday) || !inMainlandTradingSession(clock.minuteOfDay)) throw new Error("当前不在 A 股连续竞价时段，本次不检查实时信号");
    const [settings] = await getDb().select().from(userSettings).where(eq(userSettings.userId, row.userId)).limit(1);
    if (!settings?.tickflowApiKeyEncrypted) throw new Error("请先在定时任务的实时数据中配置 TickFlow Key");
    const quote = await fetchTickFlowQuote(symbol, await decryptSecret(settings.tickflowApiKeyEncrypted));
    if (shanghaiClock(new Date(quote.timestamp)).date !== clock.date) throw new Error("TickFlow 返回的不是今日实时行情，本次不触发信号");
    bars = mergeQuoteIntoDailyBars(bars, quote);
    source = "TickFlow 实时行情";
  }

  const bar = bars.at(-1);
  if (!bar || bars.length < 22) throw new Error("可用K线不足，暂时无法计算策略");
  if (paperState && row.paperAccountId) {
    await refreshPaperAccountValuation(row.paperAccountId, row.userId, bar.close, shanghaiDate(new Date(bar.timestamp)));
  }
  const strategies = paperState ? paperStrategiesFrom(paperState.account) : strategiesFrom(row);
  const isHolding = paperState ? Boolean(paperState.position) : row.positionState === "holding";
  const entryPrice = paperState?.position?.averageCost ?? row.entryPrice;
  let action: "buy" | "sell" | null = null;
  let reason = "";

  if (!isHolding) {
    const buy = combinedSignalFor(strategies, bars, bars.length - 1, "buy");
    if (buy.active) {
      action = "buy";
      reason = buy.reason;
    }
  } else {
    const returnRate = entryPrice ? (bar.close / entryPrice - 1) * 100 : 0;
    const sell = combinedSignalFor(strategies, bars, bars.length - 1, "sell");
    if (entryPrice && returnRate <= -stopLoss) {
      action = "sell";
      reason = `触发 ${stopLoss}% 止损`;
    } else if (entryPrice && returnRate >= takeProfit) {
      action = "sell";
      reason = `触发 ${takeProfit}% 止盈`;
    } else if (sell.active) {
      action = "sell";
      reason = sell.reason;
    }
  }

  const commonUpdate = {
    lastCheckedBar: bar.timestamp,
    lastRunAt: now.toISOString(),
    lastRunDate: row.dataMode === "daily" ? clock.date : row.lastRunDate,
    updatedAt: now.toISOString(),
  };
  if (!action) {
    await getDb().update(automations).set(commonUpdate).where(eq(automations.id, row.id));
    return { action: null, price: bar.close, reason: `${strategies.length} 个策略本次均未出现买卖信号`, source };
  }

  const signalKey = `${action}:${clock.date}:${reason}`;
  if (signalKey === row.lastSignalKey) {
    await getDb().update(automations).set(commonUpdate).where(eq(automations.id, row.id));
    return { action: null, price: bar.close, reason: "相同信号今日已通知", source };
  }

  const execution = paperState && row.paperAccountId ? await executePaperSignal({
    accountId: row.paperAccountId,
    userId: row.userId,
    automationId: row.id,
    action,
    signalPrice: bar.close,
    reason,
    barTimestamp: bar.timestamp,
    signalKey: `${row.id}:${signalKey}`,
  }) : null;
  if (execution && !execution.executed && !execution.duplicate) {
    await getDb().update(automations).set({ ...commonUpdate, lastSignalKey: signalKey }).where(eq(automations.id, row.id));
    return { action: null, price: bar.close, reason: execution.reason, source, execution };
  }

  const mappings = await getDb().select({ channelId: automationNotificationChannels.notificationChannelId }).from(automationNotificationChannels).where(and(eq(automationNotificationChannels.automationId, row.id), eq(automationNotificationChannels.userId, row.userId)));
  const channelIds = mappings.map((mapping) => mapping.channelId);
  const channels = channelIds.length ? await getDb().select().from(notificationChannels).where(and(eq(notificationChannels.userId, row.userId), inArray(notificationChannels.id, channelIds))) : [];

  if (!channels.length) {
    await writeLog(row, { type: "error", status: "failed", price: execution?.executionPrice ?? bar.close, reason: "模拟成交已记录，但任务没有可用的通知渠道" });
    await getDb().update(automations).set({
      ...commonUpdate,
      lastSignalKey: signalKey,
      positionState: action === "buy" ? "holding" : "flat",
      entryPrice: action === "buy" ? execution?.executionPrice ?? bar.close : null,
    }).where(eq(automations.id, row.id));
    return { action, price: execution?.executionPrice ?? bar.close, reason, source, execution, deliveries: { total: channelIds.length, succeeded: 0, failed: channelIds.length }, warning: "模拟成交已记录，但没有可用的通知渠道" };
  }

  const payload = {
    event: `strategy.${action}`,
    action,
    actionText: action === "buy" ? "买入" : "卖出",
    automationId: row.id,
    automationName: row.name,
    symbol,
    stockName,
    strategyId: row.strategyId,
    strategyName: strategies.map((strategy) => strategy.name).join("、"),
    strategyIds: strategies.map((strategy) => strategy.id),
    strategyNames: strategies.map((strategy) => strategy.name),
    price: execution?.executionPrice ?? bar.close,
    signalPrice: bar.close,
    executionPrice: execution?.executionPrice ?? bar.close,
    simulatedShares: execution?.shares ?? null,
    simulatedEquity: execution?.currentEquity ?? null,
    paperAccountId: row.paperAccountId,
    paperAccountName: paperState?.account.name ?? null,
    reason,
    dataMode: row.dataMode,
    source,
    marketTime: toAppIsoString(bar.timestamp),
    sentAt: toAppIsoString(now),
    notice: "仅为模拟策略信号，不构成投资建议或真实委托。",
  };
  const deliveryResults = await Promise.all(channels.map(async (channel) => {
    try {
      let delivered: Awaited<ReturnType<typeof deliverNotification>> | null = null;
      let deliveryError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 300 : 900));
        try {
          delivered = await deliverNotification(channel, payload);
          const retryable = !delivered.ok && (!delivered.status || delivered.status === 408 || delivered.status === 429 || delivered.status >= 500);
          if (!retryable) break;
        } catch (error) {
          deliveryError = error;
        }
      }
      if (!delivered) throw deliveryError instanceof Error ? deliveryError : new Error("通知投递失败");
      await writeLog(row, {
        type: action,
        status: delivered.ok ? "success" : "failed",
        price: bar.close,
        reason: delivered.ok ? reason : delivered.error || `通知渠道返回 HTTP ${delivered.status}`,
        payload,
        httpStatus: delivered.status,
        notificationChannelId: channel.id,
      });
      return delivered.ok;
    } catch (error) {
      await writeLog(row, {
        type: action,
        status: "failed",
        price: bar.close,
        reason: error instanceof Error ? error.message : "通知投递失败",
        payload,
        notificationChannelId: channel.id,
      });
      return false;
    }
  }));
  const succeeded = deliveryResults.filter(Boolean).length;
  const missing = Math.max(0, channelIds.length - channels.length);
  await getDb().update(automations).set({
    ...commonUpdate,
    lastSignalKey: signalKey,
    lastNotifiedAt: succeeded ? now.toISOString() : row.lastNotifiedAt,
    positionState: action === "buy" ? "holding" : "flat",
    entryPrice: action === "buy" ? execution?.executionPrice ?? bar.close : null,
  }).where(eq(automations.id, row.id));
  return { action, price: execution?.executionPrice ?? bar.close, reason, source, execution, deliveries: { total: channelIds.length, succeeded, failed: deliveryResults.length - succeeded + missing } };
}

const RUN_LEASE_MS = 2 * 60_000;

async function ensureAutomationRun(row: AutomationRow, trigger: "scheduled" | "manual", scheduleKey: string) {
  const [created] = await getDb().insert(automationRuns).values({
    id: crypto.randomUUID(),
    userId: row.userId,
    automationId: row.id,
    trigger,
    scheduleKey,
    status: "pending",
    maxAttempts: 3,
  }).onConflictDoNothing({ target: [automationRuns.automationId, automationRuns.scheduleKey] }).returning();
  if (created) return created;
  const [existing] = await getDb().select().from(automationRuns).where(and(eq(automationRuns.automationId, row.id), eq(automationRuns.scheduleKey, scheduleKey))).limit(1);
  if (!existing) throw new Error("任务运行记录创建失败");
  return existing;
}

async function releaseAutomationLease(automationId: string, owner: string) {
  await getDb().update(automations).set({ leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date().toISOString() }).where(and(eq(automations.id, automationId), eq(automations.leaseOwner, owner)));
}

type ProcessedAutomationRun = AutomationRunRow & { result?: Awaited<ReturnType<typeof runAutomation>> };

async function processAutomationRun(run: AutomationRunRow): Promise<ProcessedAutomationRun> {
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const owner = `${run.id}:${crypto.randomUUID()}`;
  const leaseExpiresAt = new Date(now.getTime() + RUN_LEASE_MS).toISOString();
  const [claimed] = await db.update(automationRuns).set({
    status: "running",
    attempt: sql`${automationRuns.attempt} + 1`,
    leaseOwner: owner,
    leaseExpiresAt,
    nextRetryAt: null,
    startedAt: nowIso,
    updatedAt: nowIso,
  }).where(and(
    eq(automationRuns.id, run.id),
    or(
      inArray(automationRuns.status, ["pending", "retrying"]),
      and(eq(automationRuns.status, "running"), or(isNull(automationRuns.leaseExpiresAt), lt(automationRuns.leaseExpiresAt, nowIso))),
    ),
  )).returning();
  if (!claimed) return run;

  const [row] = await db.select().from(automations).where(and(eq(automations.id, claimed.automationId), eq(automations.userId, claimed.userId))).limit(1);
  if (!row) {
    const [failed] = await db.update(automationRuns).set({ status: "failed", error: "任务已删除", reason: "任务已删除", finishedAt: nowIso, leaseOwner: null, leaseExpiresAt: null, updatedAt: nowIso }).where(eq(automationRuns.id, claimed.id)).returning();
    return failed;
  }
  if (!row.enabled && claimed.trigger === "scheduled") {
    const [skipped] = await db.update(automationRuns).set({ status: "skipped", reason: "任务已停用", finishedAt: nowIso, leaseOwner: null, leaseExpiresAt: null, updatedAt: nowIso }).where(eq(automationRuns.id, claimed.id)).returning();
    return skipped;
  }

  const [leased] = await db.update(automations).set({ leaseOwner: owner, leaseExpiresAt, updatedAt: nowIso }).where(and(
    eq(automations.id, row.id),
    or(isNull(automations.leaseOwner), isNull(automations.leaseExpiresAt), lt(automations.leaseExpiresAt, nowIso), eq(automations.leaseOwner, owner)),
  )).returning();
  if (!leased) {
    const nextRetryAt = new Date(now.getTime() + 60_000).toISOString();
    const [retrying] = await db.update(automationRuns).set({ status: "retrying", attempt: Math.max(0, claimed.attempt - 1), reason: "同一任务正在其他实例执行，已排队", nextRetryAt, leaseOwner: null, leaseExpiresAt: null, updatedAt: nowIso }).where(eq(automationRuns.id, claimed.id)).returning();
    return retrying;
  }

  try {
    const latestRow = leased;
    const result = await runAutomation(latestRow);
    const deliveries = result.deliveries ?? { total: 0, succeeded: 0, failed: 0 };
    const completedAt = new Date().toISOString();
    const [completed] = await db.update(automationRuns).set({
      status: "succeeded",
      action: result.action,
      price: result.price,
      reason: result.reason.slice(0, 500),
      source: result.source,
      deliveryTotal: deliveries.total,
      deliverySucceeded: deliveries.succeeded,
      deliveryFailed: deliveries.failed ?? 0,
      error: null,
      finishedAt: completedAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: completedAt,
    }).where(eq(automationRuns.id, claimed.id)).returning();
    await db.update(automations).set({ lastStatus: "succeeded", lastError: null, consecutiveFailures: 0, updatedAt: completedAt }).where(eq(automations.id, row.id));
    return { ...completed, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务执行失败";
    const retrying = claimed.attempt < claimed.maxAttempts;
    const finishedAt = new Date().toISOString();
    const nextRetryAt = retrying ? new Date(Date.now() + (claimed.attempt === 1 ? 60_000 : 5 * 60_000)).toISOString() : null;
    const [failed] = await db.update(automationRuns).set({
      status: retrying ? "retrying" : "failed",
      reason: retrying ? `执行失败，将自动重试：${message}`.slice(0, 500) : message.slice(0, 500),
      error: message.slice(0, 1_000),
      nextRetryAt,
      finishedAt: retrying ? null : finishedAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: finishedAt,
    }).where(eq(automationRuns.id, claimed.id)).returning();
    await db.update(automations).set({
      lastRunAt: finishedAt,
      lastStatus: retrying ? "retrying" : "failed",
      lastError: message.slice(0, 500),
      consecutiveFailures: sql`${automations.consecutiveFailures} + 1`,
      updatedAt: finishedAt,
    }).where(eq(automations.id, row.id));
    if (!retrying) await writeLog(row, { type: "error", status: "failed", reason: message });
    return failed;
  } finally {
    await releaseAutomationLease(row.id, owner);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runAutomationNow(row: AutomationRow) {
  const run = await ensureAutomationRun(row, "manual", `manual:${crypto.randomUUID()}`);
  return processAutomationRun(run);
}

export async function runDueAutomations() {
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const rows = await db.select().from(automations).where(eq(automations.enabled, true)).orderBy(automations.runTime).limit(100);
  const due = rows.filter((row) => automationIsDue(row, now));
  await Promise.all(due.map((row) => ensureAutomationRun(row, "scheduled", scheduleKeyFor(row, now))));
  const candidates = await db.select().from(automationRuns).where(or(
    and(inArray(automationRuns.status, ["pending", "retrying"]), or(isNull(automationRuns.nextRetryAt), lt(automationRuns.nextRetryAt, new Date(now.getTime() + 1_000).toISOString()))),
    and(eq(automationRuns.status, "running"), lt(automationRuns.leaseExpiresAt, nowIso)),
  )).orderBy(automationRuns.createdAt).limit(20);
  const results = await mapWithConcurrency(candidates, 4, (run) => processAutomationRun(run));
  return {
    checked: rows.length,
    scheduled: due.length,
    processed: results.length,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    failed: results.filter((result) => result.status === "failed").length,
    retrying: results.filter((result) => result.status === "retrying").length,
  };
}

export async function automationForUser(id: string, userId: string) {
  const [row] = await getDb().select().from(automations).where(and(eq(automations.id, id), eq(automations.userId, userId))).limit(1);
  return row ?? null;
}

export async function recentNotificationLogs(userId: string, limit = 80) {
  return getDb().select().from(notificationLogs).where(eq(notificationLogs.userId, userId)).orderBy(desc(notificationLogs.createdAt)).limit(limit);
}
