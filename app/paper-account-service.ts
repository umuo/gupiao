import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { paperAccounts, paperEquitySnapshots, paperPositions, paperTrades } from "../db/schema";
import { calculatePaperBuyOrder } from "./paper-execution";
import { paperPositionSellEligibility } from "./paper-trading-rules";
import type { SignalStrategy } from "./strategy-engine";
import { parseStrategySnapshots } from "./strategy-version";
import { appDateKey } from "./timezone";

type PaperAccountRow = typeof paperAccounts.$inferSelect;
type PaperPositionRow = typeof paperPositions.$inferSelect;

export function shanghaiDate(date = new Date()) {
  return appDateKey(date);
}

export function paperStrategiesFrom(account: PaperAccountRow): Array<SignalStrategy & { id: string; name: string }> {
  return parseStrategySnapshots(account.strategySnapshots, {
    id: account.strategyId,
    name: account.strategyName,
    definition: account.strategyDefinition,
    version: account.strategyVersion,
    contentHash: account.strategySnapshotHash,
  });
}

export async function paperAccountState(id: string, userId: string) {
  const [account] = await getDb().select().from(paperAccounts).where(and(eq(paperAccounts.id, id), eq(paperAccounts.userId, userId))).limit(1);
  if (!account) return null;
  const [position] = await getDb().select().from(paperPositions).where(and(eq(paperPositions.paperAccountId, id), eq(paperPositions.userId, userId))).limit(1);
  return { account, position: position ?? null };
}

function valuation(account: PaperAccountRow, position: PaperPositionRow | null, price: number) {
  const marketValue = position ? position.shares * price : 0;
  const unrealizedPnl = position ? marketValue - position.shares * position.averageCost : 0;
  const equity = account.cash + marketValue;
  return {
    marketValue,
    unrealizedPnl,
    equity,
    totalReturn: account.initialCapital ? (equity / account.initialCapital - 1) * 100 : 0,
  };
}

export async function refreshPaperAccountValuation(accountId: string, userId: string, price: number, date = shanghaiDate()) {
  if (!Number.isFinite(price) || price <= 0) throw new Error("行情价格无效");
  const state = await paperAccountState(accountId, userId);
  if (!state) throw new Error("模拟盘不存在");
  const now = new Date().toISOString();
  const values = valuation(state.account, state.position, price);
  const db = getDb();
  const updates = [
    db.update(paperAccounts).set({ lastPrice: price, lastValuationDate: date, updatedAt: now }).where(and(eq(paperAccounts.id, accountId), eq(paperAccounts.userId, userId))),
    db.insert(paperEquitySnapshots).values({
      id: crypto.randomUUID(),
      userId,
      paperAccountId: accountId,
      snapshotDate: date,
      equity: values.equity,
      cash: state.account.cash,
      marketValue: values.marketValue,
      totalReturn: values.totalReturn,
      realizedPnl: state.account.realizedPnl,
      unrealizedPnl: values.unrealizedPnl,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [paperEquitySnapshots.paperAccountId, paperEquitySnapshots.snapshotDate],
      set: {
        equity: values.equity,
        cash: state.account.cash,
        marketValue: values.marketValue,
        totalReturn: values.totalReturn,
        realizedPnl: state.account.realizedPnl,
        unrealizedPnl: values.unrealizedPnl,
        updatedAt: now,
      },
    }),
  ] as const;
  if (state.position) {
    await db.batch([
      updates[0],
      db.update(paperPositions).set({ lastPrice: price, updatedAt: now }).where(eq(paperPositions.id, state.position.id)),
      updates[1],
    ]);
  } else {
    await db.batch(updates);
  }
  return values;
}

export type PaperSignalExecution = {
  executed: boolean;
  duplicate?: boolean;
  reason: string;
  action: "buy" | "sell";
  shares?: number;
  executionPrice?: number;
  commission?: number;
  realizedPnl?: number;
  currentEquity?: number;
};

