import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { automations, userSettings } from "../../../db/schema";
import { getAppUser } from "../../auth";
import { assertPublicHttpsUrl } from "../../public-url";
import { sanitizeStrategyDraft } from "../../strategy-model";

const SYMBOL_PATTERN = /^\d{6}\.(SH|SZ|BJ)$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const INTERVALS = new Set([1, 5, 15, 30, 60]);

function view(row: typeof automations.$inferSelect) {
  return { ...row, strategyDefinition: JSON.parse(row.strategyDefinition), weekdays: JSON.parse(row.weekdays) };
}

export async function GET(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const [rows, settings] = await Promise.all([
    getDb().select().from(automations).where(eq(automations.userId, user.userId)).orderBy(desc(automations.createdAt)),
    getDb().select({ tickflow: userSettings.tickflowApiKeyEncrypted, hint: userSettings.tickflowKeyHint }).from(userSettings).where(eq(userSettings.userId, user.userId)).limit(1),
  ]);
  return Response.json({ automations: rows.map(view), tickflow: { configured: Boolean(settings[0]?.tickflow), hint: settings[0]?.hint ?? null } });
}

export async function POST(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  try {
    const payload = await request.json() as Record<string, unknown>;
    const name = String(payload.name ?? "").trim().slice(0, 50);
    const symbol = String(payload.symbol ?? "").trim().toUpperCase();
    const stockName = String(payload.stockName ?? "").trim().slice(0, 30);
    const strategyId = String(payload.strategyId ?? "").trim().slice(0, 100);
    const dataMode = payload.dataMode === "realtime" ? "realtime" : "daily";
    const runTime = String(payload.runTime ?? "09:35");
    const intervalMinutes = Number(payload.intervalMinutes ?? 5);
    const rawWebhookUrl = String(payload.webhookUrl ?? "").trim();
    if (rawWebhookUrl.length > 2_000) throw new Error("Webhook 地址过长");
    const webhookUrl = assertPublicHttpsUrl(rawWebhookUrl).href;
    const stopLoss = Math.min(100, Math.max(0.1, Number(payload.stopLoss ?? 8)));
    const takeProfit = Math.min(500, Math.max(0.1, Number(payload.takeProfit ?? 22)));
    const strategy = sanitizeStrategyDraft(payload.strategy);
    if (!name || !stockName || !strategyId || !SYMBOL_PATTERN.test(symbol)) throw new Error("请完整选择股票和策略");
    if (!TIME_PATTERN.test(runTime)) throw new Error("执行时间格式无效");
    if (!INTERVALS.has(intervalMinutes)) throw new Error("实时检查间隔无效");
    if (dataMode === "realtime") {
      const [settings] = await getDb().select({ key: userSettings.tickflowApiKeyEncrypted }).from(userSettings).where(eq(userSettings.userId, user.userId)).limit(1);
      if (!settings?.key) throw new Error("实时任务需要先配置 TickFlow Key");
    }
    const definition = JSON.stringify({ entryLogic: strategy.entryLogic, exitLogic: strategy.exitLogic, entryRules: strategy.entryRules, exitRules: strategy.exitRules });
    const [row] = await getDb().insert(automations).values({
      id: crypto.randomUUID(),
      userId: user.userId,
      name,
      symbol,
      stockName,
      strategyId,
      strategyName: strategy.name,
      strategyDefinition: definition,
      dataMode,
      runTime,
      intervalMinutes,
      webhookUrl,
      stopLoss,
      takeProfit,
    }).returning();
    return Response.json({ automation: view(row) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "创建任务失败" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const payload = await request.json() as { id?: string; enabled?: boolean; resetPosition?: boolean };
  if (!payload.id) return Response.json({ error: "缺少任务 ID" }, { status: 400 });
  const changes: Partial<typeof automations.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (typeof payload.enabled === "boolean") changes.enabled = payload.enabled;
  if (payload.resetPosition) {
    changes.positionState = "flat";
    changes.entryPrice = null;
    changes.lastSignalKey = null;
  }
  const [row] = await getDb().update(automations).set(changes).where(and(eq(automations.id, payload.id), eq(automations.userId, user.userId))).returning();
  if (!row) return Response.json({ error: "任务不存在" }, { status: 404 });
  return Response.json({ automation: view(row) });
}

export async function DELETE(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const payload = await request.json() as { id?: string };
  if (!payload.id) return Response.json({ error: "缺少任务 ID" }, { status: 400 });
  await getDb().delete(automations).where(and(eq(automations.id, payload.id), eq(automations.userId, user.userId)));
  return Response.json({ ok: true });
}
