import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { usePermissions, useAuth } from '../../rbac';
import { ROLES, LEVELS, resolveLevel } from '../../rbac/permissionMatrix';
import { FEATURES } from '../../rbac/featureRegistry';

const API_BASE = import.meta.env.VITE_API_URL || '';

const ROLE_TONE = {
  administrator: 'border-purple-200 bg-purple-50 text-purple-700',
  supervisor: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  foreman: 'border-amber-200 bg-amber-50 text-amber-700',
  warehouse: 'border-sky-200 bg-sky-50 text-sky-700',
  user: 'border-slate-200 bg-slate-50 text-slate-600',
};

const LEVEL_SEG = [
  { value: LEVELS.NO_ACCESS, label: 'None', active: 'bg-slate-600 text-white' },
  { value: LEVELS.READ_ONLY, label: 'Read', active: 'bg-amber-500 text-white' },
  { value: LEVELS.FULL_ACCESS, label: 'Full', active: 'bg-emerald-600 text-white' },
];

function labelOf(id) {
  return (
    FEATURES[id]?.label ||
    String(id)
      .split('_')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ')
  );
}
function moduleOf(id) {
  return FEATURES[id]?.module || 'Other';
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function RoleBadge({ role, className = '' }) {
  const key = String(role || '').toLowerCase();
  const tone = ROLE_TONE[key] || 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase ${tone} ${className}`}
    >
      {role || '-'}
    </span>
  );
}

function SegmentedLevel({ value, onChange, disabled }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
      {LEVEL_SEG.map((seg, i) => {
        const active = value === seg.value;
        return (
          <button
            key={seg.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(seg.value)}
            className={`h-8 px-3 text-[11px] font-bold transition-colors ${i > 0 ? 'border-l border-slate-200' : ''} ${
              active ? seg.active : 'bg-white text-slate-500 hover:bg-slate-50'
            } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}

function UserEditDrawer({ user, apiBase, authHeaders, canManage, onClose, onSaved }) {
  const isNew = !user?.id;
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(user?.roles || 'foreman');
  const [showPassword, setShowPassword] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [featureIds, setFeatureIds] = useState(() => Object.values(FEATURES).map((f) => f.id));
  const [loadingPerms, setLoadingPerms] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) return undefined;
    let alive = true;
    fetch(`${apiBase}/auth/users/${user.id}/permissions`, { headers: authHeaders })
      .then((r) => r.json())
      .then((data) => {
        if (!alive || !data.success) return;
        const ov = {};
        Object.entries(data.permissions || {}).forEach(([f, v]) => {
          if (v.override) ov[f] = v.override;
        });
        setOverrides(ov);
        setFeatureIds(Object.keys(data.permissions || {}));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoadingPerms(false);
      });
    return () => {
      alive = false;
    };
  }, [isNew, user?.id, apiBase, authHeaders]);

  const groups = useMemo(() => {
    const byModule = {};
    featureIds.forEach((id) => {
      (byModule[moduleOf(id)] = byModule[moduleOf(id)] || []).push(id);
    });
    return Object.entries(byModule).sort((a, b) => a[0].localeCompare(b[0]));
  }, [featureIds]);

  const effectiveOf = (id) => overrides[id] ?? resolveLevel(role, id);
  const isOverridden = (id) => overrides[id] != null;
  const overrideCount = Object.keys(overrides).length;

  const setLevel = (id, level) => {
    setOverrides((cur) => {
      const next = { ...cur };
      if (level === resolveLevel(role, id)) delete next[id];
      else next[id] = level;
      return next;
    });
  };
  const resetAll = () => setOverrides({});

  const canSubmit = canManage && username.trim() && role && (!isNew || password.length >= 5);

  const save = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/auth/users${isNew ? '' : `/${user.id}`}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ username: username.trim(), password, roles: role }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false)
        throw new Error(payload.error || 'Failed to save user');

      if (!isNew) {
        const body = {};
        featureIds.forEach((id) => {
          body[id] = overrides[id] ?? null;
        });
        const pRes = await fetch(`${apiBase}/auth/users/${user.id}/permissions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ overrides: body }),
        });
        const pData = await pRes.json().catch(() => ({}));
        if (!pRes.ok || pData.success === false)
          throw new Error(pData.error || 'User saved, but permissions failed');
      }
      toast.success(isNew ? 'User created' : 'Changes saved');
      onSaved();
    } catch (err) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:bg-slate-50';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#caf0f8] text-[#0077b6]">
              {isNew ? <UserPlus size={18} /> : <Pencil size={18} />}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-extrabold text-slate-900">
                {isNew ? 'Add User' : username || 'Edit User'}
              </h2>
              {!isNew && (
                <p className="truncate text-xs font-semibold text-slate-500">
                  {user?.name || 'Profile & access'}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={!canManage}
                className={inputCls}
                placeholder="username"
                autoComplete="username"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">
                Password {!isNew && <span className="font-normal text-slate-400">(optional)</span>}
              </span>
              <span className="relative block">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!canManage}
                  className={`${inputCls} pr-11`}
                  placeholder={isNew ? 'min. 5 characters' : 'leave blank to keep'}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"
                  aria-label="toggle"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={!canManage}
                className={`${inputCls} bg-white`}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Feature access</h3>
                <p className="text-xs text-slate-500">
                  {isNew
                    ? 'Derived from role. Save first to set per-user overrides.'
                    : 'Override where this user must differ from their role.'}
                </p>
              </div>
              {!isNew && overrideCount > 0 && (
                <button
                  type="button"
                  onClick={resetAll}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
                >
                  <RotateCcw size={13} /> Reset to role
                </button>
              )}
            </div>

            {loadingPerms ? (
              <div className="flex items-center gap-2 py-6 text-xs text-slate-500">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : (
              <div className="space-y-3">
                {groups.map(([module, ids]) => (
                  <div key={module} className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="bg-slate-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-400">
                      {module}
                    </div>
                    <div className="divide-y divide-slate-100">
                      {ids.map((id) => {
                        const overridden = isOverridden(id);
                        return (
                          <div
                            key={id}
                            className="flex items-center justify-between gap-3 px-3 py-2"
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-xs font-semibold text-slate-700">
                                {labelOf(id)}
                              </span>
                              {overridden && (
                                <span className="shrink-0 rounded-full bg-[#e0f2fe] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#0077b6]">
                                  Override
                                </span>
                              )}
                            </div>
                            <SegmentedLevel
                              value={effectiveOf(id)}
                              onChange={(lvl) => setLevel(id, lvl)}
                              disabled={isNew || !canManage}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
          <button
            onClick={onClose}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!canSubmit || saving}
            className="inline-flex h-11 min-w-[8rem] items-center justify-center gap-2 rounded-lg bg-[#0096c7] px-5 text-sm font-extrabold text-white hover:bg-[#0077b6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{' '}
            {isNew ? 'Create User' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ManageUsersPage() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { canWrite } = usePermissions();
  const canManage = canWrite('manage_users');

  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [editing, setEditing] = useState(null);

  const authHeaders = useMemo(
    () => ({
      'x-user-role': authUser?.roles || '',
      'x-user-id': authUser?.id ? String(authUser.id) : '',
    }),
    [authUser?.roles, authUser?.id]
  );

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (u) =>
        String(u.username || '')
          .toLowerCase()
          .includes(term) ||
        String(u.name || '')
          .toLowerCase()
          .includes(term) ||
        String(u.roles || '')
          .toLowerCase()
          .includes(term)
    );
  }, [search, users]);

  const loadUsers = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`${API_BASE}/auth/users`, { signal: controller.signal, headers: authHeaders })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load users');
        return response.json();
      })
      .then((payload) => setUsers(Array.isArray(payload) ? payload : []))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setUsers([]);
        toast.error('Failed to load users', { description: err.message });
      })
      .finally(() => setLoading(false));
    return controller;
  }, [authHeaders]);

  useEffect(() => {
    const controller = loadUsers();
    return () => controller.abort();
  }, [loadUsers]);

  const handleDelete = async (u, e) => {
    e?.stopPropagation();
    if (!canManage || deletingId) return;
    if (!window.confirm(`Delete user ${u.username}?`)) return;
    setDeletingId(u.id);
    try {
      const response = await fetch(`${API_BASE}/auth/users/${u.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false)
        throw new Error(payload.error || 'Failed to delete user');
      setUsers((current) => current.filter((row) => row.id !== u.id));
      toast.success('User deleted');
    } catch (err) {
      toast.error('Failed to delete user', { description: err.message });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/operations-hub')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#90e0ef] bg-[#caf0f8] text-[#0077b6]">
              <Users size={19} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-extrabold text-slate-950">Manage Users</h1>
              <p className="truncate text-xs font-semibold text-slate-500">
                Users, roles &amp; per-feature access control
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadUsers}
              disabled={loading}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              aria-label="Refresh"
            >
              {loading ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() => setEditing({})}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0096c7] px-4 text-sm font-extrabold text-white hover:bg-[#0077b6]"
              >
                <Plus size={17} /> <span className="hidden sm:inline">Add User</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4 md:px-6">
        {!canManage && (
          <section className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            <Lock size={16} className="shrink-0" /> Read-only access — you can view users but cannot
            create, edit, or delete.
          </section>
        )}

        {}
        <div className="mb-3 flex items-center justify-between gap-3">
          <label className="relative block w-full max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
              placeholder="Search users…"
            />
          </label>
          <span className="shrink-0 text-xs font-bold text-slate-500">
            {filteredUsers.length}
            {filteredUsers.length !== users.length ? ` / ${users.length}` : ''} users
          </span>
        </div>

        {}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex flex-col items-center gap-2 py-16 text-sm font-semibold text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading users…
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-16 text-center text-sm font-semibold text-slate-400">
              No users found.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filteredUsers.map((u) => (
                <li
                  key={u.id}
                  onClick={() => canManage && setEditing(u)}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors ${canManage ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e8f7fb] text-sm font-extrabold text-[#0077b6]">
                    {String(u.username || '?')
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold text-slate-900">{u.username}</p>
                    <p className="truncate text-xs font-semibold text-slate-500">
                      {u.name || '—'} · created {formatDateTime(u.created_at)}
                    </p>
                  </div>
                  <RoleBadge role={u.roles} className="hidden sm:inline-flex" />
                  {canManage && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(u);
                        }}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[#0077b6]"
                        aria-label="Edit"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(u, e)}
                        disabled={deletingId === u.id}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        aria-label="Delete"
                      >
                        {deletingId === u.id ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {editing && (
        <UserEditDrawer
          key={editing.id || 'new'}
          user={editing}
          apiBase={API_BASE}
          authHeaders={authHeaders}
          canManage={canManage}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadUsers();
          }}
        />
      )}
    </div>
  );
}
