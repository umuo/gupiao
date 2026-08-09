import { and, count, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { automationNotificationChannels, automations, notificationChannels, paperAccounts, paperEquitySnapshots, paperPositions, paperTrades } from "../../../db/schema";
import { getAppUser } from "../../auth";
import { shanghaiDate } from "../../paper-account-service";
import { sanitizeStrategyDraft } from "../../strategy-model";

const SYMBOL_PATTERN = /^\d{6}\.(SH|SZ|BJ)$/;
const MAX_ACCOUNTS = 20;

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${label}需要在 ${minimum} 到 ${maximum} 之间`);
  return number;
}

function strategyDefinition(strategy: ReturnType<typeof sanitizeStrategyDraft>) {
  return JSON.stringify({ entryLogic: strategy.entryLogic, exitLogic: strategy.exitLogic, entryRules: strategy.entryRules, exitRules: strategy.exitRules });
}

function duplicateMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("UNIQUE") || message.includes("unique") ? "模拟盘名称不能重复" : (message || "保存模拟盘失败");
}

async function accountViews(userId: string) {
  const db = getDb();
  const [accounts, positions, trades, snapshots, tasks, mappings, channels] = await Promise.all([
    db.select().from(paperAccounts).where(eq(paperAccounts.userId, userId)).orderBy(desc(paperAccounts.createdAt)),
    db.select().from(paperPositions).where(eq(paperPositions.userId, userId)),
    db.select().from(paperTrades).where(eq(paperTrades.userId, userId)).orderBy(desc(paperTrades.executedAt)).limit(1000),
    db.select().from(paperEquitySnapshots).where(eq(paperEquitySnapshots.userId, userId)).orderBy(desc(paperEquitySnapshots.snapshotDate)).limit(1000),
    db.select().from(automations).where(eq(automations.userId, userId)),
    db.select().from(automationNotificationChannels).where(eq(automationNotificationChannels.userId, userId)),
    db.select({ id: notificationChannels.id, name: notificationChannels.name }).from(notificationChannels).where(eq(notificationChannels.userId, userId)),
  ]);
  const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));
  return accounts.map((account) => {
    const position = positions.find((item) => item.paperAccountId === account.id) ?? null;
    const accountTrades = trades.filter((item) => item.paperAccountId === account.id);
    const accountSnapshots = snapshots.filter((item) => item.paperAccountId === account.id).slice(0, 60).reverse();
    const task = tasks.find((item) => item.paperAccountId === account.id) ?? null;
    const taskMappings = task ? mappings.filter((item) => item.automationId === task.id) : [];
    const marketPrice = account.lastPrice ?? position?.lastPrice ?? position?.averageCost ?? 0;
    const marketValue = position ? position.shares * marketPrice : 0;
    const unrealizedPnl = position ? marketValue - position.shares * position.averageCost : 0;
    const equity = account.cash + marketValue;
    const totalReturn = account.initialCapital ? (equity / account.initialCapital - 1) * 100 : 0;
    const latestSnapshot = accountSnapshots.at(-1);
    const previousSnapshot = accountSnapshots.at(-2);
    const dailyReturn = latestSnapshot && previousSnapshot && previousSnapshot.equity ? (latestSnapshot.equity / previousSnapshot.equity - 1) * 100 : 0;
    return {
      ...account,
      strategyDefinition: JSON.parse(account.strategyDefinition),
      position,
      trades: accountTrades.slice(0, 30),
      tradeCount: accountTrades.length,
      snapshots: accountSnapshots,
      metrics: { equity, marketValue, unrealizedPnl, realizedPnl: account.realizedPnl, totalReturn, dailyReturn },
      automation: task ? {
        id: task.id,
        name: task.name,
        enabled: task.enabled,
        dataMode: task.dataMode,
        runTime: task.runTime,
        intervalMinutes: task.intervalMinutes,
        lastRunAt: task.lastRunAt,
        lastNotifiedAt: task.lastNotifiedAt,
        notificationChannelIds: taskMappings.map((item) => item.notificationChannelId),
        notificationChannelNames: taskMappings.map((item) => channelNames.get(item.notificationChannelId) ?? "渠道已删除"),
      } : null,
    };
  });
}

export async function GET(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  return Response.json({ accounts: await accountViews(user.userId) });
}

export async function POST(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  try {
    const payload = await request.json() as Record<string, unknown>;
    const [{ total }] = await getDb().select({ total: count() }).from(paperAccounts).where(eq(paperAccounts.userId, user.userId));
    if (total >= MAX_ACCOUNTS) throw new Error(`每个用户最多创建 ${MAX_ACCOUNTS} 个模拟盘`);
    const name = String(payload.name ?? "").trim().slice(0, 40);
    const description = String(payload.description ?? "").trim().slice(0, 200);
    const symbol = String(payload.symbol ?? "").trim().toUpperCase();
    const stockName = String(payload.stockName ?? "").trim().slice(0, 30);
    const strategyId = String(payload.strategyId ?? "").trim().slice(0, 100);
    const strategy = sanitizeStrategyDraft(payload.strategy);
    const initialCapital = boundedNumber(payload.initialCapital, "初始本金", 1, 1_000_000_000_000);
    const positionPercent = boundedNumber(payload.positionPercent ?? 30, "单票仓位", 1, 100);
    const stopLoss = boundedNumber(payload.stopLoss ?? 8, "止损", 0.1, 100);
    const takeProfit = boundedNumber(payload.takeProfit ?? 22, "止盈", 0.1, 500);
    if (!name || !stockName || !strategyId || !SYMBOL_PATTERN.test(symbol)) throw new Error("请完整填写模拟盘名称、股票和策略");
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const db = getDb();
    await db.batch([
      db.insert(paperAccounts).values({ id, userId: user.userId, name, description, symbol, stockName, strategyId, strategyName: strategy.name, strategyDefinition: strategyDefinition(strategy), initialCapital, cash: initialCapital, positionPercent, stopLoss, takeProfit, updatedAt: now }),
      db.insert(paperEquitySnapshots).values({ id: crypto.randomUUID(), userId: user.userId, paperAccountId: id, snapshotDate: shanghaiDate(), equity: initialCapital, cash: initialCapital, marketValue: 0, totalReturn: 0, realizedPnl: 0, unrealizedPnl: 0, updatedAt: now }),
    ]);
    return Response.json({ account: (await accountViews(user.userId)).find((item) => item.id === id) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: duplicateMessage(error) }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = String(payload.id ?? "");
    const [existing] = await getDb().select().from(paperAccounts).where(and(eq(paperAccounts.id, id), eq(paperAccounts.userId, user.userId))).limit(1);
    if (!existing) return Response.json({ error: "模拟盘不存在" }, { status: 404 });
    const [position, tradeRows] = await Promise.all([
      getDb().select({ id: paperPositions.id }).from(paperPositions).where(and(eq(paperPositions.paperAccountId, id), eq(paperPositions.userId, user.userId))).limit(1),
      getDb().select({ id: paperTrades.id }).from(paperTrades).where(and(eq(paperTrades.paperAccountId, id), eq(paperTrades.userId, user.userId))).limit(1),
    ]);
    const coreLocked = position.length > 0 || tradeRows.length > 0;
    const name = String(payload.name ?? existing.name).trim().slice(0, 40);
    const description = String(payload.description ?? existing.description).trim().slice(0, 200);
    const status = payload.status === undefined ? existing.status : payload.status === "paused" ? "paused" : "active";
    const positionPercent = boundedNumber(payload.positionPercent ?? existing.positionPercent, "单票仓位", 1, 100);
    const stopLoss = boundedNumber(payload.stopLoss ?? existing.stopLoss, "止损", 0.1, 100);
    const takeProfit = boundedNumber(payload.takeProfit ?? existing.takeProfit, "止盈", 0.1, 500);
    if (!name) throw new Error("请填写模拟盘名称");
    const changes: Partial<typeof paperAccounts.$inferInsert> = { name, description, status, positionPercent, stopLoss, takeProfit, updatedAt: new Date().toISOString() };
    if (!coreLocked) {
      const symbol = String(payload.symbol ?? existing.symbol).trim().toUpperCase();
      const stockName = String(payload.stockName ?? existing.stockName).trim().slice(0, 30);
      const strategyId = String(payload.strategyId ?? existing.strategyId).trim().slice(0, 100);
      const strategy = sanitizeStrategyDraft(payload.strategy ?? { name: existing.strategyName, description: "", tag: "模拟盘", ...JSON.parse(existing.strategyDefinition) });
      const initialCapital = boundedNumber(payload.initialCapital ?? existing.initialCapital, "初始本金", 1, 1_000_000_000_000);
      if (!stockName || !strategyId || !SYMBOL_PATTERN.test(symbol)) throw new Error("股票或策略配置无效");
      Object.assign(changes, { symbol, stockName, strategyId, strategyName: strategy.name, strategyDefinition: strategyDefinition(strategy), initialCapital, cash: initialCapital });
    } else if (["symbol", "stockName", "strategyId", "strategy", "initialCapital"].some((key) => key in payload)) {
      const requestedCapital = Number(payload.initialCapital ?? existing.initialCapital);
      const requestedSymbol = String(payload.symbol ?? existing.symbol);
      const requestedStrategy = String(payload.strategyId ?? existing.strategyId);
      if (requestedCapital !== existing.initialCapital || requestedSymbol !== existing.symbol || requestedStrategy !== existing.strategyId) throw new Error("已有成交后不能修改本金、股票或策略；可以复制创建新的模拟盘");
    }
    const [account] = await getDb().update(paperAccounts).set(changes).where(and(eq(paperAccounts.id, id), eq(paperAccounts.userId, user.userId))).returning();
    if (!coreLocked && account.initialCapital !== existing.initialCapital) {
      const snapshotDate = shanghaiDate();
      await getDb().insert(paperEquitySnapshots).values({ id: crypto.randomUUID(), userId: user.userId, paperAccountId: id, snapshotDate, equity: account.initialCapital, cash: account.initialCapital, marketValue: 0, totalReturn: 0, realizedPnl: 0, unrealizedPnl: 0, updatedAt: new Date().toISOString() }).onConflictDoUpdate({ target: [paperEquitySnapshots.paperAccountId, paperEquitySnapshots.snapshotDate], set: { equity: account.initialCapital, cash: account.initialCapital, marketValue: 0, totalReturn: 0, realizedPnl: 0, unrealizedPnl: 0, updatedAt: new Date().toISOString() } });
    }
    const [task] = await getDb().select({ id: automations.id }).from(automations).where(and(eq(automations.paperAccountId, id), eq(automations.userId, user.userId))).limit(1);
    if (task) {
      const taskChanges: Partial<typeof automations.$inferInsert> = {
        name: `${account.name} · 策略通知`.slice(0, 50),
        symbol: account.symbol,
        stockName: account.stockName,
        strategyId: account.strategyId,
        strategyName: account.strategyName,
        strategyDefinition: account.strategyDefinition,
        stopLoss: account.stopLoss,
        takeProfit: account.takeProfit,
        updatedAt: new Date().toISOString(),
      };
      if (account.status === "paused") taskChanges.enabled = false;
      await getDb().update(automations).set(taskChanges).where(eq(automations.id, task.id));
    }
    return Response.json({ account: (await accountViews(user.userId)).find((item) => item.id === id) });
  } catch (error) {
    return Response.json({ error: duplicateMessage(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const payload = await request.json() as { id?: string };
  const id = String(payload.id ?? "");
  if (!id) return Response.json({ error: "缺少模拟盘 ID" }, { status: 400 });
  const [account] = await getDb().select({ id: paperAccounts.id }).from(paperAccounts).where(and(eq(paperAccounts.id, id), eq(paperAccounts.userId, user.userId))).limit(1);
  if (!account) return Response.json({ error: "模拟盘不存在" }, { status: 404 });
  const tasks = await getDb().select({ id: automations.id }).from(automations).where(and(eq(automations.paperAccountId, id), eq(automations.userId, user.userId)));
  const taskIds = tasks.map((task) => task.id);
  if (taskIds.length) await getDb().delete(automationNotificationChannels).where(and(eq(automationNotificationChannels.userId, user.userId), inArray(automationNotificationChannels.automationId, taskIds)));
  await getDb().batch([
    getDb().delete(automations).where(and(eq(automations.paperAccountId, id), eq(automations.userId, user.userId))),
    getDb().delete(paperPositions).where(and(eq(paperPositions.paperAccountId, id), eq(paperPositions.userId, user.userId))),
    getDb().delete(paperTrades).where(and(eq(paperTrades.paperAccountId, id), eq(paperTrades.userId, user.userId))),
    getDb().delete(paperEquitySnapshots).where(and(eq(paperEquitySnapshots.paperAccountId, id), eq(paperEquitySnapshots.userId, user.userId))),
    getDb().delete(paperAccounts).where(and(eq(paperAccounts.id, id), eq(paperAccounts.userId, user.userId))),
  ]);
  return Response.json({ ok: true });
}
