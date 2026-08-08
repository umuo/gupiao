import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { userSettings } from "../../../../db/schema";
import { getAppUser } from "../../../auth";
import { encryptSecret } from "../../../secret-box";
import { fetchTickFlowQuote } from "../../../tickflow-client";

export async function GET(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const [settings] = await getDb().select({ encrypted: userSettings.tickflowApiKeyEncrypted, hint: userSettings.tickflowKeyHint }).from(userSettings).where(eq(userSettings.userId, user.userId)).limit(1);
  return Response.json({ configured: Boolean(settings?.encrypted), hint: settings?.hint ?? null });
}

export async function PUT(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  try {
    const payload = await request.json() as { apiKey?: string };
    const apiKey = String(payload.apiKey ?? "").trim();
    if (apiKey.length < 8 || apiKey.length > 500) return Response.json({ error: "请输入有效的 TickFlow Key" }, { status: 400 });
    await fetchTickFlowQuote("601939.SH", apiKey);
    const encrypted = await encryptSecret(apiKey);
    const hint = `••••${apiKey.slice(-4)}`;
    await getDb().insert(userSettings).values({ userId: user.userId, tickflowApiKeyEncrypted: encrypted, tickflowKeyHint: hint }).onConflictDoUpdate({
      target: userSettings.userId,
      set: { tickflowApiKeyEncrypted: encrypted, tickflowKeyHint: hint, updatedAt: new Date().toISOString() },
    });
    return Response.json({ configured: true, hint });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "TickFlow Key 保存失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  await getDb().insert(userSettings).values({ userId: user.userId, tickflowApiKeyEncrypted: null, tickflowKeyHint: null }).onConflictDoUpdate({
    target: userSettings.userId,
    set: { tickflowApiKeyEncrypted: null, tickflowKeyHint: null, updatedAt: new Date().toISOString() },
  });
  return Response.json({ configured: false, hint: null });
}
