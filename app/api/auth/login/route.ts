import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { createSession, ensureDefaultAdmin, normalizeEmail, verifyPassword } from "../../../auth";
import { clearLoginChallengeCookie, createLoginEncryptionOffer, decryptLoginEnvelope, type LoginEnvelope } from "../../../login-crypto";

export async function GET(request: Request) {
  try {
    const offer = await createLoginEncryptionOffer(request);
    return Response.json(offer.payload, {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": offer.cookie,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法初始化登录加密" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    if (!(await ensureDefaultAdmin())) return Response.json({ error: "管理员账户尚未完成服务器初始化" }, { status: 503 });
    const credentials = await decryptLoginEnvelope(request, await request.json() as LoginEnvelope);
    const email = normalizeEmail(credentials.email);
    const password = credentials.password;
    const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !(await verifyPassword(password, user.passwordSalt, user.passwordHash))) {
      return Response.json({ error: "邮箱或密码不正确" }, { status: 401, headers: { "Set-Cookie": clearLoginChallengeCookie(request) } });
    }
    const session = await createSession(user.id, request);
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", session.cookie);
    headers.append("Set-Cookie", clearLoginChallengeCookie(request));
    return Response.json({ user: { userId: user.id, email: user.email, displayName: user.displayName, role: user.role } }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "登录失败" }, { status: 400, headers: { "Set-Cookie": clearLoginChallengeCookie(request) } });
  }
}
