"use client";

import { useCallback, useEffect, useState } from "react";
import { defaultMessageTemplate, notificationContentTypes, notificationMethods, type NotificationContentType, type NotificationHeader, type NotificationMethod } from "./notification-model";

type Channel = {
  id: string;
  name: string;
  url: string;
  method: NotificationMethod;
  headerNames: string[];
  contentType: NotificationContentType;
  messageTemplate: string;
  enabled: boolean;
  lastTestAt: string | null;
};
type NotificationLog = {
  id: string;
  notificationChannelId: string | null;
  type: "buy" | "sell" | "test" | "error";
  status: "success" | "failed";
  symbol: string;
  price: number | null;
  reason: string;
  httpStatus: number | null;
  createdAt: string;
};

const variableNames = ["action", "actionText", "automationName", "stockName", "symbol", "strategyName", "price", "reason", "dataMode", "source", "marketTime", "sentAt"];

function compactUrl(value: string) {
  try { const url = new URL(value); return `${url.host}${url.pathname}`; }
  catch { return value; }
}

export function NotificationCenter({ open, onClose, onToast }: { open: boolean; onClose: () => void; onToast: (message: string) => void }) {
  const [tab, setTab] = useState<"channels" | "logs">("channels");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("我的 Webhook");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<NotificationMethod>("POST");
  const [contentType, setContentType] = useState<NotificationContentType>("application/json");
  const [headers, setHeaders] = useState<NotificationHeader[]>([]);
  const [headersDirty, setHeadersDirty] = useState(false);
  const [messageTemplate, setMessageTemplate] = useState(defaultMessageTemplate);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [channelResponse, logResponse] = await Promise.all([fetch("/api/notification-channels"), fetch("/api/notifications")]);
      const channelPayload = await channelResponse.json() as { channels?: Channel[]; error?: string };
      const logPayload = await logResponse.json() as { notifications?: NotificationLog[]; error?: string };
      if (!channelResponse.ok) throw new Error(channelPayload.error || "读取通知渠道失败");
      if (!logResponse.ok) throw new Error(logPayload.error || "读取投递记录失败");
      setChannels(channelPayload.channels ?? []); setLogs(logPayload.notifications ?? []);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "读取通知配置失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [open, refresh]);

  if (!open) return null;

  const resetForm = () => {
    setEditingId(null); setName("我的 Webhook"); setUrl(""); setMethod("POST"); setContentType("application/json"); setHeaders([]); setHeadersDirty(false); setMessageTemplate(defaultMessageTemplate); setError("");
  };

  const editChannel = (channel: Channel) => {
    setEditingId(channel.id); setName(channel.name); setUrl(channel.url); setMethod(channel.method); setContentType(channel.contentType); setMessageTemplate(channel.messageTemplate); setHeaders([]); setHeadersDirty(false); setError("");
  };

  const updateHeader = (index: number, field: "name" | "value", value: string) => {
    setHeadersDirty(true);
    setHeaders((current) => current.map((header, headerIndex) => headerIndex === index ? { ...header, [field]: value } : header));
  };

  const saveChannel = async () => {
    setSaving(true); setError("");
    try {
      const body: Record<string, unknown> = { name, url, method, contentType, messageTemplate };
      if (!editingId || headersDirty) body.headers = headers;
      if (editingId) body.id = editingId;
      const response = await fetch("/api/notification-channels", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "保存通知渠道失败");
      await refresh(); resetForm(); onToast(editingId ? "通知渠道已更新" : "通知渠道已创建");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存通知渠道失败"); }
    finally { setSaving(false); }
  };

  const toggleChannel = async (channel: Channel) => {
    const response = await fetch("/api/notification-channels", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: channel.id, enabled: !channel.enabled }) });
    if (response.ok) setChannels((current) => current.map((item) => item.id === channel.id ? { ...item, enabled: !item.enabled } : item));
  };

  const testChannel = async (channel: Channel) => {
    setTestingId(channel.id); setError("");
    try {
      const response = await fetch("/api/notification-channels/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: channel.id }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "测试投递失败");
      onToast("Webhook 测试已送达"); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "测试投递失败"); }
    finally { setTestingId(null); }
  };

  const deleteChannel = async (channel: Channel) => {
    if (!window.confirm(`确认删除通知渠道“${channel.name}”？`)) return;
    const response = await fetch("/api/notification-channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: channel.id }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { setError(payload.error || "删除失败"); return; }
    setChannels((current) => current.filter((item) => item.id !== channel.id));
    if (editingId === channel.id) resetForm();
  };

  return <div className="studio-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="strategy-studio automation-studio" role="dialog" aria-modal="true" aria-labelledby="notification-title">
      <header className="studio-header"><div><span>NOTIFICATION CHANNELS</span><h2 id="notification-title">通知</h2><p>独立配置 Webhook 请求和消息模板，再由定时任务选择使用。</p></div><button onClick={onClose} aria-label="关闭">×</button></header>
      <nav className="automation-tabs"><button className={tab === "channels" ? "active" : ""} onClick={() => setTab("channels")}>通知渠道 <i>{channels.filter((channel) => channel.enabled).length}</i></button><button className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>投递记录 <i>{logs.length}</i></button></nav>
      <div className="studio-body automation-body">
        {error && <p className="studio-error">{error}</p>}
        {tab === "channels" && <div className="notification-config-layout">
          <section className="notification-config-form">
            <div className="automation-section-title"><div><span>{editingId ? "EDIT CHANNEL" : "NEW CHANNEL"}</span><h3>{editingId ? "编辑通知渠道" : "新建通知渠道"}</h3></div>{editingId && <button onClick={resetForm}>取消编辑</button>}</div>
            <label><span>渠道名称</span><input value={name} maxLength={50} onChange={(event) => setName(event.target.value)} /></label>
            <label><span>Webhook URL</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/webhook" /><small>仅支持公网 HTTPS 地址。</small></label>
            <div className="automation-form-grid"><label><span>请求方法</span><select value={method} onChange={(event) => setMethod(event.target.value as NotificationMethod)}>{notificationMethods.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label><span>Content-Type</span><select value={contentType} onChange={(event) => setContentType(event.target.value as NotificationContentType)}>{notificationContentTypes.map((item) => <option value={item} key={item}>{item}</option>)}</select></label></div>
            <div className="headers-editor"><div><span>自定义请求头</span><button onClick={() => { setHeadersDirty(true); setHeaders((current) => [...current, { name: "", value: "" }]); }}>＋ 添加</button></div>{editingId && channels.find((channel) => channel.id === editingId)?.headerNames.length ? <small>已保存：{channels.find((channel) => channel.id === editingId)?.headerNames.join("、")}。请求头值已加密，不会回显；不添加新列表则保留原配置。</small> : null}{headers.map((header, index) => <div className="header-row" key={index}><input value={header.name} onChange={(event) => updateHeader(index, "name", event.target.value)} placeholder="Header 名称" /><input type="password" autoComplete="off" value={header.value} onChange={(event) => updateHeader(index, "value", event.target.value)} placeholder="Header 值" /><button aria-label="删除请求头" onClick={() => { setHeadersDirty(true); setHeaders((current) => current.filter((_, itemIndex) => itemIndex !== index)); }}>×</button></div>)}</div>
            <label className="message-template-field"><span>Message Template</span><textarea rows={10} value={messageTemplate} onChange={(event) => setMessageTemplate(event.target.value)} /><small>{method === "GET" ? "GET 请求会把渲染结果放入 message 查询参数。" : contentType === "application/json" ? "模板渲染后必须是有效 JSON。" : contentType === "application/x-www-form-urlencoded" ? "请求体格式为 message=渲染结果。" : "渲染结果会直接作为文本请求体。"}</small></label>
            <div className="template-variables"><span>可用变量</span><div>{variableNames.map((variable) => <button key={variable} onClick={() => setMessageTemplate((current) => `${current}{{${variable}}}`)}>{`{{${variable}}}`}</button>)}</div></div>
            <button className="primary-studio-button automation-save" disabled={saving || !name || !url || !messageTemplate} onClick={saveChannel}>{saving ? "正在保存…" : editingId ? "保存修改" : "创建通知渠道"}</button>
          </section>
          <section className="automation-list-wrap">
            <div className="automation-section-title"><div><span>WEBHOOKS</span><h3>已配置渠道</h3></div><button onClick={refresh}>{loading ? "刷新中…" : "刷新"}</button></div>
            <div className="channel-list">{channels.length ? channels.map((channel) => <article className={!channel.enabled ? "disabled" : ""} key={channel.id}><header><div><i className={channel.enabled ? "ready" : ""} /><b>{channel.name}</b></div><button className={`task-toggle ${channel.enabled ? "on" : ""}`} onClick={() => toggleChannel(channel)} aria-label={channel.enabled ? "停用渠道" : "启用渠道"}><span /></button></header><p title={channel.url}>{compactUrl(channel.url)}</p><dl><div><dt>请求</dt><dd>{channel.method}</dd></div><div><dt>Content-Type</dt><dd>{channel.contentType}</dd></div><div><dt>请求头</dt><dd>{channel.headerNames.length ? channel.headerNames.join("、") : "无"}</dd></div><div><dt>最近测试</dt><dd>{channel.lastTestAt ? new Date(channel.lastTestAt).toLocaleString("zh-CN") : "尚未测试"}</dd></div></dl><footer><button disabled={testingId === channel.id || !channel.enabled} onClick={() => testChannel(channel)}>{testingId === channel.id ? "发送中…" : "测试投递"}</button><button onClick={() => editChannel(channel)}>编辑</button><button className="danger" onClick={() => deleteChannel(channel)}>删除</button></footer></article>) : <div className="automation-empty"><i>⌁</i><b>还没有通知渠道</b><p>在左侧配置完整的 Webhook 请求。</p></div>}</div>
          </section>
        </div>}
        {tab === "logs" && <div className="notification-history"><div className="automation-section-title"><div><span>DELIVERY LOG</span><h3>Webhook 投递记录</h3></div><button onClick={refresh}>{loading ? "刷新中…" : "刷新"}</button></div>{logs.length ? <div className="notification-table"><div className="notification-head"><span>时间</span><span>类型</span><span>渠道 / 标的</span><span>原因</span><span>投递</span></div>{logs.map((log) => <div className="notification-row" key={log.id}><time>{new Date(log.createdAt).toLocaleString("zh-CN")}</time><b className={log.type}>{log.type === "buy" ? "买入" : log.type === "sell" ? "卖出" : log.type === "test" ? "测试" : "异常"}</b><span>{channels.find((channel) => channel.id === log.notificationChannelId)?.name ?? "—"}<small>{log.symbol}{log.price ? ` · ¥${log.price.toFixed(2)}` : ""}</small></span><p>{log.reason}</p><em className={log.status}>{log.status === "success" ? "已送达" : log.httpStatus ? `HTTP ${log.httpStatus}` : "失败"}</em></div>)}</div> : <div className="automation-empty"><i>✓</i><b>暂无投递记录</b><p>测试渠道或任务触发信号后会显示在这里。</p></div>}</div>}
      </div>
    </section>
  </div>;
}
