import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Archive,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileWarning,
  History,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import {
  deleteMsProject,
  fetchMsProjectRevisions,
  fetchMsProjects,
  forceCheckinProject,
  msProjectFileUrl,
  updateMsProject,
  updateMsProjectStatus,
} from '../../services/msProjectService';

const STATUS_OPTIONS = ['ALL', 'DRAFT', 'ACTIVE', 'ARCHIVED'];

const STATUS_BADGE = {
  DRAFT: 'border-amber-200 bg-amber-50 text-amber-700',
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  ARCHIVED: 'border-slate-200 bg-slate-100 text-slate-500',
};

const REVISION_TYPE_BADGE = {
  CREATE: 'border-[#90e0ef] bg-[#caf0f8] text-[#0077b6]',
  SYNC: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PUBLISH: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  FORCE_CHECKIN: 'border-red-200 bg-red-50 text-red-700',
};

function readAuthUser() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
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

function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isStaleLock(checkedOutAt) {
  if (!checkedOutAt) return false;
  const date = new Date(checkedOutAt);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() > 24 * 60 * 60 * 1000;
}

function StatusBadge({ status }) {
  const key = String(status || '').toUpperCase();
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold ${STATUS_BADGE[key] || STATUS_BADGE.ACTIVE}`}
    >
      {key || 'ACTIVE'}
    </span>
  );
}

function LockBadge({ project }) {
  if (!project.checked_out_by) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700">
        <Unlock size={12} />
        Available
      </span>
    );
  }
  const stale = isStaleLock(project.checked_out_at);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${
        stale
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-amber-200 bg-amber-50 text-amber-700'
      }`}
      title={stale ? 'Locked over 24h — likely stuck' : 'Checked out'}
    >
      <Lock size={12} />
      {stale ? 'Lock > 24h' : 'Checked Out'}
    </span>
  );
}