export async function executePaperSignal(input: {
  accountId: string;
  userId: string;
  automationId: string;
  action: "buy" | "sell";
  signalPrice: number;
  reason: string;
  barTimestamp: number;
  signalKey: string;
}): Promise<PaperSignalExecution> {
  if (!Number.isFinite(input.signalPrice) || input.signalPrice <= 0) throw new Error("信号价格无效");
  const state = await paperAccountState(input.accountId, input.userId);
  if (!state) throw new Error("关联的模拟盘不存在");
  if (state.account.status !== "active") throw new Error("关联的模拟盘已暂停");
  const [existing] = await getDb().select().from(paperTrades).where(and(eq(paperTrades.paperAccountId, input.accountId), eq(paperTrades.idempotencyKey, input.signalKey))).limit(1);
  if (existing) {
    const currentMarketValue = state.position ? state.position.shares * input.signalPrice : 0;
    return {
      executed: false,
      duplicate: true,
      action: input.action,
      reason: input.reason,
      shares: existing.shares,
      executionPrice: existing.executionPrice,
      commission: existing.commission,
      realizedPnl: existing.realizedPnl,
      currentEquity: state.account.cash + currentMarketValue,
    };
  }

  const account = state.account;
  const tradeTime = new Date();
  const now = tradeTime.toISOString();
  const snapshotDate = shanghaiDate(new Date(input.barTimestamp));
  const db = getDb();
  if (input.action === "buy") {
    if (state.position) return { executed: false, action: input.action, reason: "模拟盘已有持仓，本次不重复买入" };
    const order = calculatePaperBuyOrder({ cash: account.cash, positionPercent: account.positionPercent, signalPrice: input.signalPrice, commissionRate: account.commissionRate, slippageRate: account.slippageRate });
    const { executionPrice, shares, grossAmount, commission } = order;
    if (shares < 100 || grossAmount + commission > account.cash) return {
      executed: false,
      action: input.action,
      reason: `目标仓位预算 ¥${order.allocation.toFixed(2)}，不足买入 100 股（约需 ¥${order.requiredForOneLot.toFixed(2)}；当前资金至少需要 ${order.minimumPositionPercent}% 仓位）`,
    };
    const cash = account.cash - grossAmount - commission;
    const averageCost = (grossAmount + commission) / shares;
    const marketValue = shares * input.signalPrice;
    const unrealizedPnl = marketValue - averageCost * shares;
    const equity = cash + marketValue;
    const totalReturn = (equity / account.initialCapital - 1) * 100;
    await db.batch([
      db.update(paperAccounts).set({ cash, lastPrice: input.signalPrice, lastValuationDate: snapshotDate, updatedAt: now }).where(and(eq(paperAccounts.id, account.id), eq(paperAccounts.userId, input.userId))),
      db.insert(paperPositions).values({ id: crypto.randomUUID(), userId: input.userId, paperAccountId: account.id, symbol: account.symbol, stockName: account.stockName, shares, averageCost, lastPrice: input.signalPrice, openedAt: now, updatedAt: now }),
      db.insert(paperTrades).values({ id: crypto.randomUUID(), userId: input.userId, paperAccountId: account.id, automationId: input.automationId, action: "buy", symbol: account.symbol, stockName: account.stockName, shares, signalPrice: input.signalPrice, executionPrice, grossAmount, commission, reason: input.reason.slice(0, 500), barTimestamp: input.barTimestamp, idempotencyKey: input.signalKey, executedAt: now }),
      db.insert(paperEquitySnapshots).values({ id: crypto.randomUUID(), userId: input.userId, paperAccountId: account.id, snapshotDate, equity, cash, marketValue, totalReturn, realizedPnl: account.realizedPnl, unrealizedPnl, updatedAt: now }).onConflictDoUpdate({ target: [paperEquitySnapshots.paperAccountId, paperEquitySnapshots.snapshotDate], set: { equity, cash, marketValue, totalReturn, realizedPnl: account.realizedPnl, unrealizedPnl, updatedAt: now } }),
    ]);
    return { executed: true, action: input.action, reason: input.reason, shares, executionPrice, commission, currentEquity: equity };
  }

  if (!state.position) return { executed: false, action: input.action, reason: "模拟盘当前没有可卖出的持仓" };
  const position = state.position;
  const sellEligibility = paperPositionSellEligibility(position.openedAt, tradeTime);
  if (!sellEligibility.allowed) return { executed: false, action: input.action, reason: sellEligibility.reason };
  const executionPrice = input.signalPrice * (1 - account.slippageRate);
  const grossAmount = position.shares * executionPrice;
  const commission = Math.max(5, grossAmount * account.commissionRate);
  const netProceeds = grossAmount - commission;
  const realizedPnl = netProceeds - position.averageCost * position.shares;
  const cash = account.cash + netProceeds;
  const totalRealizedPnl = account.realizedPnl + realizedPnl;
  const equity = cash;
  const totalReturn = (equity / account.initialCapital - 1) * 100;
  await db.batch([
    db.update(paperAccounts).set({ cash, realizedPnl: totalRealizedPnl, lastPrice: input.signalPrice, lastValuationDate: snapshotDate, updatedAt: now }).where(and(eq(paperAccounts.id, account.id), eq(paperAccounts.userId, input.userId))),
    db.delete(paperPositions).where(eq(paperPositions.id, position.id)),
    db.insert(paperTrades).values({ id: crypto.randomUUID(), userId: input.userId, paperAccountId: account.id, automationId: input.automationId, action: "sell", symbol: account.symbol, stockName: account.stockName, shares: position.shares, signalPrice: input.signalPrice, executionPrice, grossAmount, commission, realizedPnl, reason: input.reason.slice(0, 500), barTimestamp: input.barTimestamp, idempotencyKey: input.signalKey, executedAt: now }),
    db.insert(paperEquitySnapshots).values({ id: crypto.randomUUID(), userId: input.userId, paperAccountId: account.id, snapshotDate, equity, cash, marketValue: 0, totalReturn, realizedPnl: totalRealizedPnl, unrealizedPnl: 0, updatedAt: now }).onConflictDoUpdate({ target: [paperEquitySnapshots.paperAccountId, paperEquitySnapshots.snapshotDate], set: { equity, cash, marketValue: 0, totalReturn, realizedPnl: totalRealizedPnl, unrealizedPnl: 0, updatedAt: now } }),
  ]);
  return { executed: true, action: input.action, reason: input.reason, shares: position.shares, executionPrice, commission, realizedPnl, currentEquity: equity };
}
