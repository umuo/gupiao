import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { customStrategies } from "../../../db/schema";
import { getAppUser } from "../../auth";
import { sanitizeStrategyDraft, type SavedStrategy, type StrategyDraft } from "../../strategy-model";

function unauthorized() {
  return Response.json({ error: "请先登录后再管理策略" }, { status: 401 });
}

function rowToStrategy(row: typeof customStrategies.$inferSelect): SavedStrategy {
  const definition = JSON.parse(row.definition) as Pick<StrategyDraft, "entryLogic" | "exitLogic" | "entryRules" | "exitRules">;
  return { id: row.id, name: row.name, description: row.description, tag: row.tag, createdAt: row.createdAt, ...definition };
}

export async function GET(request: Request) {
  const user = await getAppUser(request);
  if (!user) return unauthorized();
  try {
    const rows = await getDb().select().from(customStrategies).where(eq(customStrategies.userId, user.userId)).orderBy(desc(customStrategies.createdAt));
    return Response.json({ strategies: rows.map(rowToStrategy) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取策略失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getAppUser(request);
  if (!user) return unauthorized();
  try {
    const draft = sanitizeStrategyDraft(await request.json());
    const id = crypto.randomUUID();
    const definition = JSON.stringify({ entryLogic: draft.entryLogic, exitLogic: draft.exitLogic, entryRules: draft.entryRules, exitRules: draft.exitRules });
    const [row] = await getDb().insert(customStrategies).values({ id, userId: user.userId, name: draft.name, description: draft.description, tag: draft.tag, definition }).returning();
    return Response.json({ strategy: rowToStrategy(row) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存策略失败";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await getAppUser(request);
  if (!user) return unauthorized();
  const payload = await request.json() as { id?: string };
  if (!payload.id) return Response.json({ error: "缺少策略 ID" }, { status: 400 });
  await getDb().delete(customStrategies).where(and(eq(customStrategies.id, payload.id), eq(customStrategies.userId, user.userId)));
  return Response.json({ ok: true });
}
