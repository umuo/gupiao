"use client";

import { useState } from "react";

type AuthUser = { userId: string; displayName: string; email: string };

export function AuthGate({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName, email, password }) });
      const payload = await response.json() as { user?: AuthUser; error?: string };
      if (!response.ok || !payload.user) throw new Error(payload.error || (mode === "login" ? "登录失败" : "注册失败"));
      onAuthenticated(payload.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
    } finally { setLoading(false); }
  };

  return <div className="auth-gate"><section><div className="auth-mark"><i /><i /><i /></div><span>PAPER ALPHA ACCOUNT</span><h2>{mode === "login" ? "登录你的策略账户" : "创建独立策略账户"}</h2><p>保存个人策略、AI 接口偏好和回测配置，不依赖任何第三方登录服务。</p><div className="auth-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>登录</button><button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }}>注册</button></div><form onSubmit={submit}>
    {mode === "register" && <label><span>昵称</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} autoComplete="name" required /></label>}
    <label><span>邮箱</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
    <label><span>密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} required /><small>至少8位</small></label>
    {error && <p className="auth-error">{error}</p>}
    <button className="auth-submit" disabled={loading}>{loading ? "处理中…" : mode === "login" ? "登录账户" : "创建账户"}<i>→</i></button>
  </form><small className="auth-footnote">密码使用加盐 PBKDF2 哈希保存；登录 Cookie 仅限服务器读取。</small></section></div>;
}
