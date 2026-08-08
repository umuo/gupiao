"use client";

import { useState } from "react";

type AuthUser = { userId: string; displayName: string; email: string; role: "user" | "superadmin" };

export function AuthGate({ adminReady, onAuthenticated }: { adminReady: boolean; onAuthenticated: (user: AuthUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
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
  </form><small className="auth-footnote">密码使用加盐 PBKDF2 哈希保存；登录 Cookie 仅限服务器读取。</small></section></div>;
}
