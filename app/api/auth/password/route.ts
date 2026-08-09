import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { sessions, users } from "../../../../db/schema";
import { clearSessionCookie, getAppUser, hashPassword, verifyPassword } from "../../../auth";
import { clearLoginChallengeCookie, createLoginEncryptionOffer, decryptLoginEnvelope, type LoginEnvelope } from "../../../login-crypto";

const PASSWORD_CHALLENGE_PATH = "/api/auth/password";

function clearChallengeResponse(error: unknown, request: Request) {
  return Response.json(
    { error: error instanceof Error ? error.message : "修改管理员密码失败" },
    { status: 400, headers: { "Cache-Control": "no-store", "Set-Cookie": clearLoginChallengeCookie(request, PASSWORD_CHALLENGE_PATH) } },
  );
}

export async function GET(request: Request) {
  const admin = await getAppUser(request);
  if (!admin) return Response.json({ error: "请先登录" }, { status: 401 });
  if (admin.role !== "superadmin") return Response.json({ error: "仅超级管理员可以修改管理员密码" }, { status: 403 });
  try {
    const offer = await createLoginEncryptionOffer(request, PASSWORD_CHALLENGE_PATH);
    return Response.json(offer.payload, { headers: { "Cache-Control": "no-store", "Set-Cookie": offer.cookie } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法初始化安全加密" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const admin = await getAppUser(request);
  if (!admin) return Response.json({ error: "请先登录" }, { status: 401 });
  if (admin.role !== "superadmin") return Response.json({ error: "仅超级管理员可以修改管理员密码" }, { status: 403 });
  try {
    const credentials = await decryptLoginEnvelope(request, await request.json() as LoginEnvelope);
    const currentPassword = credentials.password;
    const newPassword = credentials.newPassword ?? "";
    if (!currentPassword || currentPassword.length > 128) throw new Error("请输入当前密码");
    if (newPassword.length < 12 || newPassword.length > 128) throw new Error("管理员新密码需要12到128位");

    const db = getDb();
    const [current] = await db.select().from(users).where(eq(users.id, admin.userId)).limit(1);
    if (!current || current.role !== "superadmin") throw new Error("管理员账号不存在或权限已变更");
    if (!(await verifyPassword(currentPassword, current.passwordSalt, current.passwordHash))) throw new Error("当前密码不正确");
    if (await verifyPassword(newPassword, current.passwordSalt, current.passwordHash)) throw new Error("新密码不能与当前密码相同");

    const passwordResult = await hashPassword(newPassword);
    await db.batch([
      db.update(users).set({ passwordHash: passwordResult.hash, passwordSalt: passwordResult.salt }).where(eq(users.id, admin.userId)),
      db.delete(sessions).where(eq(sessions.userId, admin.userId)),
    ]);
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", clearLoginChallengeCookie(request, PASSWORD_CHALLENGE_PATH));
    headers.append("Set-Cookie", clearSessionCookie(request));
    return Response.json({ ok: true, reauthRequired: true }, { headers });
  } catch (error) {
    return clearChallengeResponse(error, request);
  }
}
