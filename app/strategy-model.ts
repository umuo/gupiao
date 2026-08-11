export type IndicatorKey =
  | "close"
  | "open"
  | "high"
  | "low"
  | "ma5"
  | "ma10"
  | "ma20"
  | "ma30"
  | "ma60"
  | "ma120"
  | "ema12"
  | "ema26"
  | "macdDif"
  | "macdSignal"
  | "macdHistogram"
  | "rsi14"
  | "roc20"
  | "volatility20"
  | "atr14Percent"
  | "bollingerUpper20"
  | "bollingerLower20"
  | "volumeRatio20"
  | "amountRatio20"
  | "highest20"
  | "lowest20";

export type RuleOperator = "gt" | "lt" | "crossesAbove" | "crossesBelow";
export type RuleLogic = "and" | "or";

export type StrategyRule = {
  left: IndicatorKey;
  operator: RuleOperator;
  rightType: "indicator" | "value";
  rightIndicator?: IndicatorKey;
  rightValue?: number;
};

export type StrategyDraft = {
  name: string;
  description: string;
  tag: string;
  entryLogic: RuleLogic;
  exitLogic: RuleLogic;
  entryRules: StrategyRule[];
  exitRules: StrategyRule[];
};

export type SavedStrategy = StrategyDraft & {
  id: string;
  createdAt?: string;
  version?: number;
  contentHash?: string;
};

export const indicatorLabels: Record<IndicatorKey, string> = {
  close: "收盘价",
  open: "开盘价",
  high: "最高价",
  low: "最低价",
  ma5: "MA5",
  ma10: "MA10",
  ma20: "MA20",
  ma30: "MA30",
  ma60: "MA60",
  ma120: "MA120",
  ema12: "EMA12",
  ema26: "EMA26",
  macdDif: "MACD DIF",
  macdSignal: "MACD DEA",
  macdHistogram: "MACD 柱",
  rsi14: "RSI(14)",
  roc20: "ROC(20)(%)",
  volatility20: "20日波动率(%)",
  atr14Percent: "ATR(14)(%)",
  bollingerUpper20: "布林上轨(20,2)",
  bollingerLower20: "布林下轨(20,2)",
  volumeRatio20: "量比(20日)",
  amountRatio20: "成交额比(20日)",
  highest20: "前20日最高价",
  lowest20: "前20日最低价",
};

export const indicatorGroups: Array<{ label: string; keys: IndicatorKey[] }> = [
  { label: "基础价格", keys: ["close", "open", "high", "low"] },
  { label: "趋势", keys: ["ma5", "ma10", "ma20", "ma30", "ma60", "ma120", "ema12", "ema26", "macdDif", "macdSignal", "macdHistogram"] },
  { label: "动量", keys: ["rsi14", "roc20"] },
  { label: "波动", keys: ["volatility20", "atr14Percent", "bollingerUpper20", "bollingerLower20"] },
  { label: "量价", keys: ["volumeRatio20", "amountRatio20"] },
  { label: "突破", keys: ["highest20", "lowest20"] },
];

export const operatorLabels: Record<RuleOperator, string> = {
  gt: "大于",
  lt: "小于",
  crossesAbove: "向上穿越",
  crossesBelow: "向下穿越",
};

const indicators = new Set<IndicatorKey>(Object.keys(indicatorLabels) as IndicatorKey[]);
const operators = new Set<RuleOperator>(Object.keys(operatorLabels) as RuleOperator[]);