function RevisionHistoryModal({ project, revisions, loading, onClose }) {
  if (!project) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-0 md:items-center md:px-4">
      <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl md:max-w-lg md:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-slate-800">Revision History</h2>
            <p className="mt-1 truncate text-xs font-semibold text-slate-500">
              {project.project_name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-all hover:bg-slate-50 active:scale-95"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4">
          {loading ? (
            <div className="py-10 text-center text-slate-500">
              <Loader2 className="mx-auto animate-spin text-[#0096c7]" size={22} />
              <div className="mt-2 text-sm font-bold">Loading history...</div>
            </div>
          ) : revisions.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm font-bold text-slate-400">
              No revisions recorded.
            </div>
          ) : (
            <ol className="divide-y divide-slate-100">
              {revisions.map((rev) => (
                <li
                  key={rev.revision_id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-extrabold text-slate-800">
                        rev {rev.revision_no}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${REVISION_TYPE_BADGE[rev.revision_type] || 'border-slate-200 bg-slate-50 text-slate-600'}`}
                      >
                        {rev.revision_type}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">
                      {rev.created_by || '-'}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right text-[11px] font-semibold text-slate-500">
                    {formatDateTime(rev.created_at)}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function ForceCheckinModal({ project, reason, saving, onReasonChange, onClose, onConfirm }) {
  if (!project) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-0 md:items-center md:px-4">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl md:max-w-lg md:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-slate-800">Force Check-In Project</h2>
            <p className="mt-1 truncate text-xs font-semibold text-slate-500">
              {project.project_name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-all hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex gap-3">
            <ShieldAlert className="mt-0.5 flex-shrink-0 text-amber-600" size={20} />
            <div className="min-w-0">
              <p className="text-sm font-bold text-amber-800">
                The project lock will be force-released.
              </p>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-amber-700">
                Unsynced changes from the lock owner's MS Project will NOT be saved.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm">
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
            <span className="font-bold text-slate-500">Checked out by</span>
            <span className="font-semibold text-slate-800">{project.checked_out_by || '-'}</span>
          </div>
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
            <span className="font-bold text-slate-500">Checked out at</span>
            <span className="font-semibold text-slate-800">
              {formatDateTime(project.checked_out_at)}
            </span>
          </div>
        </div>

        <label className="mt-4 grid gap-1 text-xs font-bold text-slate-700">
          Reason
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            rows={3}
            disabled={saving}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 transition-all focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60"
            placeholder="e.g. user forgot check-in before leave"
          />
        </label>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving || !reason.trim()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-red-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="animate-spin" size={16} /> : <ShieldAlert size={16} />}
            Force Check-In
          </button>
        </div>
      </div>
    </div>
  );
}

function RenameProjectModal({ project, name, saving, error, onNameChange, onClose, onConfirm }) {
  if (!project) return null;
  const canSave = name.trim().length > 0 && !saving;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-0 md:items-center md:px-4">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl md:max-w-lg md:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-slate-800">Rename Project</h2>
            <p className="mt-1 truncate text-xs font-semibold text-slate-500">
              {project.project_name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-all hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <label className="mt-4 grid gap-1 text-xs font-bold text-slate-700">
          Project name
          <input
            type="text"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            disabled={saving}
            autoFocus
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 transition-all focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60"
            placeholder="New project name"
          />
        </label>

        <p className="mt-2 text-[11px] font-semibold leading-relaxed text-slate-400">
          Note: the next sync from the .mpp file will overwrite this name.
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
            <span className="text-xs font-semibold text-red-700">{error}</span>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canSave}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-4 py-2 text-sm font-bold text-white transition-all hover:bg-[#023e8a] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="animate-spin" size={16} /> : <Pencil size={16} />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteProjectModal({ project, busy, error, onClose, onDelete, onForceDelete }) {
  if (!project) return null;
  const activeReservations = Number(project.active_reservation_count) || 0;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-0 md:items-center md:px-4">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl md:max-w-lg md:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-slate-800">Delete Project</h2>
            <p className="mt-1 truncate text-xs font-semibold text-slate-500">
              {project.project_name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-all hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 flex-shrink-0 text-red-600" size={20} />
            <div className="min-w-0">
              <p className="text-sm font-bold text-red-800">
                Deleting a project removes ALL its tasks, reservations, locks, revisions, and .mpp
                file.
              </p>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-red-700">
                SAP/sow data (operations, plan hours, sub-tasks) is NOT deleted.
              </p>
            </div>
          </div>
        </div>

        {activeReservations > 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex gap-3">
              <ShieldAlert className="mt-0.5 flex-shrink-0 text-amber-600" size={20} />
              <div className="min-w-0">
                <p className="text-sm font-bold text-amber-800">
                  {activeReservations} ACTIVE bay reservation{activeReservations === 1 ? '' : 's'}{' '}
                  in the area layout.
                </p>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-amber-700">
                  Regular Delete is blocked by the server until reservations are cancelled. Force
                  Delete also removes those reservations from the area layout.
                </p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
            <span className="text-xs font-semibold text-red-700">{error}</span>
          </div>
        )}

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onDelete}
            disabled={busy || activeReservations > 0}
            title={
              activeReservations > 0
                ? 'Cancel active bay reservations first'
                : 'Delete project (without touching active reservations)'
            }
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
            Delete
          </button>
          <button
            type="button"
            onClick={onForceDelete}
            disabled={busy}
            title="Delete project + cancel ALL bay reservations (including active) from the area layout"
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-red-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="animate-spin" size={16} /> : <ShieldAlert size={16} />}
            Force Delete
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] font-semibold text-slate-400">
          Force Delete also removes reservations from the area layout.
        </p>
      </div>
    </div>
  );
}

export default function MsProjectHubPage() {
  const navigate = useNavigate();
  const [authUser] = useState(readAuthUser);
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [lockedOnly, setLockedOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const [historyProject, setHistoryProject] = useState(null);
  const [revisions, setRevisions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [forceProject, setForceProject] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const [renameTarget, setRenameTarget] = useState(null);
  const [renameName, setRenameName] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [statusSavingId, setStatusSavingId] = useState(null);

  const isAdministrator = String(authUser?.roles || '').toLowerCase() === 'administrator';
  const actorName = authUser?.username || authUser?.name || 'web-hub';

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchMsProjects({ limit: 100 });
      setProjects(rows);
    } catch (error) {
      setProjects([]);
      toast.error('Failed to load MS Project', { description: error.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const filteredProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter((project) => {
      if (lockedOnly && !project.checked_out_by) return false;
      if (statusFilter !== 'ALL' && String(project.status || '').toUpperCase() !== statusFilter)
        return false;
      if (!term) return true;
      return [
        project.project_name,
        project.project_id,
        project.status,
        project.checked_out_by,
        project.updated_by,
      ].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(term)
      );
    });
  }, [lockedOnly, projects, search, statusFilter]);

  const stats = useMemo(
    () => ({
      total: projects.length,
      checkedOut: projects.filter((p) => p.checked_out_by).length,
      published: projects.filter(
        (p) => p.published_revision_no !== null && p.published_revision_no !== undefined
      ).length,
      archived: projects.filter((p) => String(p.status || '').toUpperCase() === 'ARCHIVED').length,
    }),
    [projects]
  );

  const openHistory = async (project) => {
    setHistoryProject(project);
    setHistoryLoading(true);
    setRevisions([]);
    try {
      const rows = await fetchMsProjectRevisions(project.project_id, { limit: 20 });
      setRevisions(rows);
    } catch (error) {
      toast.error('Failed to load revision history', { description: error.message });
    } finally {
      setHistoryLoading(false);
    }
  };

  const changeStatus = async (project, nextStatus) => {
    const status = String(nextStatus || '').toUpperCase();
    if (!status || status === String(project.status || '').toUpperCase()) return;
    setStatusSavingId(project.project_id);
    try {
      await updateMsProjectStatus(project.project_id, status, actorName);
      toast.success(`Status ${project.project_name} → ${status}`);
      await loadProjects();
    } catch (error) {
      toast.error('Failed to change status', { description: error.message });
    } finally {
      setStatusSavingId(null);
    }
  };

  const openForceCheckin = (project) => {
    setForceProject(project);
    setReason(
      project.checked_out_by
        ? `Release stale checkout from ${project.checked_out_by}`
        : 'Admin force check-in'
    );
  };

  const closeForceModal = () => {
    if (saving) return;
    setForceProject(null);
    setReason('');
  };

  const confirmForceCheckin = async () => {
    if (!forceProject || saving || !reason.trim()) return;
    setSaving(true);
    try {
      await forceCheckinProject(forceProject.project_id, {
        actor: actorName,
        reason: reason.trim(),
      });
      toast.success('Project force check-in successful');
      setForceProject(null);
      setReason('');
      await loadProjects();
    } catch (error) {
      toast.error('Force check-in failed', { description: error.message });
    } finally {
      setSaving(false);
    }
  };

  const openRename = (project) => {
    setRenameTarget(project);
    setRenameName(project.project_name);
    setRenameError('');
  };

  const closeRename = () => {
    if (renameBusy) return;
    setRenameTarget(null);
    setRenameName('');
    setRenameError('');
  };

  const submitRename = async () => {
    if (!renameTarget || renameBusy || !renameName.trim()) return;
    setRenameBusy(true);
    setRenameError('');
    try {
      await updateMsProject(renameTarget.project_id, { project_name: renameName.trim() });
      toast.success('Project renamed');
      setRenameTarget(null);
      setRenameName('');
      await loadProjects();
    } catch (error) {
      setRenameError(error.message);
      toast.error('Rename failed', { description: error.message });
    } finally {
      setRenameBusy(false);
    }
  };

  const openDelete = (project) => {
    setDeleteTarget(project);
    setDeleteError('');
  };

  const closeDelete = () => {
    if (deleteBusy) return;
    setDeleteTarget(null);
    setDeleteError('');
  };

  const submitDelete = async (force) => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      const result = await deleteMsProject(deleteTarget.project_id, { force });
      toast.success(
        force
          ? `Project + reservations deleted (${result.cancelled_reservations ?? 0} reservations removed)`
          : 'Project deleted'
      );
      setDeleteTarget(null);
      await loadProjects();
    } catch (error) {
      setDeleteError(error.message);
      toast.error(force ? 'Force delete failed' : 'Delete failed', { description: error.message });
    } finally {
      setDeleteBusy(false);
    }
  };

  const buttonBase =
    'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50';
  const iconButton =
    'inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-all hover:bg-slate-50 hover:border-slate-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm md:px-6">
        <button
          type="button"
          onClick={() => navigate('/sow-scheduling')}
          className={`${buttonBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <div className="text-center">
          <h1 className="text-sm font-extrabold text-slate-800 md:text-base">MS Project Hub</h1>
          <p className="text-[10px] font-bold uppercase text-slate-500">
            All stored projects · checkout · file · history
          </p>
        </div>
        <button
          type="button"
          onClick={loadProjects}
          disabled={loading}
          className={`${buttonBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </header>

      <main className="flex-1 overflow-hidden px-4 py-3 md:px-6 md:py-4">
        <div className="flex h-full flex-col gap-3">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Search Project
                <div className="relative">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    size={16}
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 placeholder-slate-400 transition-all focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                    placeholder="Project name, ID, checkout user..."
                  />
                </div>
              </label>

              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Status
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 transition-all focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={lockedOnly}
                  onChange={(event) => setLockedOnly(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#0096c7] focus:ring-[#00b4d8]"
                />
                Checked out only
              </label>

              <div className="grid grid-cols-4 gap-2 text-center text-xs font-bold">
                <div className="rounded-lg border border-[#90e0ef] bg-[#caf0f8] px-3 py-2 text-[#0077b6]">
                  <div className="text-[10px] uppercase">Total</div>
                  <div className="text-base font-extrabold">{stats.total}</div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                  <div className="text-[10px] uppercase">Locked</div>
                  <div className="text-base font-extrabold">{stats.checkedOut}</div>
                </div>
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-indigo-700">
                  <div className="text-[10px] uppercase">Published</div>
                  <div className="text-base font-extrabold">{stats.published}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-slate-600">
                  <div className="text-[10px] uppercase">Archived</div>
                  <div className="text-base font-extrabold">{stats.archived}</div>
                </div>
              </div>
            </div>
          </section>

          <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="h-full overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr style={{ background: '#caf0f8' }}>
                    <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-700">
                      Project
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-700">
                      Status
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-700">
                      Lock
                    </th>
                    <th className="hidden px-3 py-2 text-left text-xs font-extrabold text-slate-700 md:table-cell">
                      File .mpp
                    </th>
                    <th className="hidden px-3 py-2 text-left text-xs font-extrabold text-slate-700 md:table-cell">
                      Updated
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-extrabold text-slate-700">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                        <Loader2 className="mx-auto animate-spin text-[#0096c7]" size={24} />
                        <div className="mt-2 text-sm font-bold">Loading projects...</div>
                      </td>
                    </tr>
                  ) : filteredProjects.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-12 text-center text-sm font-bold text-slate-400"
                      >
                        {projects.length === 0
                          ? 'No projects stored yet. Publish from MS Project (macro Ms_PublishNewProject) to get started.'
                          : 'No projects match the filter.'}
                      </td>
                    </tr>
                  ) : (
                    filteredProjects.map((project) => (
                      <tr key={project.project_id} className="hover:bg-slate-50">
                        <td className="max-w-[320px] px-3 py-2">
                          <div className="truncate font-extrabold text-slate-800">
                            {project.project_name}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[11px] font-semibold text-slate-400">
                            {project.project_id}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={project.status} />
                          <div className="mt-1 text-[11px] font-semibold text-slate-500">
                            Rev {project.revision_no ?? '-'} / Pub{' '}
                            {project.published_revision_no ?? '-'}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <LockBadge project={project} />
                          {project.checked_out_by && (
                            <div className="mt-1 text-[11px] font-semibold text-slate-500">
                              {project.checked_out_by} · {formatDateTime(project.checked_out_at)}
                            </div>
                          )}
                        </td>
                        <td className="hidden px-3 py-2 md:table-cell">
                          {project.file_uploaded_at ? (
                            <>
                              <div className="font-bold text-slate-700">
                                {formatBytes(project.file_size)}
                              </div>
                              <div className="text-[11px] font-semibold text-slate-500">
                                {formatDateTime(project.file_uploaded_at)}
                              </div>
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600">
                              <FileWarning size={13} />
                              No file yet
                            </span>
                          )}
                        </td>
                        <td className="hidden px-3 py-2 md:table-cell">
                          <div className="font-bold text-slate-700">
                            {project.updated_by || '-'}
                          </div>
                          <div className="text-[11px] font-semibold text-slate-500">
                            {formatDateTime(project.updated_at)}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1.5">
                            <a
                              href={
                                project.file_uploaded_at
                                  ? msProjectFileUrl(project.project_id)
                                  : undefined
                              }
                              className={`${iconButton} ${!project.file_uploaded_at ? 'pointer-events-none opacity-40' : ''}`}
                              title={
                                project.file_uploaded_at ? 'Download .mpp' : 'No .mpp file yet'
                              }
                              download
                            >
                              <Download size={15} />
                            </a>
                            <button
                              type="button"
                              onClick={() => openHistory(project)}
                              className={iconButton}
                              title="Revision history"
                            >
                              <History size={15} />
                            </button>
                            <select
                              value={String(project.status || 'ACTIVE').toUpperCase()}
                              onChange={(event) => changeStatus(project, event.target.value)}
                              disabled={statusSavingId === project.project_id}
                              title="Change status"
                              className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 transition-all focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="DRAFT">DRAFT</option>
                              <option value="ACTIVE">ACTIVE</option>
                              <option value="ARCHIVED">ARCHIVED</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => openRename(project)}
                              className={iconButton}
                              title="Rename project"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => openDelete(project)}
                              className={`${iconButton} hover:border-red-200 hover:bg-red-50 hover:text-red-600`}
                              title="Delete project (Delete / Force Delete)"
                            >
                              <Trash2 size={15} />
                            </button>
                            {isAdministrator && (
                              <button
                                type="button"
                                onClick={() => openForceCheckin(project)}
                                disabled={!project.checked_out_by}
                                title="Force check-in (admin)"
                                className={`${iconButton} ${
                                  project.checked_out_by
                                    ? 'border-red-200 text-red-600 hover:bg-red-50'
                                    : ''
                                }`}
                              >
                                {project.checked_out_by ? (
                                  <ShieldAlert size={15} />
                                ) : (
                                  <CheckCircle2 size={15} />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
            <Archive size={12} />
            Editor flow: open MS Project → macro Ms_OpenFromServer → Ms_CheckOut → edit →
            Ms_SaveToServer → Ms_CheckIn.
          </p>
        </div>
      </main>

      <RevisionHistoryModal
        project={historyProject}
        revisions={revisions}
        loading={historyLoading}
        onClose={() => setHistoryProject(null)}
      />

      <ForceCheckinModal
        project={forceProject}
        reason={reason}
        saving={saving}
        onReasonChange={setReason}
        onClose={closeForceModal}
        onConfirm={confirmForceCheckin}
      />

      <RenameProjectModal
        project={renameTarget}
        name={renameName}
        saving={renameBusy}
        error={renameError}
        onNameChange={setRenameName}
        onClose={closeRename}
        onConfirm={submitRename}
      />

      <DeleteProjectModal
        project={deleteTarget}
        busy={deleteBusy}
        error={deleteError}
        onClose={closeDelete}
        onDelete={() => submitDelete(false)}
        onForceDelete={() => submitDelete(true)}
      />
    </div>
  );
}
