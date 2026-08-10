"use client";

import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent, useEffect, useMemo, useRef, useState } from "react";
import { AuthGate } from "./auth-gate";
import { NotificationCenter } from "./notification-center";
import { PaperAccountCenter } from "./paper-account-center";
import type { PaperAccountTaskTarget } from "./paper-account-types";
import { combinedSignalFor } from "./strategy-combination";
import { average, standardDeviation, type Kline } from "./strategy-engine";
import { StrategyStudio, type StudioMode } from "./strategy-studio";
import { strategyRuleSummary, type SavedStrategy } from "./strategy-model";
import { TaskCenter } from "./task-center";
import { APP_TIME_ZONE, appDateKey } from "./timezone";
import { UserManagement } from "./user-management";

type WatchItem = {
  code: string;
  name: string;
  price: number;
  change: number;
  signal: string;
};

type Strategy = SavedStrategy & {
  summary: string;
  color: string;
  builtin: boolean;
  horizon: "short" | "medium" | "long" | "custom";
};

type Viewer = { userId: string; displayName: string; email: string; role: "user" | "superadmin" };

type StockSearchResult = {
  symbol: string;
  code: string;
  name: string;
  exchange: string;
};

type RealtimeQuote = {
  symbol: string;
  timestamp: number;
  lastPrice: number;
  previousClose: number;
};

function parseCapitalInput(rawValue: string) {
  const normalized = rawValue.trim().replace(/[\s,，]/g, "").toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)(w|万)?$/);
  if (!match) return null;

  const amount = Number(match[1]) * (match[2] ? 10_000 : 1);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount);
}

type Trade = {
  index: number;
  action: "buy" | "sell";
  date: string;
  price: number;
  shares: number;
  reason: string;
};

type BacktestResult = {
  equityPercent: number[];
  benchmarkPercent: number[];
  equityValues: number[];
  timestamps: number[];
  trades: Trade[];
  finalEquity: number;
  totalReturn: number;
  annualReturn: number;
  maxDrawdown: number;
  sharpe: number;
  winRate: number;
  position: { shares: number; cost: number; price: number; pnl: number; rate: number } | null;
};

const emptyBacktest: BacktestResult = {
  equityPercent: [], benchmarkPercent: [], equityValues: [], timestamps: [], trades: [],
  finalEquity: 0, totalReturn: 0, annualReturn: 0, maxDrawdown: 0, sharpe: 0, winRate: 0, position: null,
};

const initialWatchlist: WatchItem[] = [
  { code: "601939", name: "建设银行", price: 0, change: 0, signal: "同步中" },
];

const builtinStrategies: Strategy[] = [
  { id: "rsi", name: "RSI 超卖反弹", description: "RSI进入超卖区并出现阳线时尝试反弹交易，RSI修复至62以上时止盈。", summary: "超卖反弹 + RSI 离场", tag: "短线", color: "#b38cff", builtin: true, horizon: "short", entryLogic: "and", exitLogic: "or", entryRules: [{ left: "rsi14", operator: "lt", rightType: "value", rightValue: 32 }, { left: "close", operator: "gt", rightType: "indicator", rightIndicator: "open" }], exitRules: [{ left: "rsi14", operator: "gt", rightType: "value", rightValue: 62 }] },
  { id: "breakout", name: "放量突破", description: "收盘价突破前20日高点且成交量确认时入场，跌破MA10时离场。", summary: "20 日新高 + 成交量确认", tag: "短线", color: "#ff5b6e", builtin: true, horizon: "short", entryLogic: "and", exitLogic: "or", entryRules: [{ left: "close", operator: "gt", rightType: "indicator", rightIndicator: "highest20" }, { left: "volumeRatio20", operator: "gt", rightType: "value", rightValue: 1.1 }], exitRules: [{ left: "close", operator: "lt", rightType: "indicator", rightIndicator: "ma10" }] },
  { id: "short-ma5", name: "MA5 回踩反转", description: "价格重新向上穿越MA5且成交量恢复时入场，跌回MA5下方时快速离场。", summary: "重返 MA5 + 量能恢复", tag: "短线", color: "#ff8ea1", builtin: true, horizon: "short", entryLogic: "and", exitLogic: "or", entryRules: [{ left: "close", operator: "crossesAbove", rightType: "indicator", rightIndicator: "ma5" }, { left: "volumeRatio20", operator: "gt", rightType: "value", rightValue: 1 }], exitRules: [{ left: "close", operator: "crossesBelow", rightType: "indicator", rightIndicator: "ma5" }] },
  { id: "short-acceleration", name: "量价加速", description: "价格创20日新高且量比明显放大时追踪强势行情，趋势减速或RSI过热时退出。", summary: "新高 + 量比 1.5", tag: "短线", color: "#ff9f43", builtin: true, horizon: "short", entryLogic: "and", exitLogic: "or", entryRules: [{ left: "close", operator: "gt", rightType: "indicator", rightIndicator: "highest20" }, { left: "volumeRatio20", operator: "gt", rightType: "value", rightValue: 1.5 }], exitRules: [{ left: "close", operator: "lt", rightType: "indicator", rightIndicator: "ma10" }, { left: "rsi14", operator: "gt", rightType: "value", rightValue: 72 }] },
  { id: "ma", name: "均线动量", description: "MA5向上穿越MA20时买入，向下穿越时卖出。", summary: "MA5 / MA20 金叉与死叉", tag: "中期", color: "#4c8dff", builtin: true, horizon: "medium", entryLogic: "and", exitLogic: "or", entryRules: [{ left: "ma5", operator: "crossesAbove", rightType: "indicator", rightIndicator: "ma20" }], exitRules: [{ left: "ma5", operator: "crossesBelow", rightType: "indicator", rightIndicator: "ma20" }] },
  { id: "lowvol", name: "低波趋势", description: "20日波动率较低且价格站上MA20时买入，趋势转弱或波动放大时离场。", summary: "低波动率 + 站上 MA20", tag: "中期", color: "#37d6aa", builtin: true, horizon: "medium", entryLogic: "and", exitLogic: "or", entryRules: [{ left: "volatility20", operator: "lt", rightType: "value", rightValue: 1.8 }, { left: "close", operator: "gt", rightType: "indicator", rightIndicator: "ma20" }], exitRules: [{ left: "close", operator: "lt", rightType: "indicator", rightIndicator: "ma20" }, { left: "volatility20", operator: "gt", rightType: "value", rightValue: 3 }] },
  { id: "medium-ma10-30", name: "波段均线", description: "MA10上穿MA30后参与中期波段，反向穿越时离场。", summary: "MA10 / MA30 波段", tag: "中期", color: "#62b4ff", builtin: true, horizon: "medium", entryLogic: "and", exitLogic: "or", entryRules: [{ left: "ma10", operator: "crossesAbove", rightType: "indicator", rightIndicator: "ma30" }], exitRules: [{ left: "ma10", operator: "crossesBelow", rightType: "indicator", rightIndicator: "ma30" }] },
  { id: "medium-rsi-trend", name: "RSI 趋势修复", description: "RSI恢复到强弱分界线上方且价格站稳MA20时入场，动能和趋势任一转弱时退出。", summary: "RSI 修复 + MA20", tag: "中期", color: "#53dfc1", builtin: true, horizon: "medium", entryLogic: "and", exitLogic: "or", entryRules: [{ left: "rsi14", operator: "gt", rightType: "value", rightValue: 52 }, { left: "close", operator: "gt", rightType: "indicator", rightIndicator: "ma20" }], exitRules: [{ left: "rsi14", operator: "lt", rightType: "value", rightValue: 45 }, { left: "close", operator: "lt", rightType: "indicator", rightIndicator: "ma20" }] },
  { id: "long-ma", name: "长线均线趋势", description: "MA10向上穿越MA30后跟随长期趋势，反向穿越时退出。", summary: "MA10 / MA30 长趋势", tag: "长线", color: "#f3c84b", builtin: true, horizon: "long", entryLogic: "and", exitLogic: "or", entryRules: [{ left: "ma10", operator: "crossesAbove", rightType: "indicator", rightIndicator: "ma30" }], exitRules: [{ left: "ma10", operator: "crossesBelow", rightType: "indicator", rightIndicator: "ma30" }] },
  { id: "long-defensive", name: "长线稳健持有", description: "价格在MA30上方且波动温和时持有，跌破长期均线或波动明显放大时离场。", summary: "MA30 + 长期低波动", tag: "长线", color: "#67c8ff", builtin: true, horizon: "long", entryLogic: "and", exitLogic: "or", entryRules: [{ left: "close", operator: "gt", rightType: "indicator", rightIndicator: "ma30" }, { left: "volatility20", operator: "lt", rightType: "value", rightValue: 2 }], exitRules: [{ left: "close", operator: "lt", rightType: "indicator", rightIndicator: "ma30" }, { left: "volatility20", operator: "gt", rightType: "value", rightValue: 3.2 }] },
  { id: "long-ma20-60", name: "长期多头排列", description: "MA20上穿MA60后进入长期多头阶段，均线反转时退出。", summary: "MA20 / MA60 长周期", tag: "长线", color: "#f0b85a", builtin: true, horizon: "long", entryLogic: "and", exitLogic: "or", entryRules: [{ left: "ma20", operator: "crossesAbove", rightType: "indicator", rightIndicator: "ma60" }], exitRules: [{ left: "ma20", operator: "crossesBelow", rightType: "indicator", rightIndicator: "ma60" }] },
  { id: "long-confirmed", name: "长期趋势确认", description: "价格、MA20同时位于MA60上方时持有，价格跌破MA30时保护利润。", summary: "价格 + MA20 站上 MA60", tag: "长线", color: "#d9a7ff", builtin: true, horizon: "long", entryLogic: "and", exitLogic: "or", entryRules: [{ left: "close", operator: "gt", rightType: "indicator", rightIndicator: "ma60" }, { left: "ma20", operator: "gt", rightType: "indicator", rightIndicator: "ma60" }], exitRules: [{ left: "close", operator: "lt", rightType: "indicator", rightIndicator: "ma30" }] },
];

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: APP_TIME_ZONE, month: "2-digit", day: "2-digit" });
const fullDateFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: APP_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

