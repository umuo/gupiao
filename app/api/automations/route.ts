import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { automationNotificationChannels, automations, notificationChannels, paperAccounts, paperPositions, userSettings } from "../../../db/schema";
import { getAppUser } from "../../auth";
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
  const [rows, settings, channels, mappings, accounts] = await Promise.all([
    getDb().select().from(automations).where(eq(automations.userId, user.userId)).orderBy(desc(automations.createdAt)),
    getDb().select({ tickflow: userSettings.tickflowApiKeyEncrypted, hint: userSettings.tickflowKeyHint }).from(userSettings).where(eq(userSettings.userId, user.userId)).limit(1),
    getDb().select({ id: notificationChannels.id, name: notificationChannels.name, type: notificationChannels.type, enabled: notificationChannels.enabled }).from(notificationChannels).where(eq(notificationChannels.userId, user.userId)).orderBy(desc(notificationChannels.createdAt)),
    getDb().select().from(automationNotificationChannels).where(eq(automationNotificationChannels.userId, user.userId)),
    getDb().select({ id: paperAccounts.id, name: paperAccounts.name }).from(paperAccounts).where(eq(paperAccounts.userId, user.userId)),
  ]);
  const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const channelsByAutomation = new Map<string, string[]>();
  mappings.forEach((mapping) => channelsByAutomation.set(mapping.automationId, [...(channelsByAutomation.get(mapping.automationId) ?? []), mapping.notificationChannelId]));
  return Response.json({
    automations: rows.map((row) => {
      const notificationChannelIds = channelsByAutomation.get(row.id) ?? [];
      return { ...view(row), paperAccountName: row.paperAccountId ? accountNames.get(row.paperAccountId) ?? "模拟盘已删除" : null, notificationChannelIds, notificationChannelNames: notificationChannelIds.map((id) => channelNames.get(id) ?? "渠道已删除") };
    }),
    channels,
    tickflow: { configured: Boolean(settings[0]?.tickflow), hint: settings[0]?.hint ?? null },
  });
}

