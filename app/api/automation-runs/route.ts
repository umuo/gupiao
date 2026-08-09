import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { automationRuns, automations } from "../../../db/schema";
import { getAppUser } from "../../auth";

function parseCursor(value: string | null) {
  if (!value) return null;
  const separator = value.indexOf("|");
  if (separator < 1) return null;
  const createdAt = value.slice(0, separator);
  const id = value.slice(separator + 1);
  return createdAt && id ? { createdAt, id } : null;
}

export async function GET(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const url = new URL(request.url);
  const automationId = url.searchParams.get("automationId")?.trim() || null;
  const cursor = parseCursor(url.searchParams.get("cursor"));
  const limit = Math.min(50, Math.max(5, Number(url.searchParams.get("limit") ?? 20) || 20));
  const conditions = [eq(automationRuns.userId, user.userId)];
  if (automationId) conditions.push(eq(automationRuns.automationId, automationId));
  if (cursor) conditions.push(or(
    lt(automationRuns.createdAt, cursor.createdAt),
    and(eq(automationRuns.createdAt, cursor.createdAt), lt(automationRuns.id, cursor.id)),
  )!);
  const rows = await getDb().select().from(automationRuns).where(and(...conditions)).orderBy(desc(automationRuns.createdAt), desc(automationRuns.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const automationIds = [...new Set(page.map((item) => item.automationId))];
  const taskRows = automationIds.length
    ? await getDb().select({ id: automations.id, name: automations.name, symbol: automations.symbol, stockName: automations.stockName }).from(automations).where(and(eq(automations.userId, user.userId), inArray(automations.id, automationIds)))
    : [];
  const tasks = new Map(taskRows.map((item) => [item.id, item]));
  const last = page.at(-1);
  return Response.json({
    runs: page.map((item) => ({ ...item, automation: tasks.get(item.automationId) ?? null })),
    nextCursor: rows.length > limit && last ? `${last.createdAt}|${last.id}` : null,
  });
}