function toSymbol(code: string) {
  if (code.startsWith("6")) return `${code}.SH`;
  if (code.startsWith("0") || code.startsWith("3")) return `${code}.SZ`;
  return `${code}.BJ`;
}

function runBacktest(bars: Kline[], strategies: Strategy[], initialCapital: number, positionPercent: number, stopLoss: number, takeProfit: number): BacktestResult {
  if (bars.length < 25) return { ...emptyBacktest, finalEquity: initialCapital };

  const commissionRate = 0.00025;
  const slippageRate = 0.001;
  let cash = initialCapital;
  let shares = 0;
  let entryPrice = 0;
  let wins = 0;
  let closedTrades = 0;
  const trades: Trade[] = [];
  const equityValues: number[] = [];

  bars.forEach((bar, index) => {
    const equityBefore = cash + shares * bar.close;
    if (shares === 0) {
      const buySignal = combinedSignalFor(strategies, bars, index, "buy");
      if (buySignal.active) {
        const executionPrice = bar.close * (1 + slippageRate);
        const allocation = Math.min(cash, equityBefore * positionPercent / 100);
        const quantity = Math.floor(allocation / executionPrice / 100) * 100;
        const cost = quantity * executionPrice;
        const commission = Math.max(5, cost * commissionRate);
        if (quantity >= 100 && cost + commission <= cash) {
          cash -= cost + commission;
          shares = quantity;
          entryPrice = executionPrice;
          trades.push({ index, action: "buy", date: dateFormatter.format(bar.timestamp), price: executionPrice, shares: quantity, reason: buySignal.reason });
        }
      }
    } else {
      const returnSinceEntry = bar.close / entryPrice - 1;
      const strategySell = combinedSignalFor(strategies, bars, index, "sell");
      const hitStopLoss = returnSinceEntry <= -stopLoss / 100;
      const hitTakeProfit = returnSinceEntry >= takeProfit / 100;
      if (strategySell.active || hitStopLoss || hitTakeProfit) {
        const executionPrice = bar.close * (1 - slippageRate);
        const proceeds = shares * executionPrice;
        const commission = Math.max(5, proceeds * commissionRate);
        cash += proceeds - commission;
        if (executionPrice > entryPrice) wins += 1;
        closedTrades += 1;
        trades.push({
          index,
          action: "sell",
          date: dateFormatter.format(bar.timestamp),
          price: executionPrice,
          shares,
          reason: hitStopLoss ? `触发${stopLoss}%止损` : hitTakeProfit ? `触发${takeProfit}%止盈` : strategySell.reason,
        });
        shares = 0;
        entryPrice = 0;
      }
    }
    equityValues.push(cash + shares * bar.close);
  });

  const finalEquity = equityValues.at(-1) ?? initialCapital;
  const totalReturn = (finalEquity / initialCapital - 1) * 100;
  const annualReturn = (Math.pow(finalEquity / initialCapital, 252 / Math.max(1, bars.length)) - 1) * 100;
  let peak = equityValues[0];
  let maxDrawdown = 0;
  equityValues.forEach((value) => {
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, (value / peak - 1) * 100);
  });
  const dailyReturns = equityValues.slice(1).map((value, index) => value / equityValues[index] - 1);
  const dailyStd = standardDeviation(dailyReturns);
  const sharpe = dailyStd ? average(dailyReturns) / dailyStd * Math.sqrt(252) : 0;
  const firstClose = bars[0].close;
  const lastClose = bars.at(-1)?.close ?? firstClose;

  return {
    equityPercent: equityValues.map((value) => (value / initialCapital - 1) * 100),
    benchmarkPercent: bars.map((bar) => (bar.close / firstClose - 1) * 100),
    equityValues,
    timestamps: bars.map((bar) => bar.timestamp),
    trades,
    finalEquity,
    totalReturn,
    annualReturn,
    maxDrawdown,
    sharpe,
    winRate: closedTrades ? wins / closedTrades * 100 : 0,
    position: shares > 0 ? { shares, cost: entryPrice, price: lastClose, pnl: (lastClose - entryPrice) * shares, rate: (lastClose / entryPrice - 1) * 100 } : null,
  };
}

type MovingAverageDefinition = { period: number; label: string; color: string };

const defaultMovingAverages: MovingAverageDefinition[] = [
  { period: 5, label: "MA5", color: "#f4c95d" },
  { period: 10, label: "MA10", color: "#67c8ff" },
  { period: 30, label: "MA30", color: "#b38cff" },
];

function movingAverageSeries(bars: Kline[], period: number) {
  let sum = 0;
  return bars.map((bar, index) => {
    sum += bar.close;
    if (index >= period) sum -= bars[index - period].close;
    return index + 1 >= period ? sum / period : null;
  });
}

