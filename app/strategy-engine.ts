import { strategyRuleSummary, type IndicatorKey, type StrategyDraft, type StrategyRule } from "./strategy-model";

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

export function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

export function movingAverage(bars: Kline[], index: number, length: number) {
  if (index + 1 < length) return null;
  return average(bars.slice(index - length + 1, index + 1).map((bar) => bar.close));
}

function calculateRsi(bars: Kline[], index: number, length = 14) {
  if (index < length) return null;
  let gains = 0;
  let losses = 0;
  for (let itemIndex = index - length + 1; itemIndex <= index; itemIndex += 1) {
    const change = bars[itemIndex].close - bars[itemIndex - 1].close;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

function indicatorValue(key: IndicatorKey, bars: Kline[], index: number) {
  const bar = bars[index];
  if (!bar) return 0;
  if (key === "close" || key === "open") return bar[key];
  if (key === "ma5") return movingAverage(bars, index, 5) ?? bar.close;
  if (key === "ma10") return movingAverage(bars, index, 10) ?? bar.close;
  if (key === "ma20") return movingAverage(bars, index, 20) ?? bar.close;
  if (key === "ma30") return movingAverage(bars, index, 30) ?? bar.close;
  if (key === "ma60") return movingAverage(bars, index, 60) ?? bar.close;
  if (key === "rsi14") return calculateRsi(bars, index) ?? 50;
  if (key === "highest20") return Math.max(...bars.slice(Math.max(0, index - 20), index).map((item) => item.high));
  if (key === "volumeRatio20") {
    const baseline = average(bars.slice(Math.max(0, index - 20), index).map((item) => item.volume));
    return baseline ? bar.volume / baseline : 0;
  }
  const sample = bars.slice(Math.max(0, index - 19), index + 1);
  const returns = sample.slice(1).map((item, offset) => item.close / sample[offset].close - 1);
  return standardDeviation(returns) * 100;
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
    ma5: 5,
    ma10: 10,
    ma20: 20,
    ma30: 30,
    ma60: 60,
    rsi14: 14,
    volatility20: 20,
    volumeRatio20: 20,
    highest20: 20,
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
