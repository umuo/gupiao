"use client";

import { useMemo, useState } from "react";
import {
  defaultStrategyDraft,
  indicatorLabels,
  operatorLabels,
  strategyRuleSummary,
  type IndicatorKey,
  type RuleLogic,
  type RuleOperator,
  type SavedStrategy,
  type StrategyDraft,
  type StrategyRule,
} from "./strategy-model";

export type StudioMode = "manual" | "ai" | "docs" | "settings" | null;

type AiSettings = { baseUrl: string; model: string; apiKey: string };

type StudioProps = {
  mode: StudioMode;
  strategies: Array<SavedStrategy & { builtin?: boolean }>;
  aiSettings: AiSettings;
  onAiSettingsChange: (settings: AiSettings) => void;
  onCreated: (strategy: SavedStrategy) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
};

const indicatorOptions = Object.entries(indicatorLabels) as [IndicatorKey, string][];
const operatorOptions = Object.entries(operatorLabels) as [RuleOperator, string][];

function RuleEditor({ title, tone, rules, logic, onChange, onLogicChange }: {
  title: string;
  tone: "buy" | "sell";
  rules: StrategyRule[];
  logic: RuleLogic;
  onChange: (rules: StrategyRule[]) => void;
  onLogicChange: (logic: RuleLogic) => void;
}) {
  const patchRule = (index: number, patch: Partial<StrategyRule>) => {
    onChange(rules.map((rule, itemIndex) => itemIndex === index ? { ...rule, ...patch } : rule));
  };

  return <section className={`rule-section ${tone}`}>
    <div className="rule-section-title"><div><i /> <b>{title}</b><span>{rules.length} 个条件</span></div><select value={logic} onChange={(event) => onLogicChange(event.target.value as RuleLogic)} aria-label={`${title}组合方式`}><option value="and">全部满足</option><option value="or">任一满足</option></select></div>
    <div className="rule-list">{rules.map((rule, index) => <div className="rule-row" key={`${title}-${index}`}>
      <span className="rule-number">{index + 1}</span>
      <select value={rule.left} onChange={(event) => patchRule(index, { left: event.target.value as IndicatorKey })} aria-label="左侧指标">{indicatorOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select value={rule.operator} onChange={(event) => patchRule(index, { operator: event.target.value as RuleOperator })} aria-label="比较方式">{operatorOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select value={rule.rightType} onChange={(event) => patchRule(index, event.target.value === "value" ? { rightType: "value", rightValue: 0 } : { rightType: "indicator", rightIndicator: "ma20" })} aria-label="比较对象类型"><option value="indicator">指标</option><option value="value">数值</option></select>
      {rule.rightType === "indicator"
        ? <select value={rule.rightIndicator ?? "ma20"} onChange={(event) => patchRule(index, { rightIndicator: event.target.value as IndicatorKey })} aria-label="右侧指标">{indicatorOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        : <input type="number" step="0.1" value={rule.rightValue ?? 0} onChange={(event) => patchRule(index, { rightValue: Number(event.target.value) })} aria-label="比较数值" />}
      <button className="remove-rule" onClick={() => rules.length > 1 && onChange(rules.filter((_, itemIndex) => itemIndex !== index))} disabled={rules.length <= 1} aria-label="删除条件">×</button>
    </div>)}</div>
    <button className="add-rule" onClick={() => onChange([...rules, { left: "close", operator: "gt", rightType: "indicator", rightIndicator: "ma20" }])} disabled={rules.length >= 5}>＋ 添加条件</button>
  </section>;
}

function ManualBuilder({ initialDraft, aiGenerated, onSaved }: { initialDraft?: StrategyDraft; aiGenerated?: boolean; onSaved: (strategy: SavedStrategy) => void }) {
  const [draft, setDraft] = useState<StrategyDraft>(initialDraft ?? defaultStrategyDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const summary = useMemo(() => ({
    entry: strategyRuleSummary(draft.entryRules, draft.entryLogic),
    exit: strategyRuleSummary(draft.exitRules, draft.exitLogic),
  }), [draft]);

  const save = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/strategies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const payload = await response.json() as { strategy?: SavedStrategy; error?: string };
      if (!response.ok || !payload.strategy) throw new Error(payload.error || "保存失败");
      onSaved(payload.strategy);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally { setSaving(false); }
  };

  return <div className="studio-builder">
    {aiGenerated && <div className="ai-review-note"><i>✦</i><span><b>AI 已生成结构化策略</b><small>请检查条件后再保存，AI 结果不构成投资建议。</small></span></div>}
    <div className="strategy-basics"><label><span>策略名称</span><input value={draft.name} maxLength={30} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label><span>风格标签</span><input value={draft.tag} maxLength={8} onChange={(event) => setDraft({ ...draft, tag: event.target.value })} /></label><label className="wide"><span>策略说明</span><textarea value={draft.description} maxLength={240} rows={2} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label></div>
    <RuleEditor title="买入条件" tone="buy" rules={draft.entryRules} logic={draft.entryLogic} onChange={(entryRules) => setDraft({ ...draft, entryRules })} onLogicChange={(entryLogic) => setDraft({ ...draft, entryLogic })} />
    <RuleEditor title="卖出条件" tone="sell" rules={draft.exitRules} logic={draft.exitLogic} onChange={(exitRules) => setDraft({ ...draft, exitRules })} onLogicChange={(exitLogic) => setDraft({ ...draft, exitLogic })} />
    <div className="strategy-readable"><b>自然语言检查</b><p><span>买入</span>{summary.entry}</p><p><span>卖出</span>{summary.exit}</p></div>
    {error && <p className="studio-error">{error}</p>}
    <div className="studio-actions"><span>保存后会立即出现在策略引擎中</span><button className="primary-studio-button" onClick={save} disabled={saving}>{saving ? "正在保存…" : "保存并使用策略"}</button></div>
  </div>;
}

function AiCreator({ settings, onSaved }: { settings: AiSettings; onSaved: (strategy: SavedStrategy) => void }) {
  const [prompt, setPrompt] = useState("用5日和20日均线做一个趋势跟随策略，趋势转弱时卖出");
  const [generated, setGenerated] = useState<StrategyDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    if (!settings.apiKey.trim()) { setError("请先关闭窗口，通过页面右上角的 AI 按钮完成接口配置"); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/ai/strategy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, prompt }) });
      const payload = await response.json() as { strategy?: StrategyDraft; error?: string };
      if (!response.ok || !payload.strategy) throw new Error(payload.error || "AI 生成失败");
      setGenerated(payload.strategy);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 生成失败");
    } finally { setLoading(false); }
  };

  let provider = settings.baseUrl || "未配置接口";
  try { provider = new URL(settings.baseUrl).host; } catch { /* keep the configured text */ }

  if (generated) return <ManualBuilder initialDraft={generated} aiGenerated onSaved={onSaved} />;
  return <div className="ai-creator">
    <div className="ai-prompt-card"><div className="ai-orb">✦</div><div><b>描述你的交易想法</b><p>AI 会把自然语言转换为当前回测引擎可以安全执行的指标条件。</p></div></div>
    <div className="ai-connection-summary"><span>当前 AI 连接</span><b>{provider}</b><em>{settings.model || "未配置模型"}</em><i className={settings.apiKey ? "ready" : "missing"}>{settings.apiKey ? "● 已就绪" : "○ 请到右上角配置"}</i></div>
    <label><span>策略需求</span><textarea rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：股价突破20日高点并放量时买入，跌破MA10时卖出" /></label>
    {error && <p className="studio-error">{error}</p>}
    <div className="studio-actions"><span>兼容使用 /chat/completions 的服务</span><button className="ai-generate-button" onClick={generate} disabled={loading || !prompt.trim()}>{loading ? "AI 正在编写策略…" : "✦ 生成可执行策略"}</button></div>
  </div>;
}