function EquityChart({ result, bars }: { result: BacktestResult; bars: Kline[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startOffset: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<{ index: number; x: number; alignLeft: boolean } | null>(null);
  const [visibleCount, setVisibleCount] = useState(() => Math.min(120, Math.max(1, bars.length)));
  const [endOffset, setEndOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [enabledPeriods, setEnabledPeriods] = useState<number[]>([5, 10, 30]);
  const [customPeriod, setCustomPeriod] = useState(60);
  const [customInput, setCustomInput] = useState("60");

  const safeVisibleCount = Math.min(Math.max(1, visibleCount), Math.max(1, bars.length));
  const maxEndOffset = Math.max(0, bars.length - safeVisibleCount);
  const safeEndOffset = Math.min(endOffset, maxEndOffset);
  const visibleEnd = Math.max(0, bars.length - safeEndOffset);
  const visibleStart = Math.max(0, visibleEnd - safeVisibleCount);
  const visibleBars = useMemo(() => bars.slice(visibleStart, visibleEnd), [bars, visibleEnd, visibleStart]);
  const maDefinitions = useMemo(() => {
    const definitions = [...defaultMovingAverages];
    if (!definitions.some((item) => item.period === customPeriod)) definitions.push({ period: customPeriod, label: `MA${customPeriod}`, color: "#ff8ea1" });
    return definitions;
  }, [customPeriod]);
  const maValues = useMemo(() => new Map(maDefinitions.map((item) => [item.period, movingAverageSeries(bars, item.period)])), [bars, maDefinitions]);
  const enabledDefinitions = maDefinitions.filter((item) => enabledPeriods.includes(item.period));
  const hoverIndex = hover?.index ?? null;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const width = rect.width;
      const height = rect.height;
      ctx.clearRect(0, 0, width, height);

      if (!visibleBars.length) {
        ctx.fillStyle = "#728098";
        ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.fillText("正在读取 TickFlow 上市以来日K…", width / 2, height / 2);
        return;
      }

      const pad = { top: 24, right: 18, bottom: 28, left: 50 };
      const chartW = Math.max(1, width - pad.left - pad.right);
      const chartH = Math.max(1, height - pad.top - pad.bottom);
      const visibleMaValues = enabledDefinitions.flatMap((definition) => (maValues.get(definition.period) ?? []).slice(visibleStart, visibleEnd).filter((value): value is number => value !== null));
      const priceValues = visibleBars.flatMap((bar) => [bar.low, bar.high]);
      const rawMin = Math.min(...priceValues, ...visibleMaValues);
      const rawMax = Math.max(...priceValues, ...visibleMaValues);
      const spread = Math.max(rawMax * .01, rawMax - rawMin, .01);
      const min = rawMin - spread * .08;
      const max = rawMax + spread * .08;
      const slot = chartW / visibleBars.length;
      const xForLocalIndex = (index: number) => pad.left + (index + .5) * slot;
      const yForValue = (value: number) => pad.top + (1 - (value - min) / (max - min)) * chartH;

      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      for (let index = 0; index <= 4; index += 1) {
        const y = pad.top + chartH / 4 * index;
        const value = max - (max - min) / 4 * index;
        ctx.strokeStyle = "rgba(126, 143, 172, .12)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
        ctx.fillStyle = "#62708a";
        ctx.textAlign = "right";
        ctx.fillText(value.toFixed(2), pad.left - 8, y + 3);
      }
      ctx.fillStyle = "#7b899f";
      ctx.textAlign = "left";
      ctx.fillText("元", 8, pad.top - 7);

      for (let index = 0; index <= 6; index += 1) {
        const x = pad.left + chartW / 6 * index;
        ctx.strokeStyle = "rgba(126, 143, 172, .08)";
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, height - pad.bottom); ctx.stroke();
      }

      const candleWidth = Math.max(1, Math.min(12, slot * .66));
      visibleBars.forEach((bar, localIndex) => {
        const x = xForLocalIndex(localIndex);
        const up = bar.close >= bar.open;
        const color = up ? "#ff5b6e" : "#37d6aa";
        const openY = yForValue(bar.open);
        const closeY = yForValue(bar.close);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, Math.min(1.5, candleWidth / 5));
        ctx.beginPath(); ctx.moveTo(x, yForValue(bar.high)); ctx.lineTo(x, yForValue(bar.low)); ctx.stroke();
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(1, Math.abs(closeY - openY));
        ctx.fillStyle = up ? `${color}dd` : `${color}c2`;
        ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
      });

      enabledDefinitions.forEach((definition) => {
        const values = maValues.get(definition.period) ?? [];
        ctx.save();
        ctx.strokeStyle = definition.color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "round";
        ctx.beginPath();
        let started = false;
        for (let globalIndex = visibleStart; globalIndex < visibleEnd; globalIndex += 1) {
          const value = values[globalIndex];
          if (value === null || value === undefined) { started = false; continue; }
          const x = xForLocalIndex(globalIndex - visibleStart);
          const y = yForValue(value);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      });

      result.trades.filter((trade) => trade.index >= visibleStart && trade.index < visibleEnd).forEach((trade) => {
        const localIndex = trade.index - visibleStart;
        const bar = bars[trade.index];
        const x = xForLocalIndex(localIndex);
        const y = yForValue(bar?.close ?? trade.price);
        const isBuy = trade.action === "buy";
        const color = isBuy ? "#ff5b6e" : "#37d6aa";
        const iconY = Math.max(pad.top + 9, Math.min(height - pad.bottom - 9, y + (isBuy ? 19 : -19)));
        ctx.strokeStyle = `${color}95`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, iconY); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, iconY, 7.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        ctx.fillStyle = "#071018"; ctx.font = "bold 8px ui-monospace, monospace"; ctx.textAlign = "center";
        ctx.fillText(isBuy ? "B" : "S", x, iconY + 3);
      });

      if (hoverIndex !== null && hoverIndex >= visibleStart && hoverIndex < visibleEnd) {
        const localIndex = hoverIndex - visibleStart;
        const bar = bars[hoverIndex];
        const x = xForLocalIndex(localIndex);
        const y = yForValue(bar.close);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(174, 193, 222, .5)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, height - pad.bottom); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fillStyle = "#f4f8ff"; ctx.fill();
        ctx.restore();
      }

      const labelIndexes = [0, .25, .5, .75, 1].map((ratio) => Math.min(visibleBars.length - 1, Math.round((visibleBars.length - 1) * ratio)));
      ctx.fillStyle = "#62708a"; ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace"; ctx.textAlign = "center";
      labelIndexes.forEach((localIndex) => ctx.fillText(dateFormatter.format(visibleBars[localIndex].timestamp), xForLocalIndex(localIndex), height - 7));
    };

    draw();
    const observer = new ResizeObserver(draw);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, [bars, enabledDefinitions, hoverIndex, maValues, result.trades, visibleBars, visibleEnd, visibleStart]);

  const hoverForIndex = (index: number, width: number) => {
    const localIndex = index - visibleStart;
    const x = 50 + (localIndex + .5) / Math.max(1, safeVisibleCount) * Math.max(1, width - 68);
    return { index, x, alignLeft: x > width * .62 };
  };

  const indexFromPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (!visibleBars.length || x < 50 || x > rect.width - 18 || y < 24 || y > rect.height - 28) return null;
    const localIndex = Math.max(0, Math.min(visibleBars.length - 1, Math.floor((x - 50) / Math.max(1, rect.width - 68) * visibleBars.length)));
    return hoverForIndex(visibleStart + localIndex, rect.width);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startOffset: safeEndOffset, moved: false };
    setHover(indexFromPointer(event));
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      const deltaX = event.clientX - drag.startX;
      if (Math.abs(deltaX) > 3) {
        drag.moved = true;
        setDragging(true);
        const rect = event.currentTarget.getBoundingClientRect();
        const barsDelta = Math.round(deltaX / Math.max(3, (rect.width - 68) / safeVisibleCount));
        setEndOffset(Math.max(0, Math.min(maxEndOffset, drag.startOffset + barsDelta)));
        setHover(null);
        return;
      }
    }
    const next = indexFromPointer(event);
    setHover((current) => current?.index === next?.index && current?.x === next?.x ? current : next);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (!dragRef.current.moved) setHover(indexFromPointer(event));
    dragRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const applyZoom = (nextCount: number, anchorRatio = .5) => {
    const next = Math.max(Math.min(30, bars.length), Math.min(bars.length, Math.round(nextCount)));
    if (!bars.length || next === safeVisibleCount) return;
    const anchorIndex = visibleStart + Math.floor(safeVisibleCount * anchorRatio);
    const nextStart = Math.max(0, Math.min(bars.length - next, anchorIndex - Math.floor(next * anchorRatio)));
    setVisibleCount(next);
    setEndOffset(Math.max(0, bars.length - nextStart - next));
    setHover(null);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const anchorRatio = Math.max(0, Math.min(1, (event.clientX - rect.left - 50) / Math.max(1, rect.width - 68)));
    applyZoom(safeVisibleCount * (event.deltaY > 0 ? 1.18 : .84), anchorRatio);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const width = event.currentTarget.getBoundingClientRect().width;
    setHover((current) => {
      const index = Math.max(visibleStart, Math.min(visibleEnd - 1, (current?.index ?? visibleEnd - 1) + direction));
      return hoverForIndex(index, width);
    });
  };

  const togglePeriod = (period: number) => setEnabledPeriods((periods) => periods.includes(period) ? periods.filter((item) => item !== period) : [...periods, period]);
  const applyCustomPeriod = () => {
    const next = Math.max(2, Math.min(250, Math.round(Number(customInput) || customPeriod)));
    setCustomPeriod(next);
    setCustomInput(String(next));
    setEnabledPeriods((periods) => periods.includes(next) ? periods : [...periods, next]);
  };
  const activeIndex = hoverIndex !== null && bars[hoverIndex] ? hoverIndex : null;
  const maxStart = Math.max(0, bars.length - safeVisibleCount);

  return <div className="kline-chart">
    <div className="chart-indicator-toolbar">
      <div className="ma-switches" role="group" aria-label="移动平均线">
        {defaultMovingAverages.map((definition) => <button key={definition.period} className={enabledPeriods.includes(definition.period) ? "active" : ""} onClick={() => togglePeriod(definition.period)} style={{ "--ma-color": definition.color } as CSSProperties}><i />{definition.label}</button>)}
      </div>
      <label className="custom-ma"><span>自定义 MA</span><input type="number" min="2" max="250" value={customInput} onChange={(event) => setCustomInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyCustomPeriod(); }} aria-label="自定义均线周期" /><button onClick={applyCustomPeriod}>应用</button></label>
      <div className="chart-zoom" aria-label="图表缩放"><button onClick={() => applyZoom(safeVisibleCount * 1.25)} aria-label="缩小图表">−</button><button onClick={() => applyZoom(safeVisibleCount * .8)} aria-label="放大图表">＋</button><button onClick={() => { setEndOffset(0); setHover(null); }}>最新</button></div>
    </div>
    <div className={`chart-viewport ${dragging ? "dragging" : ""}`}>
      <canvas
        ref={ref}
        aria-label="上市以来真实日K蜡烛图，包含MA5、MA10、MA30和自定义均线；可拖动浏览、滚轮缩放、使用左右方向键查看具体价格"
        onBlur={() => setHover(null)}
        onFocus={(event) => { if (visibleBars.length) setHover(hoverForIndex(visibleEnd - 1, event.currentTarget.getBoundingClientRect().width)); }}
        onKeyDown={handleKeyDown}
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerLeave={() => { if (!dragRef.current) setHover(null); }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        tabIndex={0}
      />
      {activeIndex !== null && hover && <div className={`chart-tooltip ${hover.alignLeft ? "align-left" : ""}`} style={{ left: hover.x }} role="status">
        <time>{fullDateFormatter.format(bars[activeIndex].timestamp)}</time>
        <div><i className="close-dot" /><span>开 / 高 / 低 / 收</span><b>{bars[activeIndex].open.toFixed(2)} / {bars[activeIndex].high.toFixed(2)} / {bars[activeIndex].low.toFixed(2)} / {bars[activeIndex].close.toFixed(2)}</b></div>
        {enabledDefinitions.map((definition) => <div key={definition.period}><i style={{ background: definition.color }} /><span>{definition.label}</span><b>{maValues.get(definition.period)?.[activeIndex]?.toFixed(3) ?? "—"}</b></div>)}
      </div>}
    </div>
    <div className="chart-navigator">
      <span>{visibleBars[0] ? fullDateFormatter.format(visibleBars[0].timestamp) : "—"}</span>
      <input type="range" min="0" max={maxStart} value={Math.min(visibleStart, maxStart)} onChange={(event) => setEndOffset(Math.max(0, bars.length - Number(event.target.value) - safeVisibleCount))} disabled={!maxStart} aria-label="拖动浏览历史K线" />
      <span>{visibleBars.at(-1) ? fullDateFormatter.format(visibleBars.at(-1)!.timestamp) : "—"}</span>
      <small>{safeVisibleCount} / {bars.length} 根</small>
    </div>
  </div>;
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "down" }) {
  return <div className="metric-card"><span>{label}</span><strong className={tone}>{value}</strong></div>;
}

