export type IndicatorKey =
  | "close"
  | "open"
  | "ma5"
  | "ma10"
  | "ma20"
  | "ma30"
  | "ma60"
  | "rsi14"
  | "volatility20"
  | "volumeRatio20"
  | "highest20";

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
  ma5: "MA5",
  ma10: "MA10",
  ma20: "MA20",
  ma30: "MA30",
  ma60: "MA60",
  rsi14: "RSI(14)",
  volatility20: "20日波动率(%)",
  volumeRatio20: "量比(20日)",
  highest20: "前20日最高价",
};

export const operatorLabels: Record<RuleOperator, string> = {
  gt: "大于",
  lt: "小于",
  crossesAbove: "向上穿越",
  crossesBelow: "向下穿越",
};

const indicators = new Set<IndicatorKey>(Object.keys(indicatorLabels) as IndicatorKey[]);
const operators = new Set<RuleOperator>(Object.keys(operatorLabels) as RuleOperator[]);

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