function StrategyDocs({ strategies, onDeleted }: { strategies: Array<SavedStrategy & { builtin?: boolean }>; onDeleted: (id: string) => void }) {
  return <div className="strategy-docs">
    <div className="docs-intro"><b>策略如何运行？</b><p>系统每天读取一根真实日K，在收盘价上计算信号。空仓时检查买入条件，持仓时依次检查策略卖出条件、止损和止盈，再按100股整数手进行虚拟撮合。</p><div><span>数据</span>TickFlow 前复权日K <i>→</i><span>信号</span>指标条件 <i>→</i><span>风控</span>仓位/止盈止损 <i>→</i><span>撮合</span>佣金与滑点</div></div>
    <div className="docs-list">{strategies.map((strategy) => <article key={strategy.id}><header><div><b>{strategy.name}</b><em>{strategy.builtin ? "内置" : strategy.tag}</em></div>{!strategy.builtin && <button onClick={() => onDeleted(strategy.id)}>删除</button>}</header><p>{strategy.description}</p><dl><div><dt>买入</dt><dd>{strategyRuleSummary(strategy.entryRules, strategy.entryLogic)}</dd></div><div><dt>卖出</dt><dd>{strategyRuleSummary(strategy.exitRules, strategy.exitLogic)}</dd></div></dl></article>)}</div>
    <div className="docs-risk"><b>回测边界</b><p>当前版本按日线收盘价生成信号，并以同日收盘价加减0.1%滑点模拟成交；佣金为0.025%、最低5元，暂未计入印花税。历史结果不代表未来收益。</p></div>
  </div>;
}

