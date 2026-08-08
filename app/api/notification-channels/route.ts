import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { automations, notificationChannels } from "../../../db/schema";
import { getAppUser } from "../../auth";
import {
  defaultMessageTemplate,
  normalizeMessageTemplate,
  normalizeNotificationContentType,
  normalizeNotificationHeaders,
  normalizeNotificationMethod,
} from "../../notification-model";
import { assertPublicHttpsUrl } from "../../public-url";
import { encryptSecret } from "../../secret-box";

function channelView(row: typeof notificationChannels.$inferSelect) {
  let headerNames: string[] = [];
  try { headerNames = JSON.parse(row.headerNames) as string[]; } catch { /* use empty list */ }
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    method: row.method,
    headerNames,
    contentType: row.contentType,
    messageTemplate: row.messageTemplate,
    enabled: row.enabled,
    lastTestAt: row.lastTestAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function GET(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const rows = await getDb().select().from(notificationChannels).where(eq(notificationChannels.userId, user.userId)).orderBy(desc(notificationChannels.createdAt));
  return Response.json({ channels: rows.map(channelView), defaultTemplate: defaultMessageTemplate });
}

export async function POST(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  try {
    const payload = await request.json() as Record<string, unknown>;
    const name = String(payload.name ?? "").trim().slice(0, 50);
    const rawUrl = String(payload.url ?? "").trim();
    if (!name) throw new Error("请填写通知渠道名称");
    if (rawUrl.length > 2_000) throw new Error("Webhook URL 过长");
    const url = assertPublicHttpsUrl(rawUrl, "Webhook URL").href;
    const method = normalizeNotificationMethod(payload.method);
    const contentType = normalizeNotificationContentType(payload.contentType);
    const messageTemplate = normalizeMessageTemplate(payload.messageTemplate);
    const headers = normalizeNotificationHeaders(payload.headers ?? []);
    const [row] = await getDb().insert(notificationChannels).values({
      id: crypto.randomUUID(),
      userId: user.userId,
      name,
      url,
      method,
      headersEncrypted: await encryptSecret(JSON.stringify(headers)),
      headerNames: JSON.stringify(headers.map((header) => header.name)),
      contentType,
      messageTemplate,
    }).returning();
    return Response.json({ channel: channelView(row) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存通知渠道失败" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = String(payload.id ?? "");
    if (!id) throw new Error("缺少通知渠道 ID");
    const [current] = await getDb().select().from(notificationChannels).where(and(eq(notificationChannels.id, id), eq(notificationChannels.userId, user.userId))).limit(1);
    if (!current) return Response.json({ error: "通知渠道不存在" }, { status: 404 });
    const changes: Partial<typeof notificationChannels.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (typeof payload.enabled === "boolean") changes.enabled = payload.enabled;
    if (payload.name !== undefined) {
      const name = String(payload.name).trim().slice(0, 50);
      if (!name) throw new Error("通知渠道名称不能为空");
      changes.name = name;
    }
    if (payload.url !== undefined) {
      const rawUrl = String(payload.url).trim();
      if (rawUrl.length > 2_000) throw new Error("Webhook URL 过长");
      changes.url = assertPublicHttpsUrl(rawUrl, "Webhook URL").href;
    }
    if (payload.method !== undefined) changes.method = normalizeNotificationMethod(payload.method);
    if (payload.contentType !== undefined) changes.contentType = normalizeNotificationContentType(payload.contentType);
    if (payload.messageTemplate !== undefined) changes.messageTemplate = normalizeMessageTemplate(payload.messageTemplate);
    if (payload.headers !== undefined) {
      const headers = normalizeNotificationHeaders(payload.headers);
      changes.headersEncrypted = await encryptSecret(JSON.stringify(headers));
      changes.headerNames = JSON.stringify(headers.map((header) => header.name));
    }
    const [row] = await getDb().update(notificationChannels).set(changes).where(eq(notificationChannels.id, id)).returning();
    return Response.json({ channel: channelView(row) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "更新通知渠道失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const payload = await request.json() as { id?: string };
  if (!payload.id) return Response.json({ error: "缺少通知渠道 ID" }, { status: 400 });
  const [used] = await getDb().select({ id: automations.id }).from(automations).where(and(eq(automations.userId, user.userId), eq(automations.notificationChannelId, payload.id))).limit(1);
  if (used) return Response.json({ error: "该通知渠道仍被定时任务使用，请先删除或调整相关任务" }, { status: 409 });
  await getDb().delete(notificationChannels).where(and(eq(notificationChannels.id, payload.id), eq(notificationChannels.userId, user.userId)));
  return Response.json({ ok: true });
}