export async function POST(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  try {
    const payload = await request.json() as Record<string, unknown>;
    const paperAccountId = String(payload.paperAccountId ?? "").trim() || null;
    const name = String(payload.name ?? "").trim().slice(0, 50);
    let symbol = String(payload.symbol ?? "").trim().toUpperCase();
    let stockName = String(payload.stockName ?? "").trim().slice(0, 30);
    let strategyId = String(payload.strategyId ?? "").trim().slice(0, 100);
    const dataMode = payload.dataMode === "realtime" ? "realtime" : "daily";
    const runTime = String(payload.runTime ?? "09:35");
    const intervalMinutes = Number(payload.intervalMinutes ?? 5);
    const notificationChannelIds = Array.isArray(payload.notificationChannelIds)
      ? [...new Set(payload.notificationChannelIds.map((id) => String(id)).filter(Boolean))].slice(0, 10)
      : [];
    let requestedStopLoss = Number(payload.stopLoss ?? 8);
    let requestedTakeProfit = Number(payload.takeProfit ?? 22);
    let strategy = paperAccountId ? null : sanitizeStrategyDraft(payload.strategy);
    let initialPositionState: "flat" | "holding" = "flat";
    let initialEntryPrice: number | null = null;
    let initialEnabled = true;
    if (paperAccountId) {
      const [account] = await getDb().select().from(paperAccounts).where(and(eq(paperAccounts.id, paperAccountId), eq(paperAccounts.userId, user.userId))).limit(1);
      if (!account) throw new Error("关联的模拟盘不存在");
      const [existingTask] = await getDb().select({ id: automations.id }).from(automations).where(eq(automations.paperAccountId, paperAccountId)).limit(1);
      if (existingTask) throw new Error("该模拟盘已经配置了定时任务");
      const definition = JSON.parse(account.strategyDefinition) as Record<string, unknown>;
      strategy = sanitizeStrategyDraft({ name: account.strategyName, description: "模拟盘关联策略", tag: "模拟盘", ...definition });
      symbol = account.symbol;
      stockName = account.stockName;
      strategyId = account.strategyId;
      requestedStopLoss = account.stopLoss;
      requestedTakeProfit = account.takeProfit;
      initialEnabled = account.status === "active";
      const [position] = await getDb().select({ averageCost: paperPositions.averageCost }).from(paperPositions).where(and(eq(paperPositions.paperAccountId, paperAccountId), eq(paperPositions.userId, user.userId))).limit(1);
      initialPositionState = position ? "holding" : "flat";
      initialEntryPrice = position?.averageCost ?? null;
    }
    if (!Number.isFinite(requestedStopLoss) || !Number.isFinite(requestedTakeProfit)) throw new Error("止损止盈参数无效");
    if (!strategy) throw new Error("策略配置无效");
    const stopLoss = Math.min(100, Math.max(0.1, requestedStopLoss));
    const takeProfit = Math.min(500, Math.max(0.1, requestedTakeProfit));
    if (!name || !stockName || !strategyId || !SYMBOL_PATTERN.test(symbol)) throw new Error("请完整选择股票和策略");
    if (!TIME_PATTERN.test(runTime)) throw new Error("执行时间格式无效");
    if (!INTERVALS.has(intervalMinutes)) throw new Error("实时检查间隔无效");
    if (!notificationChannelIds.length) throw new Error("请至少选择一个已启用的通知渠道");
    const selectedChannels = await getDb().select().from(notificationChannels).where(and(eq(notificationChannels.userId, user.userId), inArray(notificationChannels.id, notificationChannelIds)));
    if (selectedChannels.length !== notificationChannelIds.length || selectedChannels.some((channel) => !channel.enabled)) throw new Error("所选通知渠道不存在或已停用");
    if (dataMode === "realtime") {
      const [settings] = await getDb().select({ key: userSettings.tickflowApiKeyEncrypted }).from(userSettings).where(eq(userSettings.userId, user.userId)).limit(1);
      if (!settings?.key) throw new Error("实时任务需要先配置 TickFlow Key");
    }
    const definition = JSON.stringify({ entryLogic: strategy.entryLogic, exitLogic: strategy.exitLogic, entryRules: strategy.entryRules, exitRules: strategy.exitRules });
    const [row] = await getDb().insert(automations).values({
      id: crypto.randomUUID(),
      userId: user.userId,
      paperAccountId,
      name,
      symbol,
      stockName,
      strategyId,
      strategyName: strategy.name,
      strategyDefinition: definition,
      dataMode,
      runTime,
      intervalMinutes,
      stopLoss,
      takeProfit,
      positionState: initialPositionState,
      entryPrice: initialEntryPrice,
      enabled: initialEnabled,
    }).returning();
    try {
      await getDb().insert(automationNotificationChannels).values(notificationChannelIds.map((notificationChannelId) => ({
        id: crypto.randomUUID(), userId: user.userId, automationId: row.id, notificationChannelId,
      })));
    } catch (error) {
      await getDb().delete(automations).where(eq(automations.id, row.id));
      throw error;
    }
    return Response.json({ automation: view(row) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "创建任务失败" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const payload = await request.json() as { id?: string; name?: unknown; enabled?: boolean; resetPosition?: boolean; notificationChannelIds?: unknown; dataMode?: unknown; runTime?: unknown; intervalMinutes?: unknown };
  if (!payload.id) return Response.json({ error: "缺少任务 ID" }, { status: 400 });
  const [existingTask] = await getDb().select().from(automations).where(and(eq(automations.id, payload.id), eq(automations.userId, user.userId))).limit(1);
  if (!existingTask) return Response.json({ error: "任务不存在" }, { status: 404 });
  let nextChannelIds: string[] | null = null;
  if (payload.notificationChannelIds !== undefined) {
    if (!Array.isArray(payload.notificationChannelIds)) return Response.json({ error: "通知渠道格式无效" }, { status: 400 });
    nextChannelIds = [...new Set(payload.notificationChannelIds.map((id) => String(id)).filter(Boolean))].slice(0, 10);
    if (!nextChannelIds.length) return Response.json({ error: "请至少保留一个通知渠道" }, { status: 400 });
    const selected = await getDb().select({ id: notificationChannels.id, enabled: notificationChannels.enabled }).from(notificationChannels).where(and(eq(notificationChannels.userId, user.userId), inArray(notificationChannels.id, nextChannelIds)));
    if (selected.length !== nextChannelIds.length || selected.some((channel) => !channel.enabled)) return Response.json({ error: "所选通知渠道不存在或已停用" }, { status: 400 });
  }
  const changes: Partial<typeof automations.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (typeof payload.enabled === "boolean") changes.enabled = payload.enabled;
  if (payload.name !== undefined) {
    const name = String(payload.name).trim().slice(0, 50);
    if (!name) return Response.json({ error: "请填写任务名称" }, { status: 400 });
    changes.name = name;
  }
  if (payload.dataMode !== undefined) {
    const dataMode = payload.dataMode === "realtime" ? "realtime" : "daily";
    if (dataMode === "realtime") {
      const [settings] = await getDb().select({ key: userSettings.tickflowApiKeyEncrypted }).from(userSettings).where(eq(userSettings.userId, user.userId)).limit(1);
      if (!settings?.key) return Response.json({ error: "实时任务需要先配置 TickFlow Key" }, { status: 400 });
    }
    changes.dataMode = dataMode;
  }
  if (payload.runTime !== undefined) {
    const runTime = String(payload.runTime);
    if (!TIME_PATTERN.test(runTime)) return Response.json({ error: "执行时间格式无效" }, { status: 400 });
    changes.runTime = runTime;
  }
  if (payload.intervalMinutes !== undefined) {
    const intervalMinutes = Number(payload.intervalMinutes);
    if (!INTERVALS.has(intervalMinutes)) return Response.json({ error: "实时检查间隔无效" }, { status: 400 });
    changes.intervalMinutes = intervalMinutes;
  }
  if (payload.resetPosition) {
    if (existingTask.paperAccountId) return Response.json({ error: "关联模拟盘的持仓需要通过策略成交变更，不能在任务中重置" }, { status: 400 });
    changes.positionState = "flat";
    changes.entryPrice = null;
    changes.lastSignalKey = null;
  }
  const [row] = await getDb().update(automations).set(changes).where(and(eq(automations.id, payload.id), eq(automations.userId, user.userId))).returning();
  if (nextChannelIds) {
    const current = await getDb().select().from(automationNotificationChannels).where(and(eq(automationNotificationChannels.automationId, row.id), eq(automationNotificationChannels.userId, user.userId)));
    const removeIds = current.filter((mapping) => !nextChannelIds.includes(mapping.notificationChannelId)).map((mapping) => mapping.id);
    const addIds = nextChannelIds.filter((id) => !current.some((mapping) => mapping.notificationChannelId === id));
    if (removeIds.length) await getDb().delete(automationNotificationChannels).where(inArray(automationNotificationChannels.id, removeIds));
    if (addIds.length) await getDb().insert(automationNotificationChannels).values(addIds.map((notificationChannelId) => ({ id: crypto.randomUUID(), userId: user.userId, automationId: row.id, notificationChannelId })));
  }
  return Response.json({ automation: view(row) });
}

export async function DELETE(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const payload = await request.json() as { id?: string };
  if (!payload.id) return Response.json({ error: "缺少任务 ID" }, { status: 400 });
  await getDb().delete(automationNotificationChannels).where(and(eq(automationNotificationChannels.automationId, payload.id), eq(automationNotificationChannels.userId, user.userId)));
  await getDb().delete(automations).where(and(eq(automations.id, payload.id), eq(automations.userId, user.userId)));
  return Response.json({ ok: true });
}
