import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { customStrategies, strategyVersions } from "../../../db/schema";
import { getAppUser } from "../../auth";
import { sanitizeStrategyDraft, type SavedStrategy, type StrategyDraft } from "../../strategy-model";
import { strategyDefinitionJson, strategySnapshotHash } from "../../strategy-version";

function unauthorized() {
  return Response.json({ error: "请先登录后再管理策略" }, { status: 401 });
}

function rowToStrategy(row: typeof customStrategies.$inferSelect): SavedStrategy {
  const definition = JSON.parse(row.definition) as Pick<StrategyDraft, "entryLogic" | "exitLogic" | "entryRules" | "exitRules">;
  return { id: row.id, name: row.name, description: row.description, tag: row.tag, createdAt: row.createdAt, version: row.currentVersion, ...definition };
}

export async function GET(request: Request) {
  const user = await getAppUser(request);
  if (!user) return unauthorized();
  try {
    const [rows, versions] = await Promise.all([
      getDb().select().from(customStrategies).where(eq(customStrategies.userId, user.userId)).orderBy(desc(customStrategies.createdAt)),
      getDb().select({ strategyId: strategyVersions.strategyId, version: strategyVersions.version, contentHash: strategyVersions.contentHash }).from(strategyVersions).where(eq(strategyVersions.userId, user.userId)),
    ]);
    const versionHashes = new Map(versions.map((item) => [`${item.strategyId}:${item.version}`, item.contentHash]));
    return Response.json({ strategies: rows.map((row) => ({ ...rowToStrategy(row), contentHash: versionHashes.get(`${row.id}:${row.currentVersion}`) })) });
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
    const definition = strategyDefinitionJson(draft);
    const contentHash = await strategySnapshotHash(draft);
    const db = getDb();
    const [created] = await db.batch([
      db.insert(customStrategies).values({ id, userId: user.userId, name: draft.name, description: draft.description, tag: draft.tag, definition, currentVersion: 1 }).returning(),
      db.insert(strategyVersions).values({ id: crypto.randomUUID(), userId: user.userId, strategyId: id, version: 1, name: draft.name, description: draft.description, tag: draft.tag, definition, contentHash }),
    ]);
    const row = created[0];
    return Response.json({ strategy: { ...rowToStrategy(row), contentHash } }, { status: 201 });
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
  const db = getDb();
  await db.batch([
    db.delete(strategyVersions).where(and(eq(strategyVersions.strategyId, payload.id), eq(strategyVersions.userId, user.userId))),
    db.delete(customStrategies).where(and(eq(customStrategies.id, payload.id), eq(customStrategies.userId, user.userId))),
  ]);
  return Response.json({ ok: true });
}
