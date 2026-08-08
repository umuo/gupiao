"use client";

import { useCallback, useEffect, useState } from "react";

type ManagedUser = {
  id: string;
  displayName: string;
  email: string;
  role: "user" | "superadmin";
  createdAt: string;
};

export function UserManagement({ open, onClose, onToast }: {
  open: boolean;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [items, setItems] = useState<ManagedUser[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/users");
      const payload = await response.json() as { users?: ManagedUser[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "读取用户失败");
      setItems(payload.users ?? []);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "读取用户失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [open, refresh]);

  if (!open) return null;

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, email, password }),
      });
      const payload = await response.json() as { user?: ManagedUser; error?: string };
      if (!response.ok || !payload.user) throw new Error(payload.error || "创建用户失败");
      setItems((current) => [payload.user!, ...current]);
      setDisplayName(""); setEmail(""); setPassword("");
      onToast(`普通用户 ${payload.user.displayName} 已创建`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "创建用户失败"); }
    finally { setSaving(false); }
  };

  return <div className="studio-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="strategy-studio user-management-studio" role="dialog" aria-modal="true" aria-labelledby="user-management-title">
      <header className="studio-header"><div><span>USER MANAGEMENT</span><h2 id="user-management-title">用户管理</h2><p>公开注册已关闭，只有超级管理员可以创建普通用户。</p></div><button onClick={onClose} aria-label="关闭">×</button></header>
      <div className="studio-body user-management-layout">
        <section className="user-create-form">
          <div className="automation-section-title"><div><span>NEW USER</span><h3>新增普通用户</h3></div><small>固定为普通权限</small></div>
          <form onSubmit={createUser}>
            <label><span>用户昵称</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} autoComplete="off" required /></label>
            <label><span>登录邮箱</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={180} autoComplete="off" required /></label>
            <label><span>初始密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} autoComplete="new-password" required /><small>至少8位，请通过安全方式告知用户。</small></label>
            {error && <p className="studio-error">{error}</p>}
            <button className="primary-studio-button" disabled={saving}>{saving ? "正在创建…" : "创建普通用户"}</button>
          </form>
        </section>
        <section className="managed-user-list-wrap">
          <div className="automation-section-title"><div><span>ACCOUNTS</span><h3>系统用户</h3></div><button onClick={refresh}>{loading ? "刷新中…" : `${items.length} 人`}</button></div>
          <div className="managed-user-list">{items.length ? items.map((item) => <article key={item.id}><i>{item.displayName.slice(0, 2).toUpperCase()}</i><div><b>{item.displayName}</b><small>{item.email}</small></div><span className={item.role}>{item.role === "superadmin" ? "超级管理员" : "普通用户"}</span><time>{new Date(item.createdAt).toLocaleDateString("zh-CN")}</time></article>) : <div className="automation-empty"><i>♙</i><b>{loading ? "正在读取用户…" : "暂无用户"}</b></div>}</div>
        </section>
      </div>
    </section>
  </div>;
}
