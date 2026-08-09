"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ManagedUser = {
  id: string;
  displayName: string;
  email: string;
  role: "user" | "superadmin";
  createdAt: string;
  isCurrent: boolean;
};

export function UserManagement({ open, onClose, onToast }: {
  open: boolean;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [items, setItems] = useState<ManagedUser[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
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

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => item.displayName.toLowerCase().includes(keyword) || item.email.toLowerCase().includes(keyword));
  }, [items, search]);

  if (!open) return null;

  const resetForm = () => {
    setEditingId(null); setDisplayName(""); setEmail(""); setPassword(""); setError("");
  };

  const editUser = (user: ManagedUser) => {
    if (user.role === "superadmin") return;
    setEditingId(user.id); setDisplayName(user.displayName); setEmail(user.email); setPassword(""); setError("");
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const saveUser = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/admin/users", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, displayName, email, password }),
      });
      const payload = await response.json() as { user?: ManagedUser; sessionsRevoked?: boolean; error?: string };
      if (!response.ok || !payload.user) throw new Error(payload.error || (editingId ? "更新用户失败" : "创建用户失败"));
      if (editingId) setItems((current) => current.map((item) => item.id === payload.user!.id ? payload.user! : item));
      else setItems((current) => [payload.user!, ...current]);
      const message = editingId
        ? `${payload.user.displayName}资料已更新${payload.sessionsRevoked ? "，原登录会话已退出" : ""}`
        : `普通用户 ${payload.user.displayName} 已创建`;
      resetForm(); onToast(message);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存用户失败"); }
    finally { setSaving(false); }
  };

  const deleteUser = async (user: ManagedUser) => {
    if (user.role === "superadmin" || user.isCurrent) return;
    if (!window.confirm(`确认删除用户“${user.displayName}”？该用户的会话、策略、模拟盘、任务、通知渠道和历史数据会一并永久删除。`)) return;
    setDeletingId(user.id); setError("");
    try {
      const response = await fetch("/api/admin/users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: user.id }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "删除用户失败");
      setItems((current) => current.filter((item) => item.id !== user.id));
      if (editingId === user.id) resetForm();
      onToast(`用户 ${user.displayName} 及其业务数据已删除`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "删除用户失败"); }
    finally { setDeletingId(null); }
  };

  return <div className="studio-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="strategy-studio user-management-studio" role="dialog" aria-modal="true" aria-labelledby="user-management-title">
      <header className="studio-header"><div><span>USER MANAGEMENT</span><h2 id="user-management-title">用户管理</h2><p>管理普通用户的账号资料和完整生命周期；超级管理员账号始终受保护。</p></div><button onClick={onClose} aria-label="关闭">×</button></header>
      <div className="studio-body user-management-layout">
        <section className="user-create-form" ref={formRef}>
          <div className="automation-section-title"><div><span>{editingId ? "EDIT USER" : "NEW USER"}</span><h3>{editingId ? "编辑普通用户" : "新增普通用户"}</h3></div>{editingId ? <button onClick={resetForm}>取消编辑</button> : <small>固定为普通权限</small>}</div>
          <form onSubmit={saveUser}>
            <label><span>用户昵称</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} autoComplete="off" required /></label>
            <label><span>登录邮箱</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={180} autoComplete="off" required /></label>
            <label><span>{editingId ? "重置密码（可选）" : "初始密码"}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} autoComplete="new-password" required={!editingId} placeholder={editingId ? "留空表示不修改密码" : "至少 8 位"} /><small>{editingId ? "填写后会强制该用户所有已登录设备退出。" : "至少8位，请通过安全方式告知用户。"}</small></label>
            {error && <p className="studio-error">{error}</p>}
            <button className="primary-studio-button" disabled={saving || !displayName.trim() || !email.trim() || (!editingId && password.length < 8)}>{saving ? "正在保存…" : editingId ? "保存用户修改" : "创建普通用户"}</button>
          </form>
        </section>
        <section className="managed-user-list-wrap">
          <div className="automation-section-title"><div><span>ACCOUNTS</span><h3>系统用户</h3></div><button onClick={refresh}>{loading ? "刷新中…" : `${items.length} 人`}</button></div>
          <label className="user-search"><span>查找用户</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="输入昵称或邮箱" /></label>
          <div className="managed-user-list">{filteredItems.length ? filteredItems.map((item) => <article className={editingId === item.id ? "editing" : ""} key={item.id}><i>{item.displayName.slice(0, 2).toUpperCase()}</i><div className="managed-user-identity"><b>{item.displayName}</b><small>{item.email}</small></div><span className={item.role}>{item.role === "superadmin" ? "超级管理员" : "普通用户"}</span><time>{new Date(item.createdAt).toLocaleDateString("zh-CN")}</time>{item.role === "superadmin" ? <div className="managed-user-protected">{item.isCurrent ? "当前账号 · 受保护" : "受保护"}</div> : <div className="managed-user-actions"><button onClick={() => editUser(item)}>编辑</button><button className="danger" disabled={deletingId === item.id} onClick={() => deleteUser(item)}>{deletingId === item.id ? "删除中…" : "删除"}</button></div>}</article>) : <div className="automation-empty"><i>♙</i><b>{loading ? "正在读取用户…" : search ? "没有匹配的用户" : "暂无用户"}</b></div>}</div>
        </section>
      </div>
    </section>
  </div>;
}
