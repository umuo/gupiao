import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { userSettings } from "../../../db/schema";
import { getAppUser } from "../../auth";

const defaults = { aiBaseUrl: "https://api.openai.com/v1", aiModel: "gpt-4.1-mini" };

export async function GET(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const [settings] = await getDb().select().from(userSettings).where(eq(userSettings.userId, user.userId)).limit(1);
  return Response.json({ settings: settings ? { aiBaseUrl: settings.aiBaseUrl, aiModel: settings.aiModel } : defaults });
}

export async function PUT(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const payload = await request.json() as { aiBaseUrl?: string; aiModel?: string };
  const aiBaseUrl = String(payload.aiBaseUrl ?? "").trim().slice(0, 500);
  const aiModel = String(payload.aiModel ?? "").trim().slice(0, 120);
  if (!aiBaseUrl || !aiModel) return Response.json({ error: "API 地址和模型不能为空" }, { status: 400 });
  await getDb().insert(userSettings).values({ userId: user.userId, aiBaseUrl, aiModel }).onConflictDoUpdate({ target: userSettings.userId, set: { aiBaseUrl, aiModel, updatedAt: new Date().toISOString() } });
  return Response.json({ settings: { aiBaseUrl, aiModel } });
}
