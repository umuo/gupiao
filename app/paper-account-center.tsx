"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaperAccountTaskTarget, PaperAccountView } from "./paper-account-types";
import type { SavedStrategy } from "./strategy-model";
import { APP_TIME_ZONE, formatAppDateTime } from "./timezone";

type WatchStock = { code: string; name: string };

function symbolFor(code: string) {
  if (code.includes(".")) return code;
  if (code.startsWith("6")) return `${code}.SH`;
  if (code.startsWith("0") || code.startsWith("3")) return `${code}.SZ`;
  return `${code}.BJ`;
}

function codeFor(symbol: string) {
  return symbol.split(".")[0];
}

function money(value: number, digits = 0) {
  return `¥ ${value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function percent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function parseCapital(rawValue: string) {
  const normalized = rawValue.trim().replace(/[\s,，]/g, "").toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)(w|万)?$/);
  if (!match) return null;
  const amount = Number(match[1]) * (match[2] ? 10_000 : 1);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null;
}

function EquityCurve({ account }: { account: PaperAccountView }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const draw = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, rect.width * dpr);
      canvas.height = Math.max(1, rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr); ctx.clearRect(0, 0, rect.width, rect.height);
      const values = account.snapshots.map((item) => item.equity);
      if (values.length < 2) {
        ctx.fillStyle = "#617087"; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center";
        ctx.fillText("产生第二个交易日快照后显示权益曲线", rect.width / 2, rect.height / 2);
        return;
      }
      const pad = 16; const width = rect.width - pad * 2; const height = rect.height - pad * 2;
      const minimum = Math.min(...values); const maximum = Math.max(...values); const range = Math.max(1, maximum - minimum);
      const points = values.map((value, index) => ({ x: pad + index / (values.length - 1) * width, y: pad + (1 - (value - minimum) / range) * height }));
      const positive = values.at(-1)! >= account.initialCapital;
      const gradient = ctx.createLinearGradient(0, pad, 0, rect.height - pad);
      gradient.addColorStop(0, positive ? "rgba(55,214,170,.28)" : "rgba(255,91,110,.25)"); gradient.addColorStop(1, "rgba(13,19,29,0)");
      ctx.beginPath(); ctx.moveTo(points[0].x, rect.height - pad); points.forEach((point) => ctx.lineTo(point.x, point.y)); ctx.lineTo(points.at(-1)!.x, rect.height - pad); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
      ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.strokeStyle = positive ? "#37d6aa" : "#ff5b6e"; ctx.lineWidth = 2; ctx.stroke();
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(parent); return () => observer.disconnect();
  }, [account]);
  return <canvas ref={ref} aria-label={`${account.name}每日权益曲线`} />;
}

function AccountForm({ account, watchlist, strategies, onCancel, onSaved }: {
  account: PaperAccountView | null;
  watchlist: WatchStock[];
  strategies: SavedStrategy[];
  onCancel: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const locked = Boolean(account?.tradeCount || account?.position);
  const currentCode = account ? codeFor(account.symbol) : (watchlist[0]?.code ?? "601939");
  const currentStrategy = account ? strategies.find((item) => item.id === account.strategyId) : strategies[0];
  const fallbackStrategy: SavedStrategy | null = account ? { id: account.strategyId, name: account.strategyName, description: "模拟盘保存的策略快照", tag: "模拟盘", ...account.strategyDefinition } : null;
  const availableStrategies = fallbackStrategy && !strategies.some((item) => item.id === fallbackStrategy.id) ? [fallbackStrategy, ...strategies] : strategies;
  const availableStocks = account && !watchlist.some((item) => symbolFor(item.code) === account.symbol) ? [{ code: currentCode, name: account.stockName }, ...watchlist] : watchlist;
  const [name, setName] = useState(account?.name ?? "建设银行趋势盘");
  const [description, setDescription] = useState(account?.description ?? "用于跟踪策略的独立模拟资金与成交记录");
  const [capital, setCapital] = useState(String(account?.initialCapital ?? 100_000));
  const [stockCode, setStockCode] = useState(currentCode);
  const [strategyId, setStrategyId] = useState(account?.strategyId ?? currentStrategy?.id ?? "");
  const [positionPercent, setPositionPercent] = useState(account?.positionPercent ?? 30);
  const [stopLoss, setStopLoss] = useState(account?.stopLoss ?? 8);
  const [takeProfit, setTakeProfit] = useState(account?.takeProfit ?? 22);
  const [status, setStatus] = useState<"active" | "paused">(account?.status ?? "active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedStock = availableStocks.find((item) => item.code === stockCode) ?? availableStocks[0];
  const selectedStrategy = availableStrategies.find((item) => item.id === strategyId) ?? availableStrategies[0] ?? fallbackStrategy;

  const save = async () => {
    const initialCapital = parseCapital(capital);
    if (!initialCapital) { setError("请输入有效初始本金，可使用 2w 或 2万"); return; }
    if (!selectedStock || !selectedStrategy || !name.trim()) { setError("请完整填写名称、股票和策略"); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/paper-accounts", {
        method: account ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: account?.id, name, description, initialCapital, symbol: symbolFor(selectedStock.code), stockName: selectedStock.name, strategyId: selectedStrategy.id, strategy: selectedStrategy, positionPercent, stopLoss, takeProfit, status }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "保存模拟盘失败");
      await onSaved(account ? "模拟盘配置已更新" : "模拟盘已创建，可以开始记录收益");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存模拟盘失败"); }
    finally { setSaving(false); }
  };

  return <div className="paper-form-overlay"><section className="paper-form-card" role="dialog" aria-modal="true" aria-labelledby="paper-form-title"><header><div><span>{account ? "EDIT PAPER ACCOUNT" : "NEW PAPER ACCOUNT"}</span><h3 id="paper-form-title">{account ? "编辑模拟盘" : "新建模拟盘"}</h3></div><button onClick={onCancel} aria-label="关闭">×</button></header>
    {locked && <div className="paper-lock-note"><i>⌁</i><span><b>交易口径已锁定</b><small>已有成交后不能修改本金、股票和策略，避免历史收益失真；风控参数仍可调整。</small></span></div>}
    <div className="paper-form-grid"><label><span>模拟盘名称</span><input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} /></label><label><span>运行状态</span><select value={status} onChange={(event) => setStatus(event.target.value as "active" | "paused")}><option value="active">运行中</option><option value="paused">已暂停</option></select></label></div>
    <label><span>用途说明</span><textarea value={description} maxLength={200} onChange={(event) => setDescription(event.target.value)} /></label>
    <div className="paper-form-grid"><label><span>初始本金</span><input disabled={locked} value={capital} onChange={(event) => setCapital(event.target.value.replace(/[^0-9.,，wW万\s]/g, ""))} /><small>支持 20000、2w、2万</small></label><label><span>交易股票</span><select disabled={locked} value={stockCode} onChange={(event) => setStockCode(event.target.value)}>{availableStocks.map((stock) => <option value={stock.code} key={stock.code}>{stock.name} · {stock.code}</option>)}</select></label></div>
    <label><span>执行策略</span><select disabled={locked} value={strategyId} onChange={(event) => setStrategyId(event.target.value)}>{availableStrategies.map((strategy) => <option value={strategy.id} key={strategy.id}>{strategy.name}</option>)}</select></label>
    <div className="paper-risk-grid"><label><span>单次仓位 <b>{positionPercent}%</b></span><input type="range" min="1" max="100" step="1" value={positionPercent} onChange={(event) => setPositionPercent(Number(event.target.value))} /></label><label><span>止损 (%)</span><input type="number" min="0.1" max="100" step="0.1" value={stopLoss} onChange={(event) => setStopLoss(Number(event.target.value))} /></label><label><span>止盈 (%)</span><input type="number" min="0.1" max="500" step="0.1" value={takeProfit} onChange={(event) => setTakeProfit(Number(event.target.value))} /></label></div>
    {error && <p className="studio-error">{error}</p>}
    <footer><button onClick={onCancel}>取消</button><button className="primary-studio-button" disabled={saving} onClick={save}>{saving ? "保存中…" : account ? "保存修改" : "创建模拟盘"}</button></footer>
  </section></div>;
}

export function PaperAccountCenter({ open, watchlist, strategies, onClose, onToast, onConfigureTask }: {
  open: boolean;
  watchlist: WatchStock[];
  strategies: SavedStrategy[];
  onClose: () => void;
  onToast: (message: string) => void;
  onConfigureTask: (target: PaperAccountTaskTarget) => void;
}) {
  const [items, setItems] = useState<PaperAccountView[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [formAccount, setFormAccount] = useState<PaperAccountView | "new" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/paper-accounts", { cache: "no-store" });
      const payload = await response.json() as { accounts?: PaperAccountView[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "读取模拟盘失败");
      const accounts = payload.accounts ?? [];
      setItems(accounts);
      setSelectedId((current) => accounts.some((item) => item.id === current) ? current : accounts[0]?.id ?? "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "读取模拟盘失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void load();
      void fetch("/api/paper-accounts/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .catch(() => null)
        .finally(() => void load());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, load]);

  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const totals = useMemo(() => ({
    equity: items.reduce((sum, item) => sum + item.metrics.equity, 0),
    pnl: items.reduce((sum, item) => sum + item.metrics.equity - item.initialCapital, 0),
    running: items.filter((item) => item.automation?.enabled).length,
  }), [items]);

  if (!open) return null;

  const refreshValuations = async () => {
    setRefreshing(true); setError("");
    try {
      const response = await fetch("/api/paper-accounts/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const payload = await response.json() as { updated?: number; failed?: string[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "更新收益失败");
      await load(); onToast(`已更新 ${payload.updated ?? 0} 个模拟盘的最新收益${payload.failed?.length ? `，${payload.failed.length} 个失败` : ""}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "更新收益失败"); }
    finally { setRefreshing(false); }
  };

  const remove = async (account: PaperAccountView) => {
    if (!window.confirm(`确认删除“${account.name}”？持仓、成交、收益快照和关联任务将一起删除，此操作不可恢复。`)) return;
    const response = await fetch("/api/paper-accounts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: account.id }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { setError(payload.error || "删除模拟盘失败"); return; }
    await load(); onToast(`${account.name}已删除`);
  };

  const targetFor = (account: PaperAccountView): PaperAccountTaskTarget => ({
    id: account.id,
    name: account.name,
    symbol: account.symbol,
    stockName: account.stockName,
    strategy: { id: account.strategyId, name: account.strategyName, description: "模拟盘保存的策略快照", tag: "模拟盘", ...account.strategyDefinition },
    stopLoss: account.stopLoss,
    takeProfit: account.takeProfit,
    automation: account.automation,
  });

  return <div className="studio-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="strategy-studio paper-account-studio" role="dialog" aria-modal="true" aria-labelledby="paper-title">
    <header className="studio-header"><div><span>PAPER PORTFOLIOS</span><h2 id="paper-title">我的模拟盘</h2><p>每个模拟盘独立记录资金、持仓、成交和每日收益；定时任务按需配置。</p></div><button onClick={onClose} aria-label="关闭">×</button></header>
    <div className="paper-toolbar"><div><span>总资产<b>{money(totals.equity)}</b></span><span>累计盈亏<b className={totals.pnl >= 0 ? "up" : "down"}>{totals.pnl >= 0 ? "+" : ""}{money(totals.pnl)}</b></span><span>运行任务<b>{totals.running} / {items.length}</b></span></div><button onClick={refreshValuations} disabled={refreshing}>{refreshing ? "更新中…" : "↻ 更新今日收益"}</button><button className="primary-studio-button" onClick={() => setFormAccount("new")}>＋ 新建模拟盘</button></div>
    {error && <p className="studio-error paper-global-error">{error}</p>}
    <div className="paper-layout"><aside className="paper-list"><div><span>ACCOUNTS</span><b>{items.length} / 20</b></div>{items.map((account) => <button key={account.id} className={selected?.id === account.id ? "active" : ""} onClick={() => setSelectedId(account.id)}><i className={account.status} /><span><b>{account.name}</b><small>{account.stockName} · {account.strategyName}</small></span><em className={account.metrics.totalReturn >= 0 ? "up" : "down"}>{percent(account.metrics.totalReturn)}</em></button>)}{!items.length && !loading && <div className="paper-empty-list"><i>◎</i><b>还没有模拟盘</b><p>创建后即可长期记录独立收益。</p></div>}</aside>
      <section className="paper-detail">{selected ? <>
        <header className="paper-detail-header"><div><span className={`paper-status ${selected.status}`}>{selected.status === "active" ? "● 运行中" : "Ⅱ 已暂停"}</span><h3>{selected.name}</h3><p>{selected.description || "暂无说明"}</p></div><div><button onClick={() => setFormAccount(selected)}>编辑</button><button className="danger" onClick={() => remove(selected)}>删除</button></div></header>
        <div className="paper-metrics"><article><span>当前总资产</span><b>{money(selected.metrics.equity)}</b><small>本金 {money(selected.initialCapital)}</small></article><article><span>累计收益</span><b className={selected.metrics.totalReturn >= 0 ? "up" : "down"}>{percent(selected.metrics.totalReturn)}</b><small>今日 {percent(selected.metrics.dailyReturn)}</small></article><article><span>已实现盈亏</span><b className={selected.metrics.realizedPnl >= 0 ? "up" : "down"}>{money(selected.metrics.realizedPnl, 2)}</b><small>浮动 {money(selected.metrics.unrealizedPnl, 2)}</small></article><article><span>可用资金</span><b>{money(selected.cash)}</b><small>仓位 {selected.positionPercent}%</small></article></div>
        <div className="paper-curve-card"><header><div><span>DAILY EQUITY</span><b>每日权益</b></div><small>{selected.lastValuationDate ? `最近估值 ${selected.lastValuationDate}` : "等待首次行情估值"}</small></header><div><EquityCurve account={selected} /></div></div>
        <div className="paper-info-grid"><section><header><span>执行配置</span><b>{selected.stockName} · {selected.symbol}</b></header><dl><div><dt>策略</dt><dd>{selected.strategyName}</dd></div><div><dt>单次仓位</dt><dd>{selected.positionPercent}%</dd></div><div><dt>止损 / 止盈</dt><dd>{selected.stopLoss}% / {selected.takeProfit}%</dd></div><div><dt>撮合规则</dt><dd>佣金 0.025% · 滑点 0.1%</dd></div></dl></section><section className="paper-task-card"><header><span>自动检查与通知</span><b className={selected.automation?.enabled ? "running" : ""}>{selected.automation ? selected.automation.enabled ? "运行中" : "已停用" : "未配置"}</b></header>{selected.automation ? <><p>{selected.automation.dataMode === "realtime" ? `实时行情 · 每 ${selected.automation.intervalMinutes} 分钟` : `免费日K · ${selected.automation.runTime}`} · {APP_TIME_ZONE}</p><small>渠道：{selected.automation.notificationChannelNames.join("、") || "未配置"}</small><button onClick={() => onConfigureTask(targetFor(selected))}>管理定时任务 →</button></> : <><p>不配置任务也可以每天手动更新并查看收益。</p><small>配置后，策略信号会执行模拟成交并向所选渠道发送买卖通知。</small><button onClick={() => onConfigureTask(targetFor(selected))}>＋ 配置定时任务</button></>}</section></div>
        <section className="paper-position-card"><header><div><span>POSITION</span><b>当前持仓</b></div><small>{selected.position ? "1 个持仓" : "当前空仓"}</small></header>{selected.position ? <div className="paper-position-row"><span><b>{selected.position.stockName}</b><small>{selected.position.symbol}</small></span><span><small>数量</small><b>{selected.position.shares.toLocaleString("zh-CN")} 股</b></span><span><small>成本 / 现价</small><b>{selected.position.averageCost.toFixed(3)} / {selected.position.lastPrice.toFixed(3)}</b></span><span><small>浮动盈亏</small><b className={selected.metrics.unrealizedPnl >= 0 ? "up" : "down"}>{money(selected.metrics.unrealizedPnl, 2)}</b></span></div> : <div className="paper-no-position">等待策略产生买入信号后建立模拟持仓</div>}</section>
        <section className="paper-trades-card"><header><div><span>TRADES · ASIA/SHANGHAI</span><b>最近成交</b></div><small>共 {selected.tradeCount} 笔</small></header>{selected.trades.length ? <div className="paper-trade-list">{selected.trades.slice(0, 12).map((trade) => <div key={trade.id}><time>{formatAppDateTime(trade.executedAt)}</time><i className={trade.action}>{trade.action === "buy" ? "买入" : "卖出"}</i><span><b>{trade.shares.toLocaleString("zh-CN")} 股 × {trade.executionPrice.toFixed(3)}</b><small>{trade.reason}</small></span><em className={trade.realizedPnl >= 0 ? "up" : "down"}>{trade.action === "sell" ? money(trade.realizedPnl, 2) : `佣金 ${trade.commission.toFixed(2)}`}</em></div>)}</div> : <div className="paper-no-position">还没有模拟成交记录</div>}</section>
      </> : <div className="paper-empty-detail"><i>◎</i><h3>创建第一个模拟盘</h3><p>选择股票、策略和本金，系统会为它建立独立资金账本。</p><button className="primary-studio-button" onClick={() => setFormAccount("new")}>新建模拟盘</button></div>}</section>
    </div>
    {formAccount && <AccountForm key={formAccount === "new" ? "new" : formAccount.id} account={formAccount === "new" ? null : formAccount} watchlist={watchlist} strategies={strategies} onCancel={() => setFormAccount(null)} onSaved={async (message) => { setFormAccount(null); await load(); onToast(message); }} />}
  </section></div>;
}
