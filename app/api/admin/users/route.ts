import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { getAppUser, hashPassword, normalizeEmail, validateEmail } from "../../../auth";

function userView(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt,
  };
}

export async function GET(request: Request) {
  const admin = await getAppUser(request);
  if (!admin) return Response.json({ error: "请先登录" }, { status: 401 });
  if (admin.role !== "superadmin") return Response.json({ error: "仅超级管理员可以管理用户" }, { status: 403 });
  const rows = await getDb().select().from(users).orderBy(desc(users.createdAt)).limit(200);
  return Response.json({ users: rows.map(userView) });
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
    return Response.json({ user: userView(row) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "创建用户失败" }, { status: 400 });
  }
}