function formatPercent(value: number, signed = true) {
  if (!Number.isFinite(value)) return "—";
  return `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function Home() {
  const [watchlist, setWatchlist] = useState<WatchItem[]>(initialWatchlist);
  const [selectedStock, setSelectedStock] = useState("601939");
  const [selectedStrategyIds, setSelectedStrategyIds] = useState<string[]>([builtinStrategies[0].id]);
  const [strategyTab, setStrategyTab] = useState<Strategy["horizon"]>("short");
  const [customStrategies, setCustomStrategies] = useState<Strategy[]>([]);
  const [studioMode, setStudioMode] = useState<StudioMode>(null);
  const [showAutomation, setShowAutomation] = useState(false);
  const [showPaperAccounts, setShowPaperAccounts] = useState(false);
  const [taskTarget, setTaskTarget] = useState<PaperAccountTaskTarget | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [authStatus, setAuthStatus] = useState<"loading" | "ready">("loading");
  const [adminReady, setAdminReady] = useState(true);
  const [showAccount, setShowAccount] = useState(false);
  const [aiSettings, setAiSettings] = useState({ baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", apiKey: "" });
  const [period, setPeriod] = useState("近6月");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [showSearch, setShowSearch] = useState(false);
  const [position, setPosition] = useState(30);
  const [stopLoss, setStopLoss] = useState(8);
  const [takeProfit, setTakeProfit] = useState(22);
  const [autoRebalance, setAutoRebalance] = useState(true);
  const [initialCapital, setInitialCapital] = useState(1_000_000);
  const [capitalInput, setCapitalInput] = useState("1000000");
  const [series, setSeries] = useState<Record<string, Kline[]>>({});
  const [historySeries, setHistorySeries] = useState<Record<string, Kline[]>>({});
  const [dataStatus, setDataStatus] = useState<"loading" | "ready" | "error">("loading");
  const [historyStatus, setHistoryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [realtimeStatus, setRealtimeStatus] = useState<"idle" | "loading" | "live" | "unavailable" | "error">("idle");
  const [lastRealtimeAt, setLastRealtimeAt] = useState<number | null>(null);
  const [realtimeConfigTick, setRealtimeConfigTick] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(100);
  const [runCount, setRunCount] = useState(12);
  const [toast, setToast] = useState("");
  const realtimeQuotesRef = useRef<Record<string, RealtimeQuote>>({});
  const allStrategies = useMemo(() => [...builtinStrategies, ...customStrategies], [customStrategies]);
  const selectedStrategies = useMemo(() => selectedStrategyIds.flatMap((id) => {
    const strategy = allStrategies.find((item) => item.id === id);
    return strategy ? [strategy] : [];
  }), [allStrategies, selectedStrategyIds]);
  const strategyGroups = useMemo<Array<{ id: Strategy["horizon"]; label: string; note: string; items: Strategy[] }>>(() => [
    { id: "short", label: "短线策略", note: "约 1—20 个交易日", items: allStrategies.filter((strategy) => strategy.horizon === "short") },
    { id: "medium", label: "中期策略", note: "约 1—6 个月", items: allStrategies.filter((strategy) => strategy.horizon === "medium") },
    { id: "long", label: "长线策略", note: "6 个月以上", items: allStrategies.filter((strategy) => strategy.horizon === "long") },
    { id: "custom", label: "我的策略", note: "自定义规则", items: allStrategies.filter((strategy) => strategy.horizon === "custom") },
  ], [allStrategies]);
  const activeStrategyGroup = strategyGroups.find((group) => group.id === strategyTab) ?? strategyGroups[0];

  useEffect(() => {
    const stored = window.localStorage.getItem("paper-alpha-watchlist-v2");
    if (stored) {
      // Restoring persisted client preferences is the purpose of this mount-only effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      try { setWatchlist(JSON.parse(stored)); }
      catch { window.localStorage.removeItem("paper-alpha-watchlist-v2"); }
    }
    const storedCapital = Number(window.localStorage.getItem("paper-alpha-capital"));
    if (storedCapital > 0) {
      setInitialCapital(storedCapital);
      setCapitalInput(String(storedCapital));
    }
  }, []);

  const loadAccountData = async () => {
    const [strategyResponse, settingsResponse] = await Promise.all([fetch("/api/strategies"), fetch("/api/settings")]);
    if (strategyResponse.ok) {
      const strategyPayload = await strategyResponse.json() as { strategies: SavedStrategy[] };
      setCustomStrategies(strategyPayload.strategies.map((strategy) => ({ ...strategy, summary: strategyRuleSummary(strategy.entryRules, strategy.entryLogic), color: "#f4c95d", builtin: false, horizon: "custom" })));
    }
    if (settingsResponse.ok) {
      const settingsPayload = await settingsResponse.json() as { settings: { aiBaseUrl: string; aiModel: string } };
      setAiSettings((current) => ({ ...current, baseUrl: settingsPayload.settings.aiBaseUrl, model: settingsPayload.settings.aiModel }));
    }
  };

  useEffect(() => {
    let active = true;
    fetch("/api/user")
      .then((response) => response.json() as Promise<{ user: Viewer | null; adminReady: boolean }>)
      .then(async (payload) => {
        if (!active) return;
        setViewer(payload.user); setAdminReady(payload.adminReady); setAuthStatus("ready");
        if (payload.user) await loadAccountData();
      })
      .catch(() => { if (active) setAuthStatus("ready"); });
    return () => { active = false; };
  // The account bootstrap only runs once; later refreshes happen after login.
  }, []);

  useEffect(() => { window.localStorage.setItem("paper-alpha-watchlist-v2", JSON.stringify(watchlist)); }, [watchlist]);
  useEffect(() => { window.localStorage.setItem("paper-alpha-capital", String(initialCapital)); }, [initialCapital]);

  const watchlistCodes = watchlist.map((item) => item.code).sort().join(",");
  useEffect(() => {
    if (!watchlistCodes) {
      // Keep the empty state synchronized when the final watchlist item is removed.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeries({}); setDataStatus("ready"); return;
    }
    const controller = new AbortController();
    setDataStatus("loading");
    const symbols = watchlistCodes.split(",").map(toSymbol).join(",");
    fetch(`/api/tickflow?symbols=${encodeURIComponent(symbols)}&count=240`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("TickFlow data request failed");
        return response.json() as Promise<{ data: Record<string, Kline[]> }>;
      })
      .then((payload) => {
        setSeries(payload.data);
        setWatchlist((items) => items.map((item) => {
          const bars = payload.data[toSymbol(item.code)];
          if (!bars?.length) return { ...item, signal: "加载失败" };
          const latest = bars.at(-1)!;
          const previous = bars.at(-2) ?? latest;
          const ma20 = average(bars.slice(-20).map((bar) => bar.close));
          const realtime = realtimeQuotesRef.current[toSymbol(item.code)];
          return {
            ...item,
            price: realtime?.lastPrice ?? latest.close,
            change: realtime ? (realtime.lastPrice / realtime.previousClose - 1) * 100 : (latest.close / previous.close - 1) * 100,
            signal: latest.close > ma20 ? "趋势向上" : "观察",
          };
        }));
        setDataStatus("ready");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataStatus("error");
        setToast("TickFlow 数据暂时无法读取，请稍后重试");
      });
    return () => controller.abort();
  }, [watchlistCodes, refreshTick]);

  useEffect(() => {
    if (!watchlistCodes || !viewer) {
      // Realtime quotes are account-scoped and only start after login.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRealtimeStatus("idle");
      return;
    }

    let active = true;
    let requestController: AbortController | null = null;
    let requestTimeout: number | null = null;
    let pollTimer: number | null = null;
    const symbols = watchlistCodes.split(",").map(toSymbol).join(",");

    const stopPolling = () => {
      if (pollTimer !== null) window.clearInterval(pollTimer);
      pollTimer = null;
    };

    const loadRealtimeQuotes = async () => {
      if (!active || document.visibilityState !== "visible" || requestController) return;
      requestController = new AbortController();
      requestTimeout = window.setTimeout(() => requestController?.abort(), 8_000);
      try {
        const response = await fetch(`/api/tickflow/quotes?symbols=${encodeURIComponent(symbols)}`, {
          cache: "no-store",
          signal: requestController.signal,
        });
        const payload = await response.json() as { configured?: boolean; quotes?: Record<string, RealtimeQuote> };
        if (response.status === 401 || response.status === 409 || payload.configured === false) {
          setRealtimeStatus("unavailable");
          stopPolling();
          return;
        }
        if (!response.ok || !payload.quotes || !Object.keys(payload.quotes).length) throw new Error("Realtime quote request failed");
        realtimeQuotesRef.current = { ...realtimeQuotesRef.current, ...payload.quotes };
        setWatchlist((items) => items.map((item) => {
          const quote = payload.quotes?.[toSymbol(item.code)];
          if (!quote) return item;
          return {
            ...item,
            price: quote.lastPrice,
            change: (quote.lastPrice / quote.previousClose - 1) * 100,
          };
        }));
        const newestTimestamp = Math.max(...Object.values(payload.quotes).map((quote) => quote.timestamp));
        setLastRealtimeAt(Number.isFinite(newestTimestamp) ? newestTimestamp : Date.now());
        setRealtimeStatus("live");
      } catch {
        if (!active) return;
        setRealtimeStatus("error");
      } finally {
        if (requestTimeout !== null) window.clearTimeout(requestTimeout);
        requestTimeout = null;
        requestController = null;
      }
    };

    // Start with a snapshot, then poll only while this tab is visible.
    setRealtimeStatus("loading");
    void loadRealtimeQuotes();
    pollTimer = window.setInterval(() => void loadRealtimeQuotes(), 10_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void loadRealtimeQuotes();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      stopPolling();
      if (requestTimeout !== null) window.clearTimeout(requestTimeout);
      requestController?.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [watchlistCodes, viewer, realtimeConfigTick]);

  const selectedSymbol = toSymbol(selectedStock || "601939");
  useEffect(() => {
    if (!selectedStock) return;
    const controller = new AbortController();
    // A symbol change starts a new external history request immediately.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistoryStatus("loading");
    fetch(`/api/tickflow?symbols=${encodeURIComponent(selectedSymbol)}&count=10000`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("TickFlow full history request failed");
        return response.json() as Promise<{ data: Record<string, Kline[]> }>;
      })
      .then((payload) => {
        const bars = payload.data[selectedSymbol] ?? [];
        if (!bars.length) throw new Error("TickFlow returned no full history");
        setHistorySeries((current) => ({ ...current, [selectedSymbol]: bars }));
        setHistoryStatus("ready");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHistoryStatus("error");
        setToast("完整历史暂时无法读取，已回退到近期日K");
      });
    return () => controller.abort();
  }, [selectedStock, selectedSymbol, refreshTick]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setProgress((value) => {
        const next = Math.min(100, value + 5);
        if (next === 100) {
          window.clearInterval(timer);
          window.setTimeout(() => {
            setRunning(false);
            setRunCount((count) => count + 1);
            setToast(`${selectedStrategies.length} 个策略已基于真实日K重新计算`);
          }, 160);
        }
        return next;
      });
    }, 80);
    return () => window.clearInterval(timer);
  }, [running, selectedStrategies.length]);

  useEffect(() => {
    const query = search.trim();
    if (!showSearch || !query) {
      // Reset results immediately when the search UI is closed or cleared.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults([]);
      setSearchStatus("idle");
      return;
    }

    const controller = new AbortController();
    let requestTimeout: number | undefined;
    setSearchStatus("loading");
    const timer = window.setTimeout(() => {
      const requestController = new AbortController();
      const stopRequest = () => requestController.abort();
      controller.signal.addEventListener("abort", stopRequest, { once: true });
      requestTimeout = window.setTimeout(() => requestController.abort(), 15_000);
      fetch(`/api/tickflow/search?q=${encodeURIComponent(query)}`, { signal: requestController.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("search failed");
          return response.json() as Promise<{ results: StockSearchResult[] }>;
        })
        .then((payload) => {
          setSearchResults(payload.results.filter((item) => !watchlist.some((watch) => watch.code === item.code)));
          setSearchStatus("ready");
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSearchResults([]);
          setSearchStatus("error");
        })
        .finally(() => {
          if (requestTimeout !== undefined) window.clearTimeout(requestTimeout);
          controller.signal.removeEventListener("abort", stopRequest);
        });
    }, 320);

    return () => {
      window.clearTimeout(timer);
      if (requestTimeout !== undefined) window.clearTimeout(requestTimeout);
      controller.abort();
    };
  }, [search, showSearch, watchlist]);

  const allBars = useMemo(() => historySeries[selectedSymbol] ?? series[selectedSymbol] ?? [], [historySeries, selectedSymbol, series]);
  const periodBars = useMemo(() => {
    if (!allBars.length) return [];
    if (period === "全部") return allBars;
    if (period === "今年") {
      const currentYear = appDateKey().slice(0, 4);
      return allBars.filter((bar) => appDateKey(bar.timestamp).startsWith(currentYear));
    }
    const sizes: Record<string, number> = { "近1月": 22, "近3月": 66, "近6月": 132 };
    return allBars.slice(-Math.min(allBars.length, sizes[period] ?? 132));
  }, [allBars, period]);
  const backtest = useMemo(() => runBacktest(periodBars, selectedStrategies, initialCapital, position, stopLoss, takeProfit), [periodBars, selectedStrategies, initialCapital, position, stopLoss, takeProfit]);
  const selectedItem = watchlist.find((item) => item.code === selectedStock) ?? watchlist[0];
  const latestBar = allBars.at(-1);
  const realtimeLabel = realtimeStatus === "live" ? "实时行情 · 10秒轮询" : realtimeStatus === "loading" ? "实时行情连接中" : realtimeStatus === "error" ? "实时行情重试中" : "历史日K行情";
  const realtimeDetail = realtimeStatus === "live" && lastRealtimeAt ? timeFormatter.format(lastRealtimeAt) : realtimeStatus === "loading" ? "连接中" : realtimeStatus === "error" ? "自动重试" : "需配置 Key";
  const recentTrades = backtest.trades.slice(-3).reverse();
  const viewerInitials = viewer ? viewer.displayName.slice(0, 2).toUpperCase() : "…";

  const addStock = (stock: StockSearchResult) => {
    setWatchlist((items) => [...items, { code: stock.code, name: stock.name, price: 0, change: 0, signal: "同步中" }]);
    setSelectedStock(stock.code);
    setSearch(""); setShowSearch(false); setToast(`${stock.name}已加入自选，正在读取真实日K`);
  };

  const removeStock = (code: string) => {
    const stock = watchlist.find((item) => item.code === code);
    const remaining = watchlist.filter((item) => item.code !== code);
    setWatchlist(remaining);
    if (selectedStock === code) setSelectedStock(remaining[0]?.code ?? "");
    setToast(`${stock?.name ?? "股票"}已移出自选`);
  };

  const runSimulation = () => {
    if (running) return;
    setRefreshTick((value) => value + 1);
    setProgress(0); setRunning(true);
  };

  const toggleBacktestStrategy = (strategy: Strategy) => {
    if (selectedStrategyIds.includes(strategy.id)) {
      if (selectedStrategyIds.length === 1) { setToast("回测至少需要保留一个策略"); return; }
      setSelectedStrategyIds(selectedStrategyIds.filter((id) => id !== strategy.id));
      return;
    }
    if (selectedStrategyIds.length >= 8) { setToast("一次最多同时启用 8 个策略"); return; }
    setSelectedStrategyIds([...selectedStrategyIds, strategy.id]);
  };

  const handleStrategyCreated = (saved: SavedStrategy) => {
    const strategy: Strategy = { ...saved, summary: strategyRuleSummary(saved.entryRules, saved.entryLogic), color: "#f4c95d", builtin: false, horizon: "custom" };
    setCustomStrategies((items) => [strategy, ...items]);
    setSelectedStrategyIds([strategy.id]);
    setStrategyTab("custom");
    setStudioMode(null);
    setToast(`${strategy.name}已保存并开始回测`);
  };

  const handleStrategyDeleted = async (id: string) => {
    const target = customStrategies.find((strategy) => strategy.id === id);
    if (!target || !window.confirm(`确认删除策略“${target.name}”？`)) return;
    const response = await fetch("/api/strategies", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!response.ok) { setToast("策略删除失败，请重试"); return; }
    setCustomStrategies((items) => items.filter((strategy) => strategy.id !== id));
    const resetToDefault = selectedStrategyIds.length === 1 && selectedStrategyIds[0] === id;
    setSelectedStrategyIds((current) => resetToDefault ? [builtinStrategies[0].id] : current.filter((strategyId) => strategyId !== id));
    if (resetToDefault) setStrategyTab("short");
    setToast(`${target.name}已删除`);
  };

  const handleAuthenticated = (user: Viewer) => {
    setViewer(user); setAuthStatus("ready"); setToast(`欢迎，${user.displayName}`);
    void loadAccountData();
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setViewer(null); setCustomStrategies([]); setSelectedStrategyIds([builtinStrategies[0].id]); setStrategyTab("short"); setShowAccount(false); setShowPaperAccounts(false); setTaskTarget(null);
  };

  const editCapital = (rawValue: string) => {
    const editableValue = rawValue.replace(/[^0-9.,，wW万\s]/g, "");
    setCapitalInput(editableValue);
    const value = parseCapitalInput(editableValue);
    if (value !== null) setInitialCapital(value);
  };

  const commitCapital = () => {
    const value = parseCapitalInput(capitalInput);
    if (value === null) {
      setCapitalInput(String(initialCapital));
      setToast("请输入大于 0 的金额，可使用 2w 或 2万");
      return;
    }
    setInitialCapital(value);
    setCapitalInput(String(value));
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><div><b>PAPER ALPHA</b><small>A股策略模拟台</small></div></div>
        <div className="market-strip" aria-label="真实数据状态">
          <span><i className={realtimeStatus === "live" ? "live-dot" : realtimeStatus === "error" ? "error-dot" : "demo-dot"} /> TickFlow {realtimeLabel}</span>
          <b>{selectedItem?.name ?? "建设银行"} <em className={(selectedItem?.change ?? 0) >= 0 ? "up" : "down"}>{selectedItem?.price ? selectedItem.price.toFixed(2) : "—"}</em></b>
          <b>行情时间 <em>{realtimeStatus === "live" && lastRealtimeAt ? timeFormatter.format(lastRealtimeAt) : latestBar ? fullDateFormatter.format(latestBar.timestamp) : "同步中"}</em></b>
          <b><em>{realtimeStatus === "live" ? "实时快照 · 前台轮询" : "前复权 · 非实时"}</em></b>
        </div>
        <div className="top-actions"><span className="trade-day">{realtimeStatus === "live" ? "实时行情 · 每10秒更新" : "免费日K · 实时需 TickFlow Key"}</span><button className="icon-button paper-button" aria-label="我的模拟盘" onClick={() => setShowPaperAccounts(true)}>◎<span>模拟盘</span></button><button className="icon-button task-button" aria-label="定时任务" onClick={() => { setTaskTarget(null); setShowAutomation(true); }}>◴<span>任务</span></button><button className="icon-button notify-button" aria-label="通知配置" onClick={() => setShowNotifications(true)}>⌁<span>通知</span></button><button className="icon-button" aria-label="AI接口配置" onClick={() => setStudioMode("settings")}>✦<span>AI</span></button><div className="account-wrap"><button className="account-button" onClick={() => setShowAccount((value) => !value)} aria-expanded={showAccount}><i>{viewerInitials}</i><span>{viewer ? viewer.displayName : authStatus === "loading" ? "确认登录中" : "未登录"}<br /><small>{viewer ? viewer.role === "superadmin" ? "超级管理员" : "个人策略账户" : "登录后保存策略"}</small></span></button>{showAccount && <div className="account-popover"><span>ACCOUNT</span>{viewer ? <><div className={`role-badge ${viewer.role}`}>{viewer.role === "superadmin" ? "★ 超级管理员" : "普通用户"}</div><b>{viewer.displayName}</b><small>{viewer.email}</small><div><em>{customStrategies.length}</em> 个自定义策略</div>{viewer.role === "superadmin" && <button onClick={() => { setShowUserManagement(true); setShowAccount(false); }}>用户管理</button>}<button onClick={() => { setShowPaperAccounts(true); setShowAccount(false); }}>我的模拟盘</button><button onClick={() => { setTaskTarget(null); setShowAutomation(true); setShowAccount(false); }}>定时任务</button><button onClick={() => { setShowNotifications(true); setShowAccount(false); }}>通知配置</button><button onClick={() => { setStudioMode("settings"); setShowAccount(false); }}>AI 接口配置</button><button onClick={handleLogout}>退出登录</button></> : <small>请使用管理员分配的账户登录</small>}</div>}</div></div>
      </header>

      <div className="workspace">
        <aside className="watch-panel panel">
          <div className="panel-heading"><div><span className="eyebrow">WATCHLIST</span><h2>自选股 <small>{watchlist.length}</small></h2></div><button className="add-button" onClick={() => setShowSearch((value) => !value)} aria-expanded={showSearch}>＋</button></div>
          {showSearch && <div className="stock-search"><label htmlFor="stock-search">联网搜索 A 股</label><div className="search-input-wrap"><input id="stock-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="输入股票代码或名称" /><i className={searchStatus === "loading" ? "search-spinner" : "search-cloud"}>{searchStatus === "loading" ? "" : "⌁"}</i></div><div className="search-results">{searchResults.map((stock) => <button key={stock.symbol} onClick={() => addStock(stock)}><span>{stock.name}<small>{stock.symbol}</small></span><b>＋</b></button>)}{searchStatus === "idle" && <p>输入关键词后通过 TickFlow 联网查询</p>}{searchStatus === "loading" && <p>正在联网搜索…</p>}{searchStatus === "ready" && searchResults.length === 0 && <p>没有找到匹配的 A 股</p>}{searchStatus === "error" && <p className="search-error">联网搜索暂时不可用，请重试</p>}</div></div>}
          <div className="watch-list">{watchlist.map((stock) => <button key={stock.code} className={`watch-row ${selectedStock === stock.code ? "active" : ""}`} onClick={() => setSelectedStock(stock.code)}><span className="stock-identity"><b>{stock.name}</b><small>{toSymbol(stock.code)}</small></span><span className="stock-quote"><b>{stock.price ? stock.price.toFixed(2) : "—"}</b><small className={stock.change >= 0 ? "up" : "down"}>{stock.price ? `${stock.change >= 0 ? "+" : ""}${stock.change.toFixed(2)}%` : "读取中"}</small></span><span className={`signal signal-${stock.signal}`}>{stock.signal}</span><span className="remove-stock" role="button" tabIndex={0} aria-label={`移除${stock.name}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); removeStock(stock.code); } }} onClick={(event) => { event.stopPropagation(); removeStock(stock.code); }}>×</span></button>)}</div>
          <div className="watch-footer"><div><span>自选股行情</span><b>{realtimeStatus === "live" ? "TickFlow 实时" : "TickFlow 日K"}</b></div><div><span>轮询状态</span><b className={realtimeStatus === "live" ? "realtime-ready" : ""}>{realtimeDetail}</b></div><button onClick={() => setRefreshTick((value) => value + 1)}>↻ 同步完整历史 · {historyStatus === "loading" ? "读取中" : `${allBars.length || "—"} 根`}</button></div>
        </aside>

        <section className="main-column">
          <section className="hero panel"><div className="hero-copy"><div className="eyebrow"><i className="pulse-dot" /> REAL DATA BACKTEST</div><h1>真实日K策略驾驶舱</h1><p>多个策略可同时参与回测；任一策略产生信号即可执行买入或卖出。</p></div><div className="hero-meta"><div><span>当前策略组合</span><b>{selectedStrategies.map((strategy) => strategy.name).join("、")}</b></div><div><span>历史数据</span><b className={historyStatus === "ready" ? "active-status" : ""}>{historyStatus === "ready" ? `● ${allBars.length} 根` : historyStatus === "loading" ? "◌ 全量读取中" : "× 已回退"}</b></div><div><span>组合规则</span><b>任一触发 · 日线</b></div></div></section>

          <section className="metrics-grid" aria-label="真实日K回测绩效">
            <Metric label="回测总资产" value={backtest.equityValues.length ? `¥ ${Math.round(backtest.finalEquity).toLocaleString("zh-CN")}` : "—"} />
            <Metric label="累计收益" value={backtest.equityValues.length ? formatPercent(backtest.totalReturn) : "—"} tone={backtest.totalReturn >= 0 ? "up" : "down"} />
            <Metric label="最大回撤" value={backtest.equityValues.length ? formatPercent(backtest.maxDrawdown, false) : "—"} tone="down" />
            <Metric label="夏普比率" value={backtest.equityValues.length ? backtest.sharpe.toFixed(2) : "—"} />
          </section>

          <section className="chart-panel panel">
            <div className="chart-header"><div><span className="eyebrow">TICKFLOW DAILY KLINE</span><h2>{selectedItem?.name ?? "建设银行"}日K蜡烛图</h2></div><div className="legend"><span className="candle-up" />上涨 <span className="candle-down" />下跌 <span className="trade-legend"><i className="legend-buy" />买入</span><span className="trade-legend"><i className="legend-sell" />卖出</span></div><div className="periods" role="group" aria-label="回测时间范围">{["近1月", "近3月", "近6月", "今年", "全部"].map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
            <div className="chart-canvas"><EquityChart key={`${selectedSymbol}-${period}-${periodBars.length}`} result={backtest} bars={periodBars} /></div>
            <div className="chart-summary"><div><span>回测本金</span><b>¥ {initialCapital.toLocaleString("zh-CN")}</b></div><div><span>年化收益</span><b className={backtest.annualReturn >= 0 ? "up" : "down"}>{backtest.equityValues.length ? formatPercent(backtest.annualReturn) : "—"}</b></div><div><span>胜率</span><b>{backtest.equityValues.length ? formatPercent(backtest.winRate, false) : "—"}</b></div><div><span>真实日K交易</span><b>{backtest.trades.length} 笔</b></div></div>
          </section>

          <section className="positions panel"><div className="table-header"><div><span className="eyebrow">BACKTEST POSITION</span><h2>回测持仓 <small>{backtest.position ? 1 : 0} / 1</small></h2></div><button onClick={() => setToast("这里展示当前参数的临时回测；长期模拟持仓请进入模拟盘")}>计算说明 ↗</button></div><div className="table-scroll"><table><thead><tr><th>标的</th><th>持仓</th><th>成本价</th><th>最新收盘</th><th>浮动盈亏</th><th>收益率</th></tr></thead><tbody>{backtest.position ? <tr><td><b>{selectedItem?.name}</b><small>{selectedSymbol}</small></td><td>{backtest.position.shares.toLocaleString("zh-CN")} 股</td><td>{backtest.position.cost.toFixed(2)}</td><td>{backtest.position.price.toFixed(2)}</td><td className={backtest.position.pnl >= 0 ? "up" : "down"}>{backtest.position.pnl >= 0 ? "+" : ""}{backtest.position.pnl.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</td><td className={backtest.position.rate >= 0 ? "up" : "down"}>{formatPercent(backtest.position.rate)}</td></tr> : <tr><td className="empty-position" colSpan={6}>当前策略在最新日K收盘后为空仓</td></tr>}</tbody></table></div></section>
        </section>

        <aside className="control-column">
          <section className="strategy-panel panel">
            <div className="panel-heading compact"><div><span className="eyebrow">STRATEGY</span><h2>策略引擎 <small>{allStrategies.length}</small></h2></div><div className="strategy-tools"><button onClick={() => setStudioMode("docs")}>文档</button><button className="ai-tool" onClick={() => setStudioMode("ai")}>✦ AI</button><button className="new-tool" onClick={() => setStudioMode("manual")} aria-label="新建策略">＋</button></div></div>
            <div className="strategy-tabs" role="tablist" aria-label="策略周期分类">{strategyGroups.map((group) => <button key={group.id} role="tab" aria-selected={strategyTab === group.id} className={strategyTab === group.id ? "active" : ""} onClick={() => setStrategyTab(group.id)}><span>{group.label}</span><em>{group.items.length}</em></button>)}</div>
            <div className="strategy-list" role="tabpanel" aria-label={activeStrategyGroup.label}><section className="strategy-group"><header><b>{activeStrategyGroup.label}</b><span>{activeStrategyGroup.note} · 已选 {selectedStrategies.length}/8</span></header>{activeStrategyGroup.items.map((strategy) => { const selected = selectedStrategyIds.includes(strategy.id); return <button key={strategy.id} aria-pressed={selected} className={`strategy-card ${selected ? "active" : ""}`} onClick={() => toggleBacktestStrategy(strategy)} style={{ "--strategy-color": strategy.color } as CSSProperties}><span className="strategy-radio"><i>{selected ? "✓" : ""}</i></span><span><b>{strategy.name}{!strategy.builtin && <sup>我的</sup>}</b><small>{strategy.summary}</small></span><em>{strategy.tag}</em></button>; })}{!activeStrategyGroup.items.length && <div className="strategy-empty"><b>还没有自定义策略</b><span>点击右上角 ＋ 手动创建，或使用 AI 生成。</span></div>}</section></div>
            <div className="capital-config"><div className="section-label"><b>临时回测资金</b><span>不会保存为模拟盘</span></div><label htmlFor="initial-capital">回测本金</label><div className="capital-input"><i>¥</i><input id="initial-capital" type="text" value={capitalInput} onChange={(event) => editCapital(event.target.value)} onBlur={commitCapital} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} aria-describedby="capital-hint" /></div><small id="capital-hint" className="capital-hint">可输入 20000、2w 或 2万，按回车应用</small><div className="capital-presets">{[20_000, 100_000, 500_000, 1_000_000].map((amount) => <button key={amount} className={initialCapital === amount ? "active" : ""} onClick={() => { setInitialCapital(amount); setCapitalInput(String(amount)); }}>{amount / 10_000}万</button>)}</div></div>
            <div className="parameters"><div className="section-label"><b>执行参数</b><button onClick={() => { setPosition(30); setStopLoss(8); setTakeProfit(22); }}>恢复默认</button></div><label><span>单票仓位 <b>{position}%</b></span><input type="range" min="10" max="100" step="5" value={position} onChange={(event) => setPosition(Number(event.target.value))} /></label><div className="parameter-pair"><label><span>止损线</span><div><input type="number" min="1" max="20" value={stopLoss} onChange={(event) => setStopLoss(Number(event.target.value))} /><i>%</i></div></label><label><span>止盈线</span><div><input type="number" min="5" max="50" value={takeProfit} onChange={(event) => setTakeProfit(Number(event.target.value))} /><i>%</i></div></label></div><button className={`toggle-row ${autoRebalance ? "on" : ""}`} onClick={() => setAutoRebalance((value) => !value)} aria-pressed={autoRebalance}><span><b>收盘后自动调仓</b><small>新日K到达后检查信号</small></span><i><em /></i></button></div>
            <div className="execution-flow"><div className="section-label"><b>数据与执行流程</b><span>{dataStatus === "ready" ? "4 / 4 就绪" : "同步中"}</span></div><ol><li className={dataStatus === "ready" ? "done" : "ready"}><i>{dataStatus === "ready" ? "✓" : "1"}</i><span><b>读取 TickFlow 日K</b><small>{allBars.length || "—"} 根 · 前复权 · 真实历史数据</small></span></li><li className={dataStatus === "ready" ? "done" : "ready"}><i>{dataStatus === "ready" ? "✓" : "2"}</i><span><b>计算组合信号</b><small>{selectedStrategies.length} 个策略 · 任一触发</small></span></li><li className={dataStatus === "ready" ? "done" : "ready"}><i>{dataStatus === "ready" ? "✓" : "3"}</i><span><b>风控检查</b><small>仓位 / 止损 / 止盈</small></span></li><li className="ready"><i>4</i><span><b>虚拟撮合</b><small>佣金 0.025% · 滑点 0.1%</small></span></li></ol></div>
            <button className={`run-button ${running ? "running" : ""}`} onClick={runSimulation} disabled={running || dataStatus === "error"}><span>{running ? `正在计算真实日K ${progress}%` : "▶ 同步并运行回测"}</span><i style={{ width: `${progress}%` }} /></button><p className="run-note">已运行 {runCount} 次 · TickFlow 免费版非实时 · 不会产生真实交易</p>
          </section>

          <section className="activity-panel panel"><div className="panel-heading compact"><div><span className="eyebrow">REAL KLINE ACTIVITY</span><h2>策略成交日志</h2></div><i className={dataStatus === "ready" ? "live-dot" : "demo-dot"} /></div><div className="activity-list">{recentTrades.length ? recentTrades.map((trade) => <div className="activity-item" key={`${trade.index}-${trade.action}`}><time>{trade.date}</time><span className={trade.action === "buy" ? "buy" : "sell"}>{trade.action === "buy" ? "买入" : "卖出"}</span><p><b>{selectedItem?.name}</b><small>{trade.price.toFixed(2)} × {trade.shares.toLocaleString("zh-CN")}</small><em>{trade.reason}</em></p></div>) : <p className="activity-empty">当前区间内没有产生策略成交</p>}</div><button className="text-button" onClick={() => setToast(`当前区间共 ${backtest.trades.length} 笔真实日K模拟成交`)}>查看计算结果 →</button></section>
        </aside>
      </div>
      <nav className="mobile-nav" aria-label="手机端主导航">
        <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><i>⌂</i><span>首页</span></button>
        <button className={showPaperAccounts ? "active" : ""} onClick={() => setShowPaperAccounts(true)}><i>◎</i><span>模拟盘</span></button>
        <button className={studioMode ? "active" : ""} onClick={() => setStudioMode("manual")}><i>∑</i><span>策略</span></button>
        <button className={showAutomation ? "active" : ""} onClick={() => { setTaskTarget(null); setShowAutomation(true); }}><i>◴</i><span>任务</span></button>
        <button className={showNotifications ? "active" : ""} onClick={() => setShowNotifications(true)}><i>⌁</i><span>通知</span></button>
        <button className={showAccount ? "active" : ""} onClick={() => setShowAccount((value) => !value)}><i>{viewerInitials}</i><span>我的</span></button>
      </nav>
      <StrategyStudio mode={studioMode} strategies={allStrategies} aiSettings={aiSettings} onAiSettingsChange={setAiSettings} onCreated={handleStrategyCreated} onDeleted={handleStrategyDeleted} onClose={() => setStudioMode(null)} />
      <PaperAccountCenter open={showPaperAccounts} watchlist={watchlist} strategies={allStrategies} onClose={() => setShowPaperAccounts(false)} onToast={setToast} onConfigureTask={(target) => { setShowPaperAccounts(false); setTaskTarget(target); setShowAutomation(true); }} />
      <TaskCenter open={showAutomation} watchlist={watchlist} strategies={allStrategies} defaultStopLoss={stopLoss} defaultTakeProfit={takeProfit} targetAccount={taskTarget} onClose={() => { setShowAutomation(false); setTaskTarget(null); }} onToast={setToast} onOpenNotifications={() => { setShowAutomation(false); setShowNotifications(true); }} onTaskChanged={() => setRealtimeConfigTick((value) => value + 1)} />
      <NotificationCenter open={showNotifications} onClose={() => { setShowNotifications(false); if (taskTarget) setShowAutomation(true); }} onToast={setToast} />
      <UserManagement open={showUserManagement && viewer?.role === "superadmin"} onClose={() => setShowUserManagement(false)} onToast={setToast} />
      {authStatus === "ready" && !viewer && <AuthGate adminReady={adminReady} onAuthenticated={handleAuthenticated} />}
      {toast && <div className="toast" role="status"><i>✓</i>{toast}</div>}
    </main>
  );
}
