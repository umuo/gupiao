import { and, count, desc, eq, like, ne, or } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  automationNotificationChannels,
  automationRuns,
  automations,
  customStrategies,
  notificationChannels,
  notificationLogs,
  paperAccounts,
  paperEquitySnapshots,
  paperPositions,
  paperTrades,
  sessions,
  strategyVersions,
  users,
  userSettings,
} from "../../../../db/schema";
import { getAppUser, hashPassword, normalizeEmail, validateEmail } from "../../../auth";

function userView(row: typeof users.$inferSelect, currentUserId?: string) {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt,
    isCurrent: row.id === currentUserId,
  };
}

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const duplicate = message.includes("UNIQUE") || message.toLowerCase().includes("unique");
  return Response.json({ error: duplicate ? "该邮箱已存在" : message }, { status: duplicate ? 409 : 400 });
}

export async function GET(request: Request) {
  const admin = await getAppUser(request);
  if (!admin) return Response.json({ error: "请先登录" }, { status: 401 });
  if (admin.role !== "superadmin") return Response.json({ error: "仅超级管理员可以管理用户" }, { status: 403 });
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(50, Math.max(10, Number(url.searchParams.get("pageSize") ?? 20) || 20));
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 100);
  const where = search ? or(like(users.displayName, `%${search}%`), like(users.email, `%${search}%`)) : undefined;
  const [{ total }] = await getDb().select({ total: count() }).from(users).where(where);
  const rows = await getDb().select().from(users).where(where).orderBy(desc(users.createdAt), desc(users.id)).limit(pageSize).offset((page - 1) * pageSize);
  return Response.json({ users: rows.map((row) => userView(row, admin.userId)), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
}

export async function POST(request: Request) {
  const admin = await getAppUser(request);
  if (!admin) return Response.json({ error: "请先登录" }, { status: 401 });
  if (admin.role !== "superadmin") return Response.json({ error: "仅超级管理员可以创建用户" }, { status: 403 });
  try {
    const payload = await request.json() as { displayName?: string; email?: string; password?: string };
    const displayName = String(payload.displayName ?? "").trim().slice(0, 40);
    const email = normalizeEmail(String(payload.email ?? ""));
    const password = String(payload.password ?? "");
    if (!displayName) throw new Error("请填写用户昵称");
    if (!validateEmail(email)) throw new Error("请输入有效邮箱");
    if (password.length < 8 || password.length > 128) throw new Error("初始密码需要8到128位");
    const [existing] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return Response.json({ error: "该邮箱已存在" }, { status: 409 });
    const passwordResult = await hashPassword(password);
    const [row] = await getDb().insert(users).values({
      id: crypto.randomUUID(),
      email,
      displayName,
      role: "user",
      passwordHash: passwordResult.hash,
      passwordSalt: passwordResult.salt,
    }).returning();
    return Response.json({ user: userView(row, admin.userId) }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "创建用户失败");
  }
}

export async function PATCH(request: Request) {
  const admin = await getAppUser(request);
  if (!admin) return Response.json({ error: "请先登录" }, { status: 401 });
  if (admin.role !== "superadmin") return Response.json({ error: "仅超级管理员可以编辑用户" }, { status: 403 });
  try {
    const payload = await request.json() as { id?: string; displayName?: string; email?: string; password?: string };
    const id = String(payload.id ?? "");
    const [existing] = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) return Response.json({ error: "用户不存在" }, { status: 404 });
    if (existing.role === "superadmin") return Response.json({ error: "超级管理员账号受保护，不能在用户管理中修改" }, { status: 400 });

    const displayName = String(payload.displayName ?? existing.displayName).trim().slice(0, 40);
    const email = normalizeEmail(String(payload.email ?? existing.email));
    const password = String(payload.password ?? "");
    if (!displayName) throw new Error("请填写用户昵称");
    if (!validateEmail(email)) throw new Error("请输入有效邮箱");
    if (password && (password.length < 8 || password.length > 128)) throw new Error("新密码需要8到128位");
    const [duplicate] = await getDb().select({ id: users.id }).from(users).where(and(eq(users.email, email), ne(users.id, id))).limit(1);
    if (duplicate) return Response.json({ error: "该邮箱已存在" }, { status: 409 });

    const changes: Partial<typeof users.$inferInsert> = { displayName, email };
    if (password) {
      const passwordResult = await hashPassword(password);
      changes.passwordHash = passwordResult.hash;
      changes.passwordSalt = passwordResult.salt;
    }
    const db = getDb();
    const [row] = await db.update(users).set(changes).where(eq(users.id, id)).returning();
    if (password) await db.delete(sessions).where(eq(sessions.userId, id));
    return Response.json({ user: userView(row, admin.userId), sessionsRevoked: Boolean(password) });
  } catch (error) {
    return errorResponse(error, "更新用户失败");
  }
}

export async function DELETE(request: Request) {
  const admin = await getAppUser(request);
  if (!admin) return Response.json({ error: "请先登录" }, { status: 401 });
  if (admin.role !== "superadmin") return Response.json({ error: "仅超级管理员可以删除用户" }, { status: 403 });
  try {
    const payload = await request.json() as { id?: string };
    const id = String(payload.id ?? "");
    if (!id) throw new Error("缺少用户 ID");
    if (id === admin.userId) throw new Error("不能删除当前登录的管理员账号");
    const [existing] = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) return Response.json({ error: "用户不存在" }, { status: 404 });
    if (existing.role === "superadmin") throw new Error("超级管理员账号受保护，不能删除");

    const db = getDb();
    await db.batch([
      db.delete(automationNotificationChannels).where(eq(automationNotificationChannels.userId, id)),
      db.delete(automationRuns).where(eq(automationRuns.userId, id)),
      db.delete(notificationLogs).where(eq(notificationLogs.userId, id)),
      db.delete(paperTrades).where(eq(paperTrades.userId, id)),
      db.delete(paperPositions).where(eq(paperPositions.userId, id)),
      db.delete(paperEquitySnapshots).where(eq(paperEquitySnapshots.userId, id)),
      db.delete(automations).where(eq(automations.userId, id)),
      db.delete(notificationChannels).where(eq(notificationChannels.userId, id)),
      db.delete(paperAccounts).where(eq(paperAccounts.userId, id)),
      db.delete(customStrategies).where(eq(customStrategies.userId, id)),
      db.delete(strategyVersions).where(eq(strategyVersions.userId, id)),
      db.delete(userSettings).where(eq(userSettings.userId, id)),
      db.delete(sessions).where(eq(sessions.userId, id)),
      db.delete(users).where(eq(users.id, id)),
    ]);
    return Response.json({ ok: true, deletedUser: { id, displayName: existing.displayName } });
  } catch (error) {
    return errorResponse(error, "删除用户失败");
  }
}
