import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { createSession, hashPassword, normalizeEmail, validateEmail } from "../../../auth";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { displayName?: string; email?: string; password?: string };
    const displayName = String(payload.displayName ?? "").trim().slice(0, 40);
    const email = normalizeEmail(String(payload.email ?? ""));
    const password = String(payload.password ?? "");
    if (!displayName) throw new Error("请填写昵称");
    if (!validateEmail(email)) throw new Error("请输入有效邮箱");
    if (password.length < 8 || password.length > 128) throw new Error("密码需要8到128位");
    const db = getDb();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return Response.json({ error: "该邮箱已经注册" }, { status: 409 });
    const [firstUser] = await db.select({ id: users.id }).from(users).limit(1);
    const role = firstUser ? "user" : "superadmin";
    const userId = crypto.randomUUID();
    const passwordResult = await hashPassword(password);
    await db.insert(users).values({ id: userId, email, displayName, role, passwordHash: passwordResult.hash, passwordSalt: passwordResult.salt });
    const session = await createSession(userId, request);
    return Response.json({ user: { userId, email, displayName, role } }, { status: 201, headers: { "Set-Cookie": session.cookie } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "注册失败" }, { status: 400 });
  }
}
