"use client";

import { useState } from "react";

type AuthUser = { userId: string; displayName: string; email: string; role: "user" | "superadmin" };
type LoginEncryptionOffer = {
  version: string;
  keyId: string;
  challenge: string;
  publicKey: JsonWebKey;
  error?: string;
};

function bytesToBase64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function encryptLoginCredentials(email: string, password: string) {
  const keyResponse = await fetch("/api/auth/login", { cache: "no-store", credentials: "same-origin" });
  const offer = await keyResponse.json() as LoginEncryptionOffer;
  if (!keyResponse.ok || !offer.publicKey || !offer.challenge || !offer.keyId) throw new Error(offer.error || "无法初始化登录加密");

  const rsaKey = await crypto.subtle.importKey("jwk", offer.publicKey, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const rawAesKey = await crypto.subtle.exportKey("raw", aesKey);
  const encryptedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsaKey, rawAesKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ email, password, challenge: offer.challenge, issuedAt: Date.now() }));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(offer.keyId) },
    aesKey,
    plaintext,
  );
  return {
    version: offer.version,
    keyId: offer.keyId,
    encryptedKey: bytesToBase64Url(encryptedKey),
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(ciphertext),
  };
}

export function AuthGate({ adminReady, onAuthenticated }: { adminReady: boolean; onAuthenticated: (user: AuthUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const encryptedCredentials = await encryptLoginCredentials(email, password);
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(encryptedCredentials) });
      const payload = await response.json() as { user?: AuthUser; error?: string };
      if (!response.ok || !payload.user) throw new Error(payload.error || "登录失败");
      onAuthenticated(payload.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
    } finally { setLoading(false); }
  };

  return <div className="auth-gate"><section><div className="auth-mark"><i /><i /><i /></div><span>PAPER ALPHA ACCOUNT</span><h2>登录策略账户</h2><p>系统已关闭公开注册。普通账户由超级管理员在用户管理后台统一创建。</p><div className="bootstrap-notice"><i>{adminReady ? "✓" : "!"}</i><span><b>{adminReady ? "封闭账号系统" : "管理员尚未初始化"}</b><small>{adminReady ? "没有注册入口，账户资料与策略数据相互隔离。" : "请先配置服务器默认管理员密码。"}</small></span></div><form onSubmit={submit}>
    <label><span>邮箱</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
    <label><span>密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} autoComplete="current-password" required /><small>至少8位</small></label>
    {error && <p className="auth-error">{error}</p>}
    <button className="auth-submit" disabled={loading || !adminReady}>{loading ? "登录中…" : "登录账户"}<i>→</i></button>
  </form><small className="auth-footnote">登录参数使用 RSA-OAEP + AES-GCM 加密传输；密码使用加盐 PBKDF2 哈希保存。</small></section></div>;
}
