import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { automationNotificationChannels, automations, notificationChannels, notificationLogs, userSettings } from "../db/schema";
import { deliverNotification } from "./notification-delivery";
import { decryptSecret } from "./secret-box";
import { signalFor, type Kline, type SignalStrategy } from "./strategy-engine";
import { fetchTickFlowKlines, fetchTickFlowQuote } from "./tickflow-client";

type AutomationRow = typeof automations.$inferSelect;

type ShanghaiClock = {
  date: string;
  weekday: number;
  minuteOfDay: number;
};

const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function shanghaiClock(date = new Date()): ShanghaiClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
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
  if (!row.enabled || !weekdaysOf(row).includes(clock.weekday)) return false;
  if (row.dataMode === "daily") {
    if (clock.minuteOfDay < parseMinutes(row.runTime) || row.lastRunDate === clock.date) return false;
    return !row.lastRunAt || now.getTime() - new Date(row.lastRunAt).getTime() >= 15 * 60_000;
  }
  if (!inMainlandTradingSession(clock.minuteOfDay)) return false;
  if (!row.lastRunAt) return true;
  return now.getTime() - new Date(row.lastRunAt).getTime() >= row.intervalMinutes * 60_000;
}

function strategyFrom(row: AutomationRow): SignalStrategy {
  const parsed = JSON.parse(row.strategyDefinition) as Partial<SignalStrategy>;
  if (!Array.isArray(parsed.entryRules) || !Array.isArray(parsed.exitRules)) throw new Error("任务中的策略定义无效");
  return {
    entryLogic: parsed.entryLogic === "or" ? "or" : "and",
    exitLogic: parsed.exitLogic === "and" ? "and" : "or",
    entryRules: parsed.entryRules,
    exitRules: parsed.exitRules,
  };
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

export async function recordAutomationError(row: AutomationRow, error: unknown) {
  if (error instanceof Error && error.name === "AutomationDeliveryError") return;
  const message = error instanceof Error ? error.message : "任务执行失败";
  await writeLog(row, { type: "error", status: "failed", reason: message });
  await getDb().update(automations).set({ lastRunAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(automations.id, row.id));
}

export async function runAutomation(row: AutomationRow) {
  const now = new Date();
  const clock = shanghaiClock(now);
  let bars = await fetchTickFlowKlines(row.symbol, 220);
  let source = "TickFlow 免费历史日K";

  if (row.dataMode === "realtime") {
    if (!weekdaysOf(row).includes(clock.weekday) || !inMainlandTradingSession(clock.minuteOfDay)) throw new Error("当前不在 A 股连续竞价时段，本次不检查实时信号");
    const [settings] = await getDb().select().from(userSettings).where(eq(userSettings.userId, row.userId)).limit(1);
    if (!settings?.tickflowApiKeyEncrypted) throw new Error("请先在定时任务的实时数据中配置 TickFlow Key");
    const quote = await fetchTickFlowQuote(row.symbol, await decryptSecret(settings.tickflowApiKeyEncrypted));
    if (shanghaiClock(new Date(quote.timestamp)).date !== clock.date) throw new Error("TickFlow 返回的不是今日实时行情，本次不触发信号");
    bars = mergeQuoteIntoDailyBars(bars, quote);
    source = "TickFlow 实时行情";
  }

  const bar = bars.at(-1);
  if (!bar || bars.length < 22) throw new Error("可用K线不足，暂时无法计算策略");
  const strategy = strategyFrom(row);
  let action: "buy" | "sell" | null = null;
  let reason = "";

  if (row.positionState === "flat") {
    const buy = signalFor(strategy, bars, bars.length - 1, "buy");
    if (buy.active) {
      action = "buy";
      reason = buy.reason;
    }
  } else {
    const returnRate = row.entryPrice ? (bar.close / row.entryPrice - 1) * 100 : 0;
    const sell = signalFor(strategy, bars, bars.length - 1, "sell");
    if (row.entryPrice && returnRate <= -row.stopLoss) {
      action = "sell";
      reason = `触发 ${row.stopLoss}% 止损`;
    } else if (row.entryPrice && returnRate >= row.takeProfit) {
      action = "sell";
      reason = `触发 ${row.takeProfit}% 止盈`;
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
    return { action: null, price: bar.close, reason: "本次未出现买卖信号", source };
  }

  const signalKey = `${action}:${clock.date}:${reason}`;
  if (signalKey === row.lastSignalKey) {
    await getDb().update(automations).set(commonUpdate).where(eq(automations.id, row.id));
    return { action: null, price: bar.close, reason: "相同信号今日已通知", source };
  }

  const mappings = await getDb().select({ channelId: automationNotificationChannels.notificationChannelId }).from(automationNotificationChannels).where(and(eq(automationNotificationChannels.automationId, row.id), eq(automationNotificationChannels.userId, row.userId)));
  const channelIds = mappings.map((mapping) => mapping.channelId);
  if (!channelIds.length) throw new Error("该任务尚未选择通知渠道");
  const channels = await getDb().select().from(notificationChannels).where(and(eq(notificationChannels.userId, row.userId), inArray(notificationChannels.id, channelIds)));
  if (!channels.length) throw new Error("任务关联的通知渠道均不存在");

  const payload = {
    event: `strategy.${action}`,
    action,
    actionText: action === "buy" ? "买入" : "卖出",
    automationId: row.id,
    automationName: row.name,
    symbol: row.symbol,
    stockName: row.stockName,
    strategyId: row.strategyId,
    strategyName: row.strategyName,
    price: bar.close,
    reason,
    dataMode: row.dataMode,
    source,
    marketTime: new Date(bar.timestamp).toISOString(),
    sentAt: now.toISOString(),
    notice: "仅为模拟策略信号，不构成投资建议或真实委托。",
  };
  const deliveryResults = await Promise.all(channels.map(async (channel) => {
    try {
      const delivered = await deliverNotification(channel, payload);
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
  if (!succeeded) {
    await getDb().update(automations).set({ ...commonUpdate, lastRunDate: row.dataMode === "daily" ? null : row.lastRunDate }).where(eq(automations.id, row.id));
    const deliveryError = new Error("所有通知渠道均投递失败");
    deliveryError.name = "AutomationDeliveryError";
    throw deliveryError;
  }

  await getDb().update(automations).set({
    ...commonUpdate,
    lastSignalKey: signalKey,
    lastNotifiedAt: now.toISOString(),
    positionState: action === "buy" ? "holding" : "flat",
    entryPrice: action === "buy" ? bar.close : null,
  }).where(eq(automations.id, row.id));
  return { action, price: bar.close, reason, source, deliveries: { total: channelIds.length, succeeded, failed: deliveryResults.length - succeeded + missing } };
}

export async function runDueAutomations() {
  const rows = await getDb().select().from(automations).where(eq(automations.enabled, true));
  const due = rows.filter((row) => automationIsDue(row));
  const results = await Promise.allSettled(due.map(async (row) => {
    try {
      return await runAutomation(row);
    } catch (error) {
      await recordAutomationError(row, error);
      throw error;
    }
  }));
  return {
    checked: due.length,
    succeeded: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
  };
}

export async function automationForUser(id: string, userId: string) {
  const [row] = await getDb().select().from(automations).where(and(eq(automations.id, id), eq(automations.userId, userId))).limit(1);
  return row ?? null;
}

export async function recentNotificationLogs(userId: string, limit = 80) {
  return getDb().select().from(notificationLogs).where(eq(notificationLogs.userId, userId)).orderBy(desc(notificationLogs.createdAt)).limit(limit);
}
