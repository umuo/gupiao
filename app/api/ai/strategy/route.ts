import { getAppUser } from "../../../auth";
import { sanitizeStrategyDraft } from "../../../strategy-model";

function compatibleEndpoint(baseUrl: string) {
  const raw = baseUrl.trim().replace(/\/+$/, "");
  const url = new URL(raw.endsWith("/chat/completions") ? raw : `${raw}/chat/completions`);
  if (url.protocol !== "https:") throw new Error("API Base URL 必须使用 HTTPS");
  const host = url.hostname.toLowerCase();
  const blocked = host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error("API 地址不能指向本地或内网服务");
  return url.toString();
}

function extractJson(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? content).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回有效的策略 JSON");
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

export async function POST(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录后使用 AI 创建策略" }, { status: 401 });
  try {
    const payload = await request.json() as { baseUrl?: string; model?: string; apiKey?: string; prompt?: string };
    const endpoint = compatibleEndpoint(String(payload.baseUrl ?? ""));
    const apiKey = String(payload.apiKey ?? "").trim();
    const model = String(payload.model ?? "").trim();
    const prompt = String(payload.prompt ?? "").trim().slice(0, 2000);
    if (!apiKey || !model || !prompt) throw new Error("API Key、模型和策略描述都不能为空");

    const systemPrompt = `你是A股日线量化策略设计助手。把用户想法转换成纯JSON，不要Markdown，不要解释。\nJSON结构：{"name":"30字以内","description":"240字以内","tag":"8字以内","entryLogic":"and或or","exitLogic":"and或or","entryRules":[规则],"exitRules":[规则]}。\n每条规则结构：{"left":"指标","operator":"操作符","rightType":"indicator或value","rightIndicator":"指标（rightType为indicator时）","rightValue":数值（rightType为value时）}。\n允许指标：close, open, ma5, ma10, ma20, rsi14, volatility20（百分数，如1.8表示1.8%）, volumeRatio20, highest20。允许操作符：gt, lt, crossesAbove, crossesBelow。买卖条件各1到5条。只能使用这些字段和枚举，不得生成代码。`;
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: 1200, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }] }),
    });
    const rawText = await upstream.text();
    if (!upstream.ok) {
      let detail = `接口返回 ${upstream.status}`;
      try { const parsed = JSON.parse(rawText) as { error?: { message?: string } | string }; detail = typeof parsed.error === "string" ? parsed.error : parsed.error?.message || detail; } catch { /* use status only */ }
      throw new Error(detail.slice(0, 300));
    }
    const response = JSON.parse(rawText) as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
    const content = response.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((item) => item.text ?? "").join("") : "";
    const strategy = sanitizeStrategyDraft(extractJson(text));
    return Response.json({ strategy });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 生成策略失败";
    return Response.json({ error: message }, { status: 400 });
  }
}