export function StrategyStudio({ mode, strategies, aiSettings, onAiSettingsChange, onCreated, onDeleted, onClose }: StudioProps) {
  if (!mode) return null;
  const titles = { manual: ["新建策略", "使用指标条件搭建策略"], ai: ["AI 创建策略", "使用右上角统一配置的 AI 接口"], docs: ["策略文档", "理解每条规则如何触发"], settings: ["AI 接口配置", "Base URL 与模型会保存到你的账户"] } as const;
  const saveSettings = async () => {
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aiBaseUrl: aiSettings.baseUrl, aiModel: aiSettings.model }) });
    onClose();
  };

  return <div className="studio-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="strategy-studio" role="dialog" aria-modal="true" aria-labelledby="studio-title"><header className="studio-header"><div><span>STRATEGY STUDIO</span><h2 id="studio-title">{titles[mode][0]}</h2><p>{titles[mode][1]}</p></div><button onClick={onClose} aria-label="关闭">×</button></header><div className="studio-body">
    {mode === "manual" && <ManualBuilder onSaved={onCreated} />}
    {mode === "ai" && <AiCreator settings={aiSettings} onSaved={onCreated} />}
    {mode === "docs" && <StrategyDocs strategies={strategies} onDeleted={onDeleted} />}
    {mode === "settings" && <div className="settings-form"><div className="settings-security"><i>⌁</i><div><b>连接由你选择的模型服务</b><p>Base URL 和模型名保存到账号；API Key 只保留在当前页面，刷新后需要重新输入。</p></div></div><label><span>API Base URL</span><input value={aiSettings.baseUrl} onChange={(event) => onAiSettingsChange({ ...aiSettings, baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" /></label><label><span>模型名称</span><input value={aiSettings.model} onChange={(event) => onAiSettingsChange({ ...aiSettings, model: event.target.value })} placeholder="gpt-4.1-mini" /></label><label><span>API Key</span><input type="password" autoComplete="off" value={aiSettings.apiKey} onChange={(event) => onAiSettingsChange({ ...aiSettings, apiKey: event.target.value })} placeholder="仅本次页面会话使用" /></label><div className="studio-actions"><span>请求由 Paper Alpha 服务端转发</span><button className="primary-studio-button" onClick={saveSettings}>保存配置</button></div></div>}
  </div></section></div>;
}
