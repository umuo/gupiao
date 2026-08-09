"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PaperAccountTaskTarget } from "./paper-account-types";
import type { SavedStrategy } from "./strategy-model";
import { APP_TIME_ZONE, APP_TIME_ZONE_LABEL, formatAppDateTime } from "./timezone";

type WatchStock = { code: string; name: string };
type ChannelSummary = { id: string; name: string; type: "webhook" | "dingtalk" | "feishu"; enabled: boolean };
type Automation = {
  id: string;
  paperAccountId: string | null;
  paperAccountName: string | null;
  name: string;
  symbol: string;
  stockName: string;
  strategyName: string;
  notificationChannelNames: string[];
  notificationChannelIds: string[];
  dataMode: "daily" | "realtime";
  runTime: string;
  intervalMinutes: number;
  timezone: string;
  enabled: boolean;
  positionState: "flat" | "holding";
  lastRunAt: string | null;
  lastNotifiedAt: string | null;
};

function toSymbol(code: string) {
  if (code.startsWith("6")) return `${code}.SH`;
  if (code.startsWith("0") || code.startsWith("3")) return `${code}.SZ`;
  return `${code}.BJ`;
}

export function TaskCenter({ open, watchlist, strategies, defaultStopLoss, defaultTakeProfit, targetAccount, onClose, onToast, onOpenNotifications, onTaskChanged }: {
  open: boolean;
  watchlist: WatchStock[];
  strategies: SavedStrategy[];
  defaultStopLoss: number;
  defaultTakeProfit: number;
  targetAccount: PaperAccountTaskTarget | null;
  onClose: () => void;
  onToast: (message: string) => void;
  onOpenNotifications: () => void;
  onTaskChanged: () => void;
}) {
  const [tab, setTab] = useState<"tasks" | "data">("tasks");
  const [items, setItems] = useState<Automation[]>([]);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [tickflow, setTickflow] = useState<{ configured: boolean; hint: string | null }>({ configured: false, hint: null });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [stockCode, setStockCode] = useState(watchlist[0]?.code ?? "601939");
  const [strategyId, setStrategyId] = useState(strategies[0]?.id ?? "");
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [editingTaskChannels, setEditingTaskChannels] = useState<string | null>(null);
  const [taskChannelDraft, setTaskChannelDraft] = useState<string[]>([]);
  const [name, setName] = useState("每日策略提醒");
  const [dataMode, setDataMode] = useState<"daily" | "realtime">("daily");
  const [runTime, setRunTime] = useState("09:35");
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [stopLoss, setStopLoss] = useState(defaultStopLoss);
  const [takeProfit, setTakeProfit] = useState(defaultTakeProfit);

  const effectiveStrategies = targetAccount && !strategies.some((strategy) => strategy.id === targetAccount.strategy.id) ? [targetAccount.strategy, ...strategies] : strategies;
  const effectiveStockCode = targetAccount ? targetAccount.symbol.split(".")[0] : watchlist.some((stock) => stock.code === stockCode) ? stockCode : (watchlist[0]?.code ?? "");
  const effectiveStrategyId = targetAccount ? targetAccount.strategy.id : effectiveStrategies.some((strategy) => strategy.id === strategyId) ? strategyId : (effectiveStrategies[0]?.id ?? "");
  const enabledChannels = channels.filter((channel) => channel.enabled);
  const selectedChannelIds = channelIds.filter((id) => enabledChannels.some((channel) => channel.id === id));
  const selectedStock = targetAccount ? { code: effectiveStockCode, name: targetAccount.stockName } : watchlist.find((stock) => stock.code === effectiveStockCode) ?? watchlist[0];
  const selectedStrategy = targetAccount?.strategy ?? effectiveStrategies.find((strategy) => strategy.id === effectiveStrategyId) ?? effectiveStrategies[0];
  const activeTasks = useMemo(() => items.filter((item) => item.enabled).length, [items]);
  const linkedTask = targetAccount ? items.find((item) => item.paperAccountId === targetAccount.id) : null;

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/automations");
      const payload = await response.json() as { automations?: Automation[]; channels?: ChannelSummary[]; tickflow?: { configured: boolean; hint: string | null }; error?: string };
      if (!response.ok) throw new Error(payload.error || "读取任务失败");
      setItems(payload.automations ?? []);
      setChannels(payload.channels ?? []);
      setTickflow(payload.tickflow ?? { configured: false, hint: null });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "读取任务失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [open, refresh]);

  useEffect(() => {
    if (!open || !targetAccount) return;
    const task = linkedTask ?? targetAccount.automation;
    // This synchronizes the task editor with the explicitly selected paper account.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(task?.name ?? `${targetAccount.name} · 策略通知`);
    setStockCode(targetAccount.symbol.split(".")[0]);
    setStrategyId(targetAccount.strategy.id);
    setStopLoss(targetAccount.stopLoss);
    setTakeProfit(targetAccount.takeProfit);
    setDataMode(task?.dataMode ?? "daily");
    setRunTime(task?.runTime ?? "15:10");
    setIntervalMinutes(task?.intervalMinutes ?? 5);
    setChannelIds(task?.notificationChannelIds ?? []);
  }, [open, targetAccount, linkedTask]);

  if (!open) return null;

  const saveTask = async () => {
    if (!selectedStock || !selectedStrategy) { setError("请先选择股票和策略"); return; }
    if (!selectedChannelIds.length) { setError("请至少选择一个已启用的通知渠道"); return; }
    if (dataMode === "realtime" && !tickflow.configured) { setTab("data"); setError("实时任务需要先配置 TickFlow Key"); return; }
    setSaving(true); setError("");
    try {
      const taskId = linkedTask?.id ?? targetAccount?.automation?.id;
      const response = await fetch("/api/automations", {
        method: taskId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskId
          ? { id: taskId, name, notificationChannelIds: selectedChannelIds, dataMode, runTime, intervalMinutes }
          : { name, paperAccountId: targetAccount?.id, symbol: toSymbol(selectedStock.code), stockName: selectedStock.name, strategyId: selectedStrategy.id, strategy: selectedStrategy, notificationChannelIds: selectedChannelIds, dataMode, runTime, intervalMinutes, stopLoss, takeProfit }),
      });
      const payload = await response.json() as { automation?: Automation; error?: string };
      if (!response.ok || !payload.automation) throw new Error(payload.error || "创建任务失败");
      await refresh(); onTaskChanged(); onToast(taskId ? "定时任务配置已更新" : "定时策略任务已创建");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "创建任务失败"); }
    finally { setSaving(false); }
  };

  const runTask = async (id: string) => {
    setError("");
    try {
      const response = await fetch("/api/automations/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const payload = await response.json() as { error?: string; result?: { action: string | null; reason: string; warning?: string; execution?: { executed: boolean }; deliveries?: { succeeded: number; total: number; failed?: number } } };
      if (!response.ok) throw new Error(payload.error || "任务检查失败");
      const result = payload.result;
      onToast(result?.warning || (result?.action
        ? `${result.execution?.executed ? "模拟成交已记录，" : ""}已向 ${result.deliveries?.succeeded ?? 0}/${result.deliveries?.total ?? 0} 个渠道发送${result.action === "buy" ? "买入" : "卖出"}提醒`
        : result?.reason || "检查完成"));
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "任务检查失败"); }
  };

  const patchTask = async (item: Automation, changes: { enabled?: boolean; resetPosition?: boolean; notificationChannelIds?: string[]; name?: string; dataMode?: "daily" | "realtime"; runTime?: string; intervalMinutes?: number }) => {
    const response = await fetch("/api/automations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, ...changes }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { setError(payload.error || "更新任务失败"); return; }
    setEditingTaskChannels(null); await refresh(); onTaskChanged();
  };

  const deleteTask = async (item: Automation) => {
    if (!window.confirm(`确认删除任务“${item.name}”？通知历史会保留。`)) return;
    const response = await fetch("/api/automations", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }) });
    if (response.ok) { setItems((current) => current.filter((entry) => entry.id !== item.id)); onTaskChanged(); }
  };

  const saveTickflow = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/settings/tickflow", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) });
      const payload = await response.json() as { hint?: string; error?: string };
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
    <section className="strategy-studio automation-studio" role="dialog" aria-modal="true" aria-labelledby="task-title">
      <header className="studio-header"><div><span>SCHEDULED TASKS</span><h2 id="task-title">定时任务</h2><p>所有任务统一使用 {APP_TIME_ZONE_LABEL}（{APP_TIME_ZONE}）；通知方式由通知模块独立维护。</p></div><button onClick={onClose} aria-label="关闭">×</button></header>
      <nav className="automation-tabs"><button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>任务管理 <i>{activeTasks}</i></button><button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")}>实时数据 <i className={tickflow.configured ? "connected" : ""}>{tickflow.configured ? "已连接" : "未配置"}</i></button></nav>
      <div className="studio-body automation-body">
        {error && <p className="studio-error">{error}</p>}
        {tab === "tasks" && <div className="automation-layout">
          <section className="automation-form">
            <div className="automation-section-title"><div><span>{linkedTask || targetAccount?.automation ? "EDIT TASK" : "NEW TASK"}</span><h3>{linkedTask || targetAccount?.automation ? "编辑策略任务" : "新建策略任务"}</h3></div><small>只执行模拟成交</small></div>
            {targetAccount && <div className="task-account-lock"><i>◎</i><span><b>{targetAccount.name}</b><small>{targetAccount.stockName} · {targetAccount.strategy.name}</small></span><em>关联模拟盘</em></div>}
            <label><span>任务名称</span><input value={name} maxLength={50} onChange={(event) => setName(event.target.value)} /></label>
            {!targetAccount && <div className="automation-form-grid"><label><span>自选股</span><select value={effectiveStockCode} onChange={(event) => setStockCode(event.target.value)}>{watchlist.map((stock) => <option key={stock.code} value={stock.code}>{stock.name} · {stock.code}</option>)}</select></label><label><span>策略</span><select value={effectiveStrategyId} onChange={(event) => setStrategyId(event.target.value)}>{effectiveStrategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select></label></div>}
            <div className="task-channel-field"><span>通知渠道 <em>可多选</em></span>{enabledChannels.length ? <div className="task-channel-picker">{enabledChannels.map((channel) => { const selected = selectedChannelIds.includes(channel.id); return <button key={channel.id} className={selected ? "selected" : ""} onClick={() => setChannelIds((current) => selected ? current.filter((id) => id !== channel.id) : [...current, channel.id])}><i>{selected ? "✓" : ""}</i><span><b>{channel.name}</b><small>{channel.type === "dingtalk" ? "钉钉" : channel.type === "feishu" ? "飞书" : "Webhook"}</small></span></button>; })}</div> : <button className="empty-channel-link" onClick={onOpenNotifications}>＋ 前往通知模块创建渠道</button>}<small>同一信号会同时发送到所有选中的渠道。</small></div>
            <div className="mode-switch"><button className={dataMode === "daily" ? "active" : ""} onClick={() => setDataMode("daily")}><b>免费日K</b><small>每天检查一次</small></button><button className={dataMode === "realtime" ? "active" : ""} onClick={() => setDataMode("realtime")}><b>实时行情</b><small>{tickflow.configured ? "TickFlow 已连接" : "需要 TickFlow Key"}</small></button></div>
            {dataMode === "daily" ? <label><span>每天检查时间（{APP_TIME_ZONE_LABEL}）</span><input type="time" value={runTime} onChange={(event) => setRunTime(event.target.value)} /><small>{APP_TIME_ZONE} · 工作日执行；09:35 默认使用上一根已完成日K。</small></label> : <label><span>交易时段检查间隔</span><select value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))}>{[1, 5, 15, 30, 60].map((value) => <option key={value} value={value}>每 {value} 分钟</option>)}</select><small>{APP_TIME_ZONE} · 仅 09:30–11:30、13:00–15:00 检查。</small></label>}
            {targetAccount ? <div className="task-risk-readonly"><span>风控跟随模拟盘</span><b>仓位按模拟盘配置 · 止损 {targetAccount.stopLoss}% · 止盈 {targetAccount.takeProfit}%</b></div> : <div className="automation-form-grid"><label><span>止损 (%)</span><input type="number" min="0.1" max="100" step="0.1" value={stopLoss} onChange={(event) => setStopLoss(Number(event.target.value))} /></label><label><span>止盈 (%)</span><input type="number" min="0.1" max="500" step="0.1" value={takeProfit} onChange={(event) => setTakeProfit(Number(event.target.value))} /></label></div>}
            <button className="primary-studio-button automation-save" onClick={saveTask} disabled={saving || !selectedChannelIds.length || !name}>{saving ? "正在保存…" : `${linkedTask || targetAccount?.automation ? "保存任务" : "创建任务"} · ${selectedChannelIds.length} 个渠道`}</button>
          </section>
          <section className="automation-list-wrap">
            <div className="automation-section-title"><div><span>SCHEDULE</span><h3>我的任务</h3></div><button onClick={refresh}>{loading ? "刷新中…" : "刷新"}</button></div>
            <div className="automation-list">{items.length ? items.map((item) => <article className={!item.enabled ? "disabled" : ""} key={item.id}><header><div><i className={item.dataMode} /> <b>{item.name}</b></div><button className={`task-toggle ${item.enabled ? "on" : ""}`} onClick={() => patchTask(item, { enabled: !item.enabled })} aria-label={item.enabled ? "停用任务" : "启用任务"}><span /></button></header>{item.paperAccountName && <div className="task-linked-account">◎ {item.paperAccountName}</div>}<p><strong>{item.stockName}</strong><span>{item.symbol}</span><em>{item.strategyName}</em></p><dl><div><dt>数据</dt><dd>{item.dataMode === "realtime" ? `实时 · ${item.intervalMinutes}分钟` : `日K · ${item.runTime}`} · {item.timezone}</dd></div><div><dt>模拟状态</dt><dd>{item.positionState === "holding" ? "持仓" : "空仓"}</dd></div><div><dt>通知渠道</dt><dd>{item.notificationChannelNames.length ? item.notificationChannelNames.join("、") : "未配置"}</dd></div><div><dt>最近通知</dt><dd>{item.lastNotifiedAt ? formatAppDateTime(item.lastNotifiedAt) : "尚未触发"}</dd></div></dl>{editingTaskChannels === item.id && <div className="task-card-channel-editor"><span>调整通知渠道</span><div>{enabledChannels.map((channel) => { const selected = taskChannelDraft.includes(channel.id); return <button className={selected ? "selected" : ""} key={channel.id} onClick={() => setTaskChannelDraft((current) => selected ? current.filter((id) => id !== channel.id) : [...current, channel.id])}>{selected ? "✓ " : ""}{channel.name}</button>; })}</div><footer><button onClick={() => setEditingTaskChannels(null)}>取消</button><button className="save" disabled={!taskChannelDraft.length} onClick={() => patchTask(item, { notificationChannelIds: taskChannelDraft })}>保存渠道</button></footer></div>}<footer><button onClick={() => runTask(item.id)}>立即检查</button><button onClick={() => { setEditingTaskChannels(item.id); setTaskChannelDraft(item.notificationChannelIds.filter((id) => enabledChannels.some((channel) => channel.id === id))); }}>设置渠道</button>{item.positionState === "holding" && !item.paperAccountId && <button onClick={() => patchTask(item, { resetPosition: true })}>重置为空仓</button>}<button className="danger" onClick={() => deleteTask(item)}>删除</button></footer></article>) : <div className="automation-empty"><i>◴</i><b>还没有定时任务</b><p>选择股票、策略和通知渠道后创建。</p></div>}</div>
          </section>
        </div>}
        {tab === "data" && <div className="tickflow-settings"><div className={`tickflow-status ${tickflow.configured ? "connected" : ""}`}><i>{tickflow.configured ? "✓" : "⌁"}</i><div><span>TICKFLOW REALTIME</span><b>{tickflow.configured ? "实时行情已连接" : "配置实时行情"}</b><p>{tickflow.configured ? `已安全保存 ${tickflow.hint ?? "API Key"}；明文不会回显。` : "免费服务仍可用于历史日K；实时任务必须配置有实时行情权限的 Key。"}</p></div></div><section><h3>{tickflow.configured ? "替换 TickFlow Key" : "添加 TickFlow Key"}</h3><p>保存时会先验证建设银行实时行情权限，再使用 AES-GCM 加密。</p><label><span>TickFlow API Key</span><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="输入 TickFlow API Key" /></label><div className="tickflow-actions"><button className="primary-studio-button" disabled={saving || !apiKey.trim()} onClick={saveTickflow}>{saving ? "正在验证…" : "验证并保存"}</button>{tickflow.configured && <button className="remove-key" onClick={removeTickflow}>移除 Key</button>}</div></section><aside><b>实时任务规则</b><ul><li>仅在 A 股连续竞价时段检查。</li><li>实时价与历史日K合并后计算策略。</li><li>旧行情不会触发买卖提醒。</li><li>相同信号不会重复通知。</li></ul></aside></div>}
      </div>
    </section>
  </div>;
}
