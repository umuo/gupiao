"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SavedStrategy } from "./strategy-model";

type WatchStock = { code: string; name: string };
type Automation = {
  id: string;
  name: string;
  symbol: string;
  stockName: string;
  strategyName: string;
  dataMode: "daily" | "realtime";
  runTime: string;
  intervalMinutes: number;
  webhookUrl: string;
  enabled: boolean;
  positionState: "flat" | "holding";
  lastRunAt: string | null;
  lastNotifiedAt: string | null;
};
type NotificationLog = {
  id: string;
  type: "buy" | "sell" | "test" | "error";
  status: "success" | "failed";
  symbol: string;
  price: number | null;
  reason: string;
  httpStatus: number | null;
  createdAt: string;
};

function toSymbol(code: string) {
  if (code.startsWith("6")) return `${code}.SH`;
  if (code.startsWith("0") || code.startsWith("3")) return `${code}.SZ`;
  return `${code}.BJ`;
}

function compactUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname}`;
  } catch {
    return value;
  }
}

export function AutomationCenter({ open, watchlist, strategies, defaultStopLoss, defaultTakeProfit, onClose, onToast }: {
  open: boolean;
  watchlist: WatchStock[];
  strategies: Array<SavedStrategy>;
  defaultStopLoss: number;
  defaultTakeProfit: number;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [tab, setTab] = useState<"tasks" | "notifications" | "data">("tasks");
  const [items, setItems] = useState<Automation[]>([]);
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [tickflow, setTickflow] = useState<{ configured: boolean; hint: string | null }>({ configured: false, hint: null });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [stockCode, setStockCode] = useState(watchlist[0]?.code ?? "601939");
  const [strategyId, setStrategyId] = useState(strategies[0]?.id ?? "");
  const [name, setName] = useState("每日策略提醒");
  const [dataMode, setDataMode] = useState<"daily" | "realtime">("daily");
  const [runTime, setRunTime] = useState("09:35");
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [stopLoss, setStopLoss] = useState(defaultStopLoss);
  const [takeProfit, setTakeProfit] = useState(defaultTakeProfit);

  const effectiveStockCode = watchlist.some((stock) => stock.code === stockCode) ? stockCode : (watchlist[0]?.code ?? "");
  const effectiveStrategyId = strategies.some((strategy) => strategy.id === strategyId) ? strategyId : (strategies[0]?.id ?? "");
  const selectedStock = watchlist.find((stock) => stock.code === effectiveStockCode) ?? watchlist[0];
  const selectedStrategy = strategies.find((strategy) => strategy.id === effectiveStrategyId) ?? strategies[0];
  const activeTasks = useMemo(() => items.filter((item) => item.enabled).length, [items]);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [taskResponse, logResponse] = await Promise.all([fetch("/api/automations"), fetch("/api/notifications")]);
      const taskPayload = await taskResponse.json() as { automations?: Automation[]; tickflow?: { configured: boolean; hint: string | null }; error?: string };
      const logPayload = await logResponse.json() as { notifications?: NotificationLog[]; error?: string };
      if (!taskResponse.ok) throw new Error(taskPayload.error || "读取任务失败");
      if (!logResponse.ok) throw new Error(logPayload.error || "读取通知失败");
      setItems(taskPayload.automations ?? []);
      setTickflow(taskPayload.tickflow ?? { configured: false, hint: null });
      setLogs(logPayload.notifications ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取任务失败");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [open, refresh]);

  if (!open) return null;

  const saveTask = async () => {
    if (!selectedStock || !selectedStrategy) { setError("请先选择股票和策略"); return; }
    if (dataMode === "realtime" && !tickflow.configured) { setTab("data"); setError("实时任务需要先配置 TickFlow Key"); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          symbol: toSymbol(selectedStock.code),
          stockName: selectedStock.name,
          strategyId: selectedStrategy.id,
          strategy: selectedStrategy,
          dataMode,
          runTime,
          intervalMinutes,
          webhookUrl,
          stopLoss,
          takeProfit,
        }),
      });
      const payload = await response.json() as { automation?: Automation; error?: string };
      if (!response.ok || !payload.automation) throw new Error(payload.error || "创建任务失败");
      setItems((current) => [payload.automation!, ...current]);
      onToast("定时策略任务已创建");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建任务失败");
    } finally { setSaving(false); }
  };

  const taskAction = async (id: string, endpoint: "run" | "test") => {
    setError("");
    try {
      const response = await fetch(`/api/automations/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const payload = await response.json() as { error?: string; result?: { action: string | null; reason: string } };
      if (!response.ok) throw new Error(payload.error || "操作失败");
      onToast(endpoint === "test" ? "Webhook 测试已送达" : payload.result?.action ? `已发送${payload.result.action === "buy" ? "买入" : "卖出"}提醒` : payload.result?.reason || "检查完成");
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败"); }
  };

  const toggleTask = async (item: Automation) => {
    const response = await fetch("/api/automations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, enabled: !item.enabled }) });
    if (response.ok) setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, enabled: !entry.enabled } : entry));
  };

  const resetTaskPosition = async (item: Automation) => {
    const response = await fetch("/api/automations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, resetPosition: true }) });
    if (response.ok) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, positionState: "flat" } : entry));
      onToast("任务模拟状态已重置为空仓");
    }
  };

  const deleteTask = async (item: Automation) => {
    if (!window.confirm(`确认删除任务“${item.name}”？通知历史会保留。`)) return;
    const response = await fetch("/api/automations", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }) });
    if (response.ok) setItems((current) => current.filter((entry) => entry.id !== item.id));
  };

  const saveTickflow = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/settings/tickflow", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) });
      const payload = await response.json() as { configured?: boolean; hint?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "保存失败");
      setTickflow({ configured: true, hint: payload.hint ?? null }); setApiKey(""); onToast("TickFlow 实时行情已连接");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setSaving(false); }
  };

  const removeTickflow = async () => {
    const response = await fetch("/api/settings/tickflow", { method: "DELETE" });
    if (response.ok) { setTickflow({ configured: false, hint: null }); setApiKey(""); onToast("TickFlow Key 已移除"); }
  };

  return <div className="studio-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="strategy-studio automation-studio" role="dialog" aria-modal="true" aria-labelledby="automation-title">
      <header className="studio-header"><div><span>AUTOMATION & NOTIFY</span><h2 id="automation-title">定时任务与通知</h2><p>按策略检查行情，通过你的 Webhook 发送买卖信号。</p></div><button onClick={onClose} aria-label="关闭">×</button></header>
      <nav className="automation-tabs">
        <button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>定时任务 <i>{activeTasks}</i></button>
        <button className={tab === "notifications" ? "active" : ""} onClick={() => setTab("notifications")}>通知记录 <i>{logs.length}</i></button>
        <button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")}>实时数据 <i className={tickflow.configured ? "connected" : ""}>{tickflow.configured ? "已连接" : "未配置"}</i></button>
      </nav>
      <div className="studio-body automation-body">
        {error && <p className="studio-error">{error}</p>}
        {tab === "tasks" && <div className="automation-layout">
          <section className="automation-form">
            <div className="automation-section-title"><div><span>NEW TASK</span><h3>新建策略提醒</h3></div><small>只通知，不执行真实委托</small></div>
            <label><span>任务名称</span><input value={name} maxLength={50} onChange={(event) => setName(event.target.value)} /></label>
            <div className="automation-form-grid"><label><span>自选股</span><select value={effectiveStockCode} onChange={(event) => setStockCode(event.target.value)}>{watchlist.map((stock) => <option key={stock.code} value={stock.code}>{stock.name} · {stock.code}</option>)}</select></label><label><span>策略</span><select value={effectiveStrategyId} onChange={(event) => setStrategyId(event.target.value)}>{strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select></label></div>
            <div className="mode-switch"><button className={dataMode === "daily" ? "active" : ""} onClick={() => setDataMode("daily")}><b>免费日K</b><small>每天检查一次</small></button><button className={dataMode === "realtime" ? "active" : ""} onClick={() => setDataMode("realtime")}><b>实时行情</b><small>{tickflow.configured ? "TickFlow 已连接" : "需要 TickFlow Key"}</small></button></div>
            {dataMode === "daily" ? <label><span>每天检查时间（北京时间）</span><input type="time" value={runTime} onChange={(event) => setRunTime(event.target.value)} /><small>工作日执行；09:35 默认使用上一根已完成日K。</small></label> : <label><span>交易时段检查间隔</span><select value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))}>{[1, 5, 15, 30, 60].map((value) => <option key={value} value={value}>每 {value} 分钟</option>)}</select><small>仅 09:30–11:30、13:00–15:00 检查，旧行情不会触发。</small></label>}
            <label><span>Webhook 地址</span><input type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/hooks/stock-signal" /><small>仅支持公网 HTTPS；买入、卖出和原因会以 JSON POST 发送。</small></label>
            <div className="automation-form-grid"><label><span>止损 (%)</span><input type="number" min="0.1" max="100" step="0.1" value={stopLoss} onChange={(event) => setStopLoss(Number(event.target.value))} /></label><label><span>止盈 (%)</span><input type="number" min="0.1" max="500" step="0.1" value={takeProfit} onChange={(event) => setTakeProfit(Number(event.target.value))} /></label></div>
            <button className="primary-studio-button automation-save" onClick={saveTask} disabled={saving || !webhookUrl || !name}>{saving ? "正在创建…" : "创建并启用任务"}</button>
          </section>
          <section className="automation-list-wrap">
            <div className="automation-section-title"><div><span>ACTIVE JOBS</span><h3>我的任务</h3></div><button onClick={refresh}>{loading ? "刷新中…" : "刷新"}</button></div>
            <div className="automation-list">{items.length ? items.map((item) => <article className={!item.enabled ? "disabled" : ""} key={item.id}>
              <header><div><i className={item.dataMode} /> <b>{item.name}</b></div><button className={`task-toggle ${item.enabled ? "on" : ""}`} onClick={() => toggleTask(item)} aria-label={item.enabled ? "停用任务" : "启用任务"}><span /></button></header>
              <p><strong>{item.stockName}</strong><span>{item.symbol}</span><em>{item.strategyName}</em></p>
              <dl><div><dt>数据</dt><dd>{item.dataMode === "realtime" ? `实时 · ${item.intervalMinutes}分钟` : `日K · ${item.runTime}`}</dd></div><div><dt>模拟状态</dt><dd>{item.positionState === "holding" ? "持仓" : "空仓"}</dd></div><div><dt>Webhook</dt><dd title={item.webhookUrl}>{compactUrl(item.webhookUrl)}</dd></div><div><dt>最近通知</dt><dd>{item.lastNotifiedAt ? new Date(item.lastNotifiedAt).toLocaleString("zh-CN") : "尚未触发"}</dd></div></dl>
              <footer><button onClick={() => taskAction(item.id, "run")}>立即检查</button><button onClick={() => taskAction(item.id, "test")}>测试 Webhook</button>{item.positionState === "holding" && <button onClick={() => resetTaskPosition(item)}>重置为空仓</button>}<button className="danger" onClick={() => deleteTask(item)}>删除</button></footer>
            </article>) : <div className="automation-empty"><i>⌁</i><b>还没有定时任务</b><p>在左侧选择自选股、策略和 Webhook 后创建。</p></div>}</div>
          </section>
        </div>}
        {tab === "notifications" && <div className="notification-history"><div className="automation-section-title"><div><span>DELIVERY LOG</span><h3>Webhook 通知记录</h3></div><button onClick={refresh}>{loading ? "刷新中…" : "刷新"}</button></div>{logs.length ? <div className="notification-table"><div className="notification-head"><span>时间</span><span>类型</span><span>标的 / 价格</span><span>原因</span><span>投递</span></div>{logs.map((log) => <div className="notification-row" key={log.id}><time>{new Date(log.createdAt).toLocaleString("zh-CN")}</time><b className={log.type}>{log.type === "buy" ? "买入" : log.type === "sell" ? "卖出" : log.type === "test" ? "测试" : "异常"}</b><span>{log.symbol}<small>{log.price ? `¥ ${log.price.toFixed(2)}` : "—"}</small></span><p>{log.reason}</p><em className={log.status}>{log.status === "success" ? "已送达" : log.httpStatus ? `HTTP ${log.httpStatus}` : "失败"}</em></div>)}</div> : <div className="automation-empty"><i>✓</i><b>暂无通知记录</b><p>策略出现买卖信号或测试 Webhook 后会显示在这里。</p></div>}</div>}
        {tab === "data" && <div className="tickflow-settings">
          <div className={`tickflow-status ${tickflow.configured ? "connected" : ""}`}><i>{tickflow.configured ? "✓" : "⌁"}</i><div><span>TICKFLOW REALTIME</span><b>{tickflow.configured ? "实时行情已连接" : "配置实时行情"}</b><p>{tickflow.configured ? `已安全保存 ${tickflow.hint ?? "API Key"}；明文不会回显。` : "免费服务仍可用于历史日K；实时任务必须配置有实时行情权限的 Key。"}</p></div></div>
          <section><h3>{tickflow.configured ? "替换 TickFlow Key" : "添加 TickFlow Key"}</h3><p>保存时会先请求建设银行实时行情验证权限，再使用 AES-GCM 加密。定时任务离线运行，因此 Key 必须安全保存在服务端。</p><label><span>TickFlow API Key</span><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="输入 TickFlow API Key" /></label><div className="tickflow-actions"><button className="primary-studio-button" disabled={saving || !apiKey.trim()} onClick={saveTickflow}>{saving ? "正在验证…" : "验证并保存"}</button>{tickflow.configured && <button className="remove-key" onClick={removeTickflow}>移除 Key</button>}</div></section>
          <aside><b>实时任务的检查规则</b><ul><li>仅在 A 股工作日的连续竞价时段检查。</li><li>实时价与历史日K合并成当日临时K线，再计算同一套策略。</li><li>行情日期不是当天时停止触发，避免休市旧数据误报。</li><li>同一买卖状态只通知一次，不会每分钟重复轰炸。</li></ul></aside>
        </div>}
      </div>
    </section>
  </div>;
}
