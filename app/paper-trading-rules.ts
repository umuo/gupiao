import { appDateKey } from "./timezone.ts";
import { aShareTradingDayStatus, nextAShareTradingDay } from "./trading-calendar.ts";

export function paperTradeExecutionKey(automationId: string, automationRunId: string, action: "buy" | "sell") {
  return `${automationId}:run:${automationRunId}:${action}`;
}

export function paperPositionSellEligibility(openedAt: string, tradeAt = new Date()) {
  const opened = new Date(openedAt);
  if (!Number.isFinite(opened.getTime()) || !Number.isFinite(tradeAt.getTime())) {
    return { allowed: false, reason: "持仓交易日期无效，无法执行卖出" };
  }
  const openedDate = appDateKey(opened);
  const tradeDate = appDateKey(tradeAt);
  const tradingDay = aShareTradingDayStatus(tradeDate);
  if (!tradingDay.isTradingDay) {
    return { allowed: false, reason: `当前为${tradingDay.reason}，不能执行卖出` };
  }
  const sellableDate = nextAShareTradingDay(openedDate);
  if (tradeDate < sellableDate) {
    return { allowed: false, reason: `A股实行 T+1，当日买入的持仓最快可于 ${sellableDate} 卖出` };
  }
  return { allowed: true, reason: "" };
}