export const strategyPresets: Array<{ id: string; name: string; note: string; draft: StrategyDraft }> = [
  {
    id: "steady-trend",
    name: "稳健趋势",
    note: "趋势、低波与不过热确认",
    draft: {
      name: "稳健趋势策略",
      description: "长期趋势向上、短期波动温和且RSI不过热时参与，跌破长期均线时退出。",
      tag: "稳健",
      entryLogic: "and",
      exitLogic: "or",
      entryRules: [
        { left: "close", operator: "gt", rightType: "indicator", rightIndicator: "ma20" },
        { left: "ma20", operator: "gt", rightType: "indicator", rightIndicator: "ma60" },
        { left: "volatility20", operator: "lt", rightType: "value", rightValue: 1.8 },
        { left: "rsi14", operator: "lt", rightType: "value", rightValue: 68 },
      ],
      exitRules: [{ left: "close", operator: "lt", rightType: "indicator", rightIndicator: "ma60" }],
    },
  },
  {
    id: "macd-trend",
    name: "MACD 趋势",
    note: "DIF/DEA 金叉配合长趋势",
    draft: {
      name: "MACD 趋势策略",
      description: "价格位于长期均线上方且MACD转强时入场，MACD转弱或跌破MA20时退出。",
      tag: "趋势",
      entryLogic: "and",
      exitLogic: "or",
      entryRules: [
        { left: "macdDif", operator: "crossesAbove", rightType: "indicator", rightIndicator: "macdSignal" },
        { left: "close", operator: "gt", rightType: "indicator", rightIndicator: "ma60" },
      ],
      exitRules: [
        { left: "macdDif", operator: "crossesBelow", rightType: "indicator", rightIndicator: "macdSignal" },
        { left: "close", operator: "lt", rightType: "indicator", rightIndicator: "ma20" },
      ],
    },
  },
  {
    id: "bollinger-reversion",
    name: "布林回归",
    note: "下轨超跌后的均值回归",
    draft: {
      name: "布林超跌回归",
      description: "价格跌破布林下轨且RSI进入超卖区时尝试反弹，回到中轨或动量修复后退出。",
      tag: "反转",
      entryLogic: "and",
      exitLogic: "or",
      entryRules: [
        { left: "close", operator: "crossesBelow", rightType: "indicator", rightIndicator: "bollingerLower20" },
        { left: "rsi14", operator: "lt", rightType: "value", rightValue: 35 },
      ],
      exitRules: [
        { left: "close", operator: "crossesAbove", rightType: "indicator", rightIndicator: "ma20" },
        { left: "rsi14", operator: "gt", rightType: "value", rightValue: 58 },
      ],
    },
  },
  {
    id: "volume-breakout",
    name: "放量突破",
    note: "价格新高、量能与动量确认",
    draft: {
      name: "量价突破策略",
      description: "价格突破前20日高点，并由成交量和20日动量共同确认，跌破MA10时退出。",
      tag: "突破",
      entryLogic: "and",
      exitLogic: "or",
      entryRules: [
        { left: "close", operator: "gt", rightType: "indicator", rightIndicator: "highest20" },
        { left: "volumeRatio20", operator: "gt", rightType: "value", rightValue: 1.5 },
        { left: "roc20", operator: "gt", rightType: "value", rightValue: 3 },
      ],
      exitRules: [{ left: "close", operator: "crossesBelow", rightType: "indicator", rightIndicator: "ma10" }],
    },
  },
  {
    id: "low-vol-defense",
    name: "低波防守",
    note: "ATR与长期均线过滤风险",
    draft: {
      name: "低波防守策略",
      description: "价格与MA20处于长期均线上方且ATR较低时参与，趋势破坏或波动骤升时退出。",
      tag: "防守",
      entryLogic: "and",
      exitLogic: "or",
      entryRules: [
        { left: "close", operator: "gt", rightType: "indicator", rightIndicator: "ma60" },
        { left: "ma20", operator: "gt", rightType: "indicator", rightIndicator: "ma60" },
        { left: "atr14Percent", operator: "lt", rightType: "value", rightValue: 2.5 },
      ],
      exitRules: [
        { left: "close", operator: "lt", rightType: "indicator", rightIndicator: "ma60" },
        { left: "atr14Percent", operator: "gt", rightType: "value", rightValue: 4 },
      ],
    },
  },
];

export function ruleToText(rule: StrategyRule) {
  const right = rule.rightType === "indicator"
    ? indicatorLabels[rule.rightIndicator ?? "close"]
    : String(rule.rightValue ?? 0);
  return `${indicatorLabels[rule.left]}${operatorLabels[rule.operator]}${right}`;
}

export function strategyRuleSummary(rules: StrategyRule[], logic: RuleLogic) {
  return rules.map(ruleToText).join(logic === "and" ? " 且 " : " 或 ");
}

export function sanitizeStrategyDraft(value: unknown): StrategyDraft {
  if (!value || typeof value !== "object") throw new Error("策略格式无效");
  const input = value as Record<string, unknown>;
  const name = String(input.name ?? "").trim().slice(0, 30);
  const description = String(input.description ?? "").trim().slice(0, 240);
  const tag = String(input.tag ?? "自定义").trim().slice(0, 8) || "自定义";
  if (!name) throw new Error("请填写策略名称");

  const normalizeRules = (raw: unknown): StrategyRule[] => {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 5).map((item) => {
      if (!item || typeof item !== "object") throw new Error("策略条件格式无效");
      const rule = item as Record<string, unknown>;
      const left = String(rule.left ?? "") as IndicatorKey;
      const operator = String(rule.operator ?? "") as RuleOperator;
      const rightType = rule.rightType === "value" ? "value" : "indicator";
      if (!indicators.has(left) || !operators.has(operator)) throw new Error("策略指标或比较方式无效");
      if (rightType === "indicator") {
        const rightIndicator = String(rule.rightIndicator ?? "") as IndicatorKey;
        if (!indicators.has(rightIndicator)) throw new Error("比较指标无效");
        return { left, operator, rightType, rightIndicator };
      }
      const rightValue = Number(rule.rightValue);
      if (!Number.isFinite(rightValue)) throw new Error("比较数值无效");
      return { left, operator, rightType, rightValue };
    });
  };

  const entryRules = normalizeRules(input.entryRules);
  const exitRules = normalizeRules(input.exitRules);
  if (!entryRules.length || !exitRules.length) throw new Error("买入和卖出条件都不能为空");

  return {
    name,
    description,
    tag,
    entryLogic: input.entryLogic === "or" ? "or" : "and",
    exitLogic: input.exitLogic === "or" ? "or" : "and",
    entryRules,
    exitRules,
  };
}

export function defaultStrategyDraft(): StrategyDraft {
  return {
    name: "我的均线策略",
    description: "短期均线突破长期均线时跟随趋势，趋势转弱时离场。",
    tag: "自定义",
    entryLogic: "and",
    exitLogic: "or",
    entryRules: [{ left: "ma5", operator: "crossesAbove", rightType: "indicator", rightIndicator: "ma20" }],
    exitRules: [{ left: "ma5", operator: "crossesBelow", rightType: "indicator", rightIndicator: "ma20" }],
  };
}
