import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { createSession, ensureDefaultAdmin, normalizeEmail, verifyPassword } from "../../../auth";

export async function POST(request: Request) {
  try {
    if (!(await ensureDefaultAdmin())) return Response.json({ error: "管理员账户尚未完成服务器初始化" }, { status: 503 });
    const payload = await request.json() as { email?: string; password?: string };
    const email = normalizeEmail(String(payload.email ?? ""));
    const password = String(payload.password ?? "");
    const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !(await verifyPassword(password, user.passwordSalt, user.passwordHash))) return Response.json({ error: "邮箱或密码不正确" }, { status: 401 });
    const session = await createSession(user.id, request);
    return Response.json({ user: { userId: user.id, email: user.email, displayName: user.displayName, role: user.role } }, { headers: { "Set-Cookie": session.cookie } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "登录失败" }, { status: 400 });
  }
}
