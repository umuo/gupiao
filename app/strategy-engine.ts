import { strategyRuleSummary, type IndicatorKey, type StrategyDraft, type StrategyRule } from "./strategy-model";
import {
  activityRatio,
  atrPercent,
  bollingerBand,
  calculateRsi,
  closeVolatilityPercent,
  exponentialMovingAverage,
  macdValue,
  movingAverage,
  previousExtreme,
  rateOfChange,
} from "./technical-indicators";

export { average, movingAverage, standardDeviation } from "./technical-indicators";

export type Kline = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
};

export type SignalStrategy = Pick<StrategyDraft, "entryLogic" | "exitLogic" | "entryRules" | "exitRules">;

function indicatorValue(key: IndicatorKey, bars: Kline[], index: number) {
  const bar = bars[index];
  if (!bar) return 0;
  if (key === "close" || key === "open" || key === "high" || key === "low") return bar[key];
  if (key === "ma5") return movingAverage(bars, index, 5) ?? bar.close;
  if (key === "ma10") return movingAverage(bars, index, 10) ?? bar.close;
  if (key === "ma20") return movingAverage(bars, index, 20) ?? bar.close;
  if (key === "ma30") return movingAverage(bars, index, 30) ?? bar.close;
  if (key === "ma60") return movingAverage(bars, index, 60) ?? bar.close;
  if (key === "ma120") return movingAverage(bars, index, 120) ?? bar.close;
  if (key === "ema12") return exponentialMovingAverage(bars, index, 12) ?? bar.close;
  if (key === "ema26") return exponentialMovingAverage(bars, index, 26) ?? bar.close;
  if (key === "macdDif") return macdValue(bars, index, "dif") ?? 0;
  if (key === "macdSignal") return macdValue(bars, index, "signal") ?? 0;
  if (key === "macdHistogram") return macdValue(bars, index, "histogram") ?? 0;
  if (key === "rsi14") return calculateRsi(bars, index) ?? 50;
  if (key === "roc20") return rateOfChange(bars, index, 20) ?? 0;
  if (key === "volatility20") return closeVolatilityPercent(bars, index, 20) ?? 0;
  if (key === "atr14Percent") return atrPercent(bars, index, 14) ?? 0;
  if (key === "bollingerUpper20") return bollingerBand(bars, index, "upper") ?? bar.close;
  if (key === "bollingerLower20") return bollingerBand(bars, index, "lower") ?? bar.close;
  if (key === "volumeRatio20") return activityRatio(bars, index, "volume", 20) ?? 0;
  if (key === "amountRatio20") return activityRatio(bars, index, "amount", 20) ?? 0;
  if (key === "highest20") return previousExtreme(bars, index, "high", 20) ?? bar.high;
  return previousExtreme(bars, index, "low", 20) ?? bar.low;
}

function ruleMatches(rule: StrategyRule, bars: Kline[], index: number) {
  const left = indicatorValue(rule.left, bars, index);
  const right = rule.rightType === "indicator" ? indicatorValue(rule.rightIndicator ?? "close", bars, index) : (rule.rightValue ?? 0);
  if (rule.operator === "gt") return left > right;
  if (rule.operator === "lt") return left < right;
  const previousLeft = indicatorValue(rule.left, bars, index - 1);
  const previousRight = rule.rightType === "indicator" ? indicatorValue(rule.rightIndicator ?? "close", bars, index - 1) : (rule.rightValue ?? 0);
  return rule.operator === "crossesAbove"
    ? left > right && previousLeft <= previousRight
    : left < right && previousLeft >= previousRight;
}

export function signalFor(strategy: SignalStrategy, bars: Kline[], index: number, side: "buy" | "sell") {
  const indicatorWarmup: Record<IndicatorKey, number> = {
    close: 1,
    open: 1,
    high: 1,
    low: 1,
    ma5: 5,
    ma10: 10,
    ma20: 20,
    ma30: 30,
    ma60: 60,
    ma120: 120,
    ema12: 12,
    ema26: 26,
    macdDif: 35,
    macdSignal: 35,
    macdHistogram: 35,
    rsi14: 14,
    roc20: 20,
    volatility20: 20,
    atr14Percent: 14,
    bollingerUpper20: 20,
    bollingerLower20: 20,
    volumeRatio20: 20,
    amountRatio20: 20,
    highest20: 20,
    lowest20: 20,
  };
  const warmup = [...strategy.entryRules, ...strategy.exitRules].reduce((required, rule) => {
    const rightWarmup = rule.rightType === "indicator" ? indicatorWarmup[rule.rightIndicator ?? "close"] : 1;
    return Math.max(required, indicatorWarmup[rule.left], rightWarmup);
  }, 1);
  if (index < warmup) return { active: false, reason: "等待足够日K" };
  const rules = side === "buy" ? strategy.entryRules : strategy.exitRules;
  const logic = side === "buy" ? strategy.entryLogic : strategy.exitLogic;
  const results = rules.map((rule) => ruleMatches(rule, bars, index));
  const active = logic === "and" ? results.every(Boolean) : results.some(Boolean);
  return { active, reason: strategyRuleSummary(rules, logic) };
}
