"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { AuthGate } from "./auth-gate";
import { StrategyStudio, type StudioMode } from "./strategy-studio";
import { strategyRuleSummary, type IndicatorKey, type SavedStrategy, type StrategyRule } from "./strategy-model";

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
};

type Viewer = { userId: string; displayName: string; email: string; role: "user" | "superadmin" };

type StockSearchResult = {
  symbol: string;
  code: string;
  name: string;
  exchange: string;
};

function parseCapitalInput(rawValue: string) {
  const normalized = rawValue.trim().replace(/[\s,，]/g, "").toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)(w|万)?$/);
  if (!match) return null;

  const amount = Number(match[1]) * (match[2] ? 10_000 : 1);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount);
}

type Kline = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
};

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
  { id: "breakout", name: "趋势突破", description: "收盘价突破前20日高点且成交量确认时入场，跌破MA10时离场。", summary: "20 日新高 + 成交量确认", tag: "进取", color: "#ff5b6e", builtin: true, entryLogic: "and", exitLogic: "or", entryRules: [{ left: "close", operator: "gt", rightType: "indicator", rightIndicator: "highest20" }, { left: "volumeRatio20", operator: "gt", rightType: "value", rightValue: 1.1 }], exitRules: [{ left: "close", operator: "lt", rightType: "indicator", rightIndicator: "ma10" }] },
  { id: "ma", name: "均线动量", description: "MA5向上穿越MA20时买入，向下穿越时卖出。", summary: "MA5 / MA20 金叉与死叉", tag: "均衡", color: "#4c8dff", builtin: true, entryLogic: "and", exitLogic: "or", entryRules: [{ left: "ma5", operator: "crossesAbove", rightType: "indicator", rightIndicator: "ma20" }], exitRules: [{ left: "ma5", operator: "crossesBelow", rightType: "indicator", rightIndicator: "ma20" }] },
  { id: "lowvol", name: "低波趋势", description: "20日波动率低于1.8%且价格站上MA20时买入，趋势转弱或波动放大时离场。", summary: "低波动率 + 站上 MA20", tag: "稳健", color: "#37d6aa", builtin: true, entryLogic: "and", exitLogic: "or", entryRules: [{ left: "volatility20", operator: "lt", rightType: "value", rightValue: 1.8 }, { left: "close", operator: "gt", rightType: "indicator", rightIndicator: "ma20" }], exitRules: [{ left: "close", operator: "lt", rightType: "indicator", rightIndicator: "ma20" }, { left: "volatility20", operator: "gt", rightType: "value", rightValue: 3 }] },
  { id: "rsi", name: "RSI 逆转", description: "RSI进入超卖区并出现阳线时尝试反弹交易，RSI修复至62以上时止盈。", summary: "超卖反弹 + RSI 离场", tag: "短线", color: "#b38cff", builtin: true, entryLogic: "and", exitLogic: "or", entryRules: [{ left: "rsi14", operator: "lt", rightType: "value", rightValue: 32 }, { left: "close", operator: "gt", rightType: "indicator", rightIndicator: "open" }], exitRules: [{ left: "rsi14", operator: "gt", rightType: "value", rightValue: 62 }] },
];

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" });
const fullDateFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });

function toSymbol(code: string) {
  if (code.startsWith("6")) return `${code}.SH`;
  if (code.startsWith("0") || code.startsWith("3")) return `${code}.SZ`;
  return `${code}.BJ`;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function movingAverage(bars: Kline[], index: number, length: number) {
  if (index + 1 < length) return null;
  return average(bars.slice(index - length + 1, index + 1).map((bar) => bar.close));
}

function calculateRsi(bars: Kline[], index: number, length = 14) {
  if (index < length) return null;
  let gains = 0;
  let losses = 0;
  for (let i = index - length + 1; i <= index; i += 1) {
    const change = bars[i].close - bars[i - 1].close;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function indicatorValue(key: IndicatorKey, bars: Kline[], index: number) {
  const bar = bars[index];
  if (!bar) return 0;
  if (key === "close" || key === "open") return bar[key];
  if (key === "ma5") return movingAverage(bars, index, 5) ?? bar.close;
  if (key === "ma10") return movingAverage(bars, index, 10) ?? bar.close;
  if (key === "ma20") return movingAverage(bars, index, 20) ?? bar.close;
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

function signalFor(strategy: Strategy, bars: Kline[], index: number, side: "buy" | "sell") {
  if (index < 21) return { active: false, reason: "等待足够日K" };
  const rules = side === "buy" ? strategy.entryRules : strategy.exitRules;
  const logic = side === "buy" ? strategy.entryLogic : strategy.exitLogic;
  const results = rules.map((rule) => ruleMatches(rule, bars, index));
  const active = logic === "and" ? results.every(Boolean) : results.some(Boolean);
  return { active, reason: strategyRuleSummary(rules, logic) };
}

function runBacktest(bars: Kline[], strategy: Strategy, initialCapital: number, positionPercent: number, stopLoss: number, takeProfit: number): BacktestResult {
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
      const buySignal = signalFor(strategy, bars, index, "buy");
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
      const strategySell = signalFor(strategy, bars, index, "sell");
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

function EquityChart({ result, bars }: { result: BacktestResult; bars: Kline[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, rect.width * dpr);
      canvas.height = Math.max(1, rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const width = rect.width;
      const height = rect.height;
      ctx.clearRect(0, 0, width, height);

      if (!result.equityPercent.length || !bars.length) {
        ctx.fillStyle = "#728098";
        ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.fillText("正在读取 TickFlow 真实历史日K…", width / 2, height / 2);
        return;
      }

      const pad = { top: 30, right: 20, bottom: 30, left: 48 };
      const chartW = width - pad.left - pad.right;
      const chartH = height - pad.top - pad.bottom;
      const priceValues = bars.map((bar) => bar.close);
      const ma20Values = bars.map((bar, index) => average(bars.slice(Math.max(0, index - 19), index + 1).map((item) => item.close)));
      const allValues = [...priceValues, ...ma20Values];
      const rawMin = Math.min(...allValues);
      const rawMax = Math.max(...allValues);
      const spread = Math.max(rawMax * .02, rawMax - rawMin);
      const min = rawMin - spread * 0.1;
      const max = rawMax + spread * 0.1;
      const point = (value: number, index: number) => ({
        x: pad.left + index / Math.max(1, priceValues.length - 1) * chartW,
        y: pad.top + (1 - (value - min) / (max - min)) * chartH,
      });

      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      for (let i = 0; i <= 4; i += 1) {
        const y = pad.top + chartH / 4 * i;
        const value = max - (max - min) / 4 * i;
        ctx.strokeStyle = "rgba(126, 143, 172, .12)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
        ctx.fillStyle = "#62708a";
        ctx.textAlign = "right";
        ctx.fillText(value.toFixed(2), pad.left - 8, y + 3);
      }
      ctx.fillStyle = "#7b899f";
      ctx.textAlign = "left";
      ctx.fillText("元", 8, pad.top - 10);

      for (let i = 0; i <= 6; i += 1) {
        const x = pad.left + chartW / 6 * i;
        ctx.strokeStyle = "rgba(126, 143, 172, .09)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, height - pad.bottom); ctx.stroke();
      }

      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(247, 203, 75, .82)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ma20Values.forEach((value, index) => {
        const p = point(value, index);
        index === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
      gradient.addColorStop(0, "rgba(131, 196, 255, .24)");
      gradient.addColorStop(.7, "rgba(73, 137, 211, .06)");
      gradient.addColorStop(1, "rgba(73, 137, 211, 0)");
      ctx.beginPath();
      priceValues.forEach((value, index) => {
        const p = point(value, index);
        index === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      ctx.lineTo(width - pad.right, height - pad.bottom);
      ctx.lineTo(pad.left, height - pad.bottom);
      ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();

      ctx.save();
      ctx.strokeStyle = "#f4f8ff";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(142, 202, 255, .72)";
      ctx.shadowBlur = 9;
      ctx.beginPath();
      priceValues.forEach((value, index) => {
        const p = point(value, index);
        index === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.restore();

      const finalPoint = point(priceValues.at(-1) ?? 0, priceValues.length - 1);
      ctx.beginPath(); ctx.arc(finalPoint.x, finalPoint.y, 4, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.beginPath(); ctx.arc(finalPoint.x, finalPoint.y, 7, 0, Math.PI * 2); ctx.strokeStyle = "rgba(142, 202, 255, .5)"; ctx.lineWidth = 3; ctx.stroke();

      result.trades.forEach((trade) => {
        const p = point(bars[trade.index]?.close ?? trade.price, trade.index);
        const isBuy = trade.action === "buy";
        const color = isBuy ? "#ff5b6e" : "#37d6aa";
        const iconY = Math.max(pad.top + 10, Math.min(height - pad.bottom - 10, p.y + (isBuy ? 20 : -20)));
        ctx.strokeStyle = `${color}95`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, iconY); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x, iconY, 8.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        ctx.beginPath();
        if (isBuy) {
          ctx.moveTo(p.x, iconY - 4.2); ctx.lineTo(p.x - 4, iconY + 2.8); ctx.lineTo(p.x + 4, iconY + 2.8);
        } else {
          ctx.moveTo(p.x, iconY + 4.2); ctx.lineTo(p.x - 4, iconY - 2.8); ctx.lineTo(p.x + 4, iconY - 2.8);
        }
        ctx.closePath(); ctx.fillStyle = "#071018"; ctx.fill();
      });

      const labelIndexes = [0, .25, .5, .75, 1].map((ratio) => Math.round((bars.length - 1) * ratio));
      ctx.fillStyle = "#62708a"; ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace"; ctx.textAlign = "center";
      labelIndexes.forEach((index) => ctx.fillText(dateFormatter.format(bars[index].timestamp), point(priceValues[index], index).x, height - 8));
    };

    draw();
    const observer = new ResizeObserver(draw);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, [result, bars]);

  return <canvas ref={ref} aria-label="真实历史日K收盘价与MA20均线" />;
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
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy>(builtinStrategies[0]);
  const [customStrategies, setCustomStrategies] = useState<Strategy[]>([]);
  const [studioMode, setStudioMode] = useState<StudioMode>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [authStatus, setAuthStatus] = useState<"loading" | "ready">("loading");
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
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
  const [dataStatus, setDataStatus] = useState<"loading" | "ready" | "error">("loading");
  const [refreshTick, setRefreshTick] = useState(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(100);
  const [runCount, setRunCount] = useState(12);
  const [toast, setToast] = useState("");
  const allStrategies = useMemo(() => [...builtinStrategies, ...customStrategies], [customStrategies]);

  useEffect(() => {
    const stored = window.localStorage.getItem("paper-alpha-watchlist-v2");
    if (stored) {
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
      setCustomStrategies(strategyPayload.strategies.map((strategy) => ({ ...strategy, summary: strategyRuleSummary(strategy.entryRules, strategy.entryLogic), color: "#f4c95d", builtin: false })));
    }
    if (settingsResponse.ok) {
      const settingsPayload = await settingsResponse.json() as { settings: { aiBaseUrl: string; aiModel: string } };
      setAiSettings((current) => ({ ...current, baseUrl: settingsPayload.settings.aiBaseUrl, model: settingsPayload.settings.aiModel }));
    }
  };

  useEffect(() => {
    let active = true;
    fetch("/api/user")
      .then((response) => response.json() as Promise<{ user: Viewer | null; needsBootstrap: boolean }>)
      .then(async (payload) => {
        if (!active) return;
        setViewer(payload.user); setNeedsBootstrap(payload.needsBootstrap); setAuthStatus("ready");
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
    if (!watchlistCodes) { setSeries({}); setDataStatus("ready"); return; }
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
          return {
            ...item,
            price: latest.close,
            change: (latest.close / previous.close - 1) * 100,
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
            setToast(`${selectedStrategy.name}已基于真实日K重新计算`);
          }, 160);
        }
        return next;
      });
    }, 80);
    return () => window.clearInterval(timer);
  }, [running, selectedStrategy.name]);

  useEffect(() => {
    const query = search.trim();
    if (!showSearch || !query) {
      setSearchResults([]);
      setSearchStatus("idle");
      return;
    }

    const controller = new AbortController();
    setSearchStatus("loading");
    const timer = window.setTimeout(() => {
      fetch(`/api/tickflow/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("search failed");
          return response.json() as Promise<{ results: StockSearchResult[] }>;
        })
        .then((payload) => {
          setSearchResults(payload.results.filter((item) => !watchlist.some((watch) => watch.code === item.code)));
          setSearchStatus("ready");
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setSearchResults([]);
          setSearchStatus("error");
        });
    }, 320);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search, showSearch, watchlist]);

  const selectedSymbol = toSymbol(selectedStock || "601939");
  const allBars = series[selectedSymbol] ?? [];
  const periodBars = useMemo(() => {
    if (!allBars.length) return [];
    const sizes: Record<string, number> = { "近1月": 42, "近3月": 84, "近6月": 150, "今年": 240 };
    return allBars.slice(-Math.min(allBars.length, sizes[period] ?? 150));
  }, [allBars, period]);
  const backtest = useMemo(() => runBacktest(periodBars, selectedStrategy, initialCapital, position, stopLoss, takeProfit), [periodBars, selectedStrategy, initialCapital, position, stopLoss, takeProfit]);
  const selectedItem = watchlist.find((item) => item.code === selectedStock) ?? watchlist[0];
  const latestBar = allBars.at(-1);
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

  const handleStrategyCreated = (saved: SavedStrategy) => {
    const strategy: Strategy = { ...saved, summary: strategyRuleSummary(saved.entryRules, saved.entryLogic), color: "#f4c95d", builtin: false };
    setCustomStrategies((items) => [strategy, ...items]);
    setSelectedStrategy(strategy);
    setStudioMode(null);
    setToast(`${strategy.name}已保存并开始回测`);
  };

  const handleStrategyDeleted = async (id: string) => {
    const target = customStrategies.find((strategy) => strategy.id === id);
    if (!target || !window.confirm(`确认删除策略“${target.name}”？`)) return;
    const response = await fetch("/api/strategies", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!response.ok) { setToast("策略删除失败，请重试"); return; }
    setCustomStrategies((items) => items.filter((strategy) => strategy.id !== id));
    if (selectedStrategy.id === id) setSelectedStrategy(builtinStrategies[0]);
    setToast(`${target.name}已删除`);
  };

  const handleAuthenticated = (user: Viewer) => {
    setViewer(user); setNeedsBootstrap(false); setAuthStatus("ready"); setToast(user.role === "superadmin" ? "超级管理员创建成功" : `欢迎，${user.displayName}`);
    void loadAccountData();
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setViewer(null); setCustomStrategies([]); setSelectedStrategy(builtinStrategies[0]); setShowAccount(false);
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
          <span><i className={dataStatus === "error" ? "error-dot" : "live-dot"} /> TickFlow 真实历史日K</span>
          <b>{selectedItem?.name ?? "建设银行"} <em className={(selectedItem?.change ?? 0) >= 0 ? "up" : "down"}>{selectedItem?.price ? selectedItem.price.toFixed(2) : "—"}</em></b>
          <b>数据日期 <em>{latestBar ? fullDateFormatter.format(latestBar.timestamp) : "同步中"}</em></b>
          <b><em>前复权 · 非实时</em></b>
        </div>
        <div className="top-actions"><span className="trade-day">免费数据 · 收盘后更新</span><button className="icon-button" aria-label="AI接口配置" onClick={() => setStudioMode("settings")}>⌁<span>AI</span></button><div className="account-wrap"><button className="account-button" onClick={() => setShowAccount((value) => !value)} aria-expanded={showAccount}><i>{viewerInitials}</i><span>{viewer ? viewer.displayName : authStatus === "loading" ? "确认登录中" : "未登录"}<br /><small>{viewer ? viewer.role === "superadmin" ? "超级管理员" : "个人策略账户" : "登录后保存策略"}</small></span></button>{showAccount && <div className="account-popover"><span>ACCOUNT</span>{viewer ? <><div className={`role-badge ${viewer.role}`}>{viewer.role === "superadmin" ? "★ 超级管理员" : "普通用户"}</div><b>{viewer.displayName}</b><small>{viewer.email}</small><div><em>{customStrategies.length}</em> 个自定义策略</div><button onClick={() => { setStudioMode("settings"); setShowAccount(false); }}>AI 接口配置</button><button onClick={handleLogout}>退出登录</button></> : <small>请在登录窗口中进入账户</small>}</div>}</div></div>
      </header>

      <div className="workspace">
        <aside className="watch-panel panel">
          <div className="panel-heading"><div><span className="eyebrow">WATCHLIST</span><h2>自选股 <small>{watchlist.length}</small></h2></div><button className="add-button" onClick={() => setShowSearch((value) => !value)} aria-expanded={showSearch}>＋</button></div>
          {showSearch && <div className="stock-search"><label htmlFor="stock-search">联网搜索 A 股</label><div className="search-input-wrap"><input id="stock-search" autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="输入股票代码或名称" /><i className={searchStatus === "loading" ? "search-spinner" : "search-cloud"}>{searchStatus === "loading" ? "" : "⌁"}</i></div><div className="search-results">{searchResults.map((stock) => <button key={stock.symbol} onClick={() => addStock(stock)}><span>{stock.name}<small>{stock.symbol}</small></span><b>＋</b></button>)}{searchStatus === "idle" && <p>输入关键词后通过 TickFlow 联网查询</p>}{searchStatus === "loading" && <p>正在联网搜索…</p>}{searchStatus === "ready" && searchResults.length === 0 && <p>没有找到匹配的 A 股</p>}{searchStatus === "error" && <p className="search-error">联网搜索暂时不可用，请重试</p>}</div></div>}
          <div className="watch-list">{watchlist.map((stock) => <button key={stock.code} className={`watch-row ${selectedStock === stock.code ? "active" : ""}`} onClick={() => setSelectedStock(stock.code)}><span className="stock-identity"><b>{stock.name}</b><small>{toSymbol(stock.code)}</small></span><span className="stock-quote"><b>{stock.price ? stock.price.toFixed(2) : "—"}</b><small className={stock.change >= 0 ? "up" : "down"}>{stock.price ? `${stock.change >= 0 ? "+" : ""}${stock.change.toFixed(2)}%` : "读取中"}</small></span><span className={`signal signal-${stock.signal}`}>{stock.signal}</span><span className="remove-stock" role="button" aria-label={`移除${stock.name}`} onClick={(event) => { event.stopPropagation(); removeStock(stock.code); }}>×</span></button>)}</div>
          <div className="watch-footer"><div><span>数据源</span><b>TickFlow</b></div><div><span>历史日K</span><b>{allBars.length || "—"} 根</b></div><button onClick={() => setRefreshTick((value) => value + 1)}>↻ 同步最新日K</button></div>
        </aside>

        <section className="main-column">
          <section className="hero panel"><div className="hero-copy"><div className="eyebrow"><i className="pulse-dot" /> REAL DATA BACKTEST</div><h1>真实日K策略驾驶舱</h1><p>使用 TickFlow 免费历史日线计算策略信号、虚拟成交与资金曲线。</p></div><div className="hero-meta"><div><span>当前策略</span><b>{selectedStrategy.name}</b></div><div><span>数据状态</span><b className={dataStatus === "ready" ? "active-status" : ""}>{dataStatus === "ready" ? "● 已同步" : dataStatus === "loading" ? "◌ 同步中" : "× 异常"}</b></div><div><span>计算频率</span><b>日线 · 收盘后</b></div></div></section>

          <section className="metrics-grid" aria-label="真实日K回测绩效">
            <Metric label="模拟总资产" value={backtest.equityValues.length ? `¥ ${Math.round(backtest.finalEquity).toLocaleString("zh-CN")}` : "—"} />
            <Metric label="累计收益" value={backtest.equityValues.length ? formatPercent(backtest.totalReturn) : "—"} tone={backtest.totalReturn >= 0 ? "up" : "down"} />
            <Metric label="最大回撤" value={backtest.equityValues.length ? formatPercent(backtest.maxDrawdown, false) : "—"} tone="down" />
            <Metric label="夏普比率" value={backtest.equityValues.length ? backtest.sharpe.toFixed(2) : "—"} />
          </section>

          <section className="chart-panel panel">
            <div className="chart-header"><div><span className="eyebrow">TICKFLOW DAILY PRICE</span><h2>{selectedItem?.name ?? "建设银行"}日K收盘价</h2></div><div className="legend"><span className="strategy-line" />收盘价 <span className="benchmark-line" />MA20 <span className="trade-legend"><i className="legend-buy" />买入</span><span className="trade-legend"><i className="legend-sell" />卖出</span></div><div className="periods" role="group" aria-label="回测时间范围">{["近1月", "近3月", "近6月", "今年"].map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
            <div className="chart-canvas"><EquityChart result={backtest} bars={periodBars} /></div>
            <div className="chart-summary"><div><span>模拟本金</span><b>¥ {initialCapital.toLocaleString("zh-CN")}</b></div><div><span>年化收益</span><b className={backtest.annualReturn >= 0 ? "up" : "down"}>{backtest.equityValues.length ? formatPercent(backtest.annualReturn) : "—"}</b></div><div><span>胜率</span><b>{backtest.equityValues.length ? formatPercent(backtest.winRate, false) : "—"}</b></div><div><span>真实日K交易</span><b>{backtest.trades.length} 笔</b></div></div>
          </section>

          <section className="positions panel"><div className="table-header"><div><span className="eyebrow">PORTFOLIO</span><h2>当前持仓 <small>{backtest.position ? 1 : 0} / 5</small></h2></div><button onClick={() => setToast("持仓数据已按当前策略计算")}>计算说明 ↗</button></div><div className="table-scroll"><table><thead><tr><th>标的</th><th>持仓</th><th>成本价</th><th>最新收盘</th><th>浮动盈亏</th><th>收益率</th></tr></thead><tbody>{backtest.position ? <tr><td><b>{selectedItem?.name}</b><small>{selectedSymbol}</small></td><td>{backtest.position.shares.toLocaleString("zh-CN")} 股</td><td>{backtest.position.cost.toFixed(2)}</td><td>{backtest.position.price.toFixed(2)}</td><td className={backtest.position.pnl >= 0 ? "up" : "down"}>{backtest.position.pnl >= 0 ? "+" : ""}{backtest.position.pnl.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</td><td className={backtest.position.rate >= 0 ? "up" : "down"}>{formatPercent(backtest.position.rate)}</td></tr> : <tr><td className="empty-position" colSpan={6}>当前策略在最新日K收盘后为空仓</td></tr>}</tbody></table></div></section>
        </section>

        <aside className="control-column">
          <section className="strategy-panel panel">
            <div className="panel-heading compact"><div><span className="eyebrow">STRATEGY</span><h2>策略引擎 <small>{allStrategies.length}</small></h2></div><div className="strategy-tools"><button onClick={() => setStudioMode("docs")}>文档</button><button className="ai-tool" onClick={() => setStudioMode("ai")}>✦ AI</button><button className="new-tool" onClick={() => setStudioMode("manual")} aria-label="新建策略">＋</button></div></div>
            <div className="strategy-list">{allStrategies.map((strategy) => <button key={strategy.id} className={`strategy-card ${selectedStrategy.id === strategy.id ? "active" : ""}`} onClick={() => setSelectedStrategy(strategy)} style={{ "--strategy-color": strategy.color } as CSSProperties}><span className="strategy-radio"><i /></span><span><b>{strategy.name}{!strategy.builtin && <sup>我的</sup>}</b><small>{strategy.summary}</small></span><em>{strategy.tag}</em></button>)}</div>
            <div className="capital-config"><div className="section-label"><b>模拟账户资金</b><span>支持自定义金额</span></div><label htmlFor="initial-capital">初始本金</label><div className="capital-input"><i>¥</i><input id="initial-capital" type="text" value={capitalInput} onChange={(event) => editCapital(event.target.value)} onBlur={commitCapital} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} aria-describedby="capital-hint" /></div><small id="capital-hint" className="capital-hint">可输入 20000、2w 或 2万，按回车应用</small><div className="capital-presets">{[20_000, 100_000, 500_000, 1_000_000].map((amount) => <button key={amount} className={initialCapital === amount ? "active" : ""} onClick={() => { setInitialCapital(amount); setCapitalInput(String(amount)); }}>{amount / 10_000}万</button>)}</div></div>
            <div className="parameters"><div className="section-label"><b>执行参数</b><button onClick={() => { setPosition(30); setStopLoss(8); setTakeProfit(22); }}>恢复默认</button></div><label><span>单票仓位 <b>{position}%</b></span><input type="range" min="10" max="100" step="5" value={position} onChange={(event) => setPosition(Number(event.target.value))} /></label><div className="parameter-pair"><label><span>止损线</span><div><input type="number" min="1" max="20" value={stopLoss} onChange={(event) => setStopLoss(Number(event.target.value))} /><i>%</i></div></label><label><span>止盈线</span><div><input type="number" min="5" max="50" value={takeProfit} onChange={(event) => setTakeProfit(Number(event.target.value))} /><i>%</i></div></label></div><button className={`toggle-row ${autoRebalance ? "on" : ""}`} onClick={() => setAutoRebalance((value) => !value)} aria-pressed={autoRebalance}><span><b>收盘后自动调仓</b><small>新日K到达后检查信号</small></span><i><em /></i></button></div>
            <div className="execution-flow"><div className="section-label"><b>数据与执行流程</b><span>{dataStatus === "ready" ? "4 / 4 就绪" : "同步中"}</span></div><ol><li className={dataStatus === "ready" ? "done" : "ready"}><i>{dataStatus === "ready" ? "✓" : "1"}</i><span><b>读取 TickFlow 日K</b><small>{allBars.length || "—"} 根 · 前复权 · 真实历史数据</small></span></li><li className={dataStatus === "ready" ? "done" : "ready"}><i>{dataStatus === "ready" ? "✓" : "2"}</i><span><b>计算策略信号</b><small>{selectedStrategy.name} · 仅使用OHLCV</small></span></li><li className={dataStatus === "ready" ? "done" : "ready"}><i>{dataStatus === "ready" ? "✓" : "3"}</i><span><b>风控检查</b><small>仓位 / 止损 / 止盈</small></span></li><li className="ready"><i>4</i><span><b>虚拟撮合</b><small>佣金 0.025% · 滑点 0.1%</small></span></li></ol></div>
            <button className={`run-button ${running ? "running" : ""}`} onClick={runSimulation} disabled={running || dataStatus === "error"}><span>{running ? `正在计算真实日K ${progress}%` : "▶ 同步并运行回测"}</span><i style={{ width: `${progress}%` }} /></button><p className="run-note">已运行 {runCount} 次 · TickFlow 免费版非实时 · 不会产生真实交易</p>
          </section>

          <section className="activity-panel panel"><div className="panel-heading compact"><div><span className="eyebrow">REAL KLINE ACTIVITY</span><h2>策略成交日志</h2></div><i className={dataStatus === "ready" ? "live-dot" : "demo-dot"} /></div><div className="activity-list">{recentTrades.length ? recentTrades.map((trade) => <div className="activity-item" key={`${trade.index}-${trade.action}`}><time>{trade.date}</time><span className={trade.action === "buy" ? "buy" : "sell"}>{trade.action === "buy" ? "买入" : "卖出"}</span><p><b>{selectedItem?.name}</b><small>{trade.price.toFixed(2)} × {trade.shares.toLocaleString("zh-CN")}</small><em>{trade.reason}</em></p></div>) : <p className="activity-empty">当前区间内没有产生策略成交</p>}</div><button className="text-button" onClick={() => setToast(`当前区间共 ${backtest.trades.length} 笔真实日K模拟成交`)}>查看计算结果 →</button></section>
        </aside>
      </div>
      <StrategyStudio mode={studioMode} strategies={allStrategies} aiSettings={aiSettings} onAiSettingsChange={setAiSettings} onCreated={handleStrategyCreated} onDeleted={handleStrategyDeleted} onClose={() => setStudioMode(null)} />
      {authStatus === "ready" && !viewer && <AuthGate bootstrapAdmin={needsBootstrap} onAuthenticated={handleAuthenticated} />}
      {toast && <div className="toast" role="status"><i>✓</i>{toast}</div>}
    </main>
  );
}
