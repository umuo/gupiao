import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { notificationChannels, notificationLogs } from "../../../../db/schema";
import { getAppUser } from "../../../auth";
import { deliverNotification } from "../../../notification-delivery";

export async function POST(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const payload = await request.json() as { id?: string };
  if (!payload.id) return Response.json({ error: "缺少通知渠道 ID" }, { status: 400 });
  const [channel] = await getDb().select().from(notificationChannels).where(and(eq(notificationChannels.id, payload.id), eq(notificationChannels.userId, user.userId))).limit(1);
  if (!channel) return Response.json({ error: "通知渠道不存在" }, { status: 404 });
  const now = new Date();
  const variables = {
    action: "test",
    actionText: "测试",
    automationName: "通知渠道测试",
    stockName: "建设银行",
    symbol: "601939.SH",
    strategyName: "示例策略",
    price: 8.88,
    reason: "这是一条 Webhook 测试消息",
    dataMode: "test",
    source: "Paper Alpha",
    marketTime: now.toISOString(),
    sentAt: now.toISOString(),
  };
  try {
    const result = await deliverNotification(channel, variables);
    await getDb().insert(notificationLogs).values({
      id: crypto.randomUUID(), userId: user.userId, notificationChannelId: channel.id,
      type: "test", status: result.ok ? "success" : "failed", symbol: "601939.SH", price: 8.88,
      reason: result.ok ? "Webhook 测试成功" : `Webhook 返回 HTTP ${result.status}`,
      payload: JSON.stringify({ rendered: result.rendered }), httpStatus: result.status,
    });
    await getDb().update(notificationChannels).set({ lastTestAt: now.toISOString(), updatedAt: now.toISOString() }).where(eq(notificationChannels.id, channel.id));
    if (!result.ok) return Response.json({ error: `Webhook 返回 HTTP ${result.status}` }, { status: 502 });
    return Response.json({ ok: true, httpStatus: result.status });
  } catch (error) {
    await getDb().insert(notificationLogs).values({
      id: crypto.randomUUID(), userId: user.userId, notificationChannelId: channel.id,
      type: "test", status: "failed", symbol: "601939.SH", reason: error instanceof Error ? error.message : "Webhook 测试失败",
      payload: "{}",
    });
    await getDb().update(notificationChannels).set({ lastTestAt: now.toISOString(), updatedAt: now.toISOString() }).where(eq(notificationChannels.id, channel.id));
    return Response.json({ error: error instanceof Error ? error.message : "Webhook 测试失败" }, { status: 502 });
  }
}
