import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  Unlock,
  X,
} from 'lucide-react';
import { fetchMsProjects, forceCheckinProject } from '../../services/msProjectService';

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

function ProjectStatusBadge({ project }) {
  const isCheckedOut = Boolean(project.checked_out_by);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${
        isCheckedOut
          ? 'border-amber-200 bg-amber-50 text-amber-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      }`}
    >
      {isCheckedOut ? <Lock size={12} /> : <Unlock size={12} />}
      {isCheckedOut ? 'Checked Out' : 'Available'}
    </span>
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
              <p className="text-sm font-bold text-amber-800">Project lock akan dilepas paksa.</p>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-amber-700">
                Gunakan saat project tertahan karena user lupa check-in atau sesi editor macet.
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
            placeholder="Contoh: sesi editor tertahan setelah browser tertutup"
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

export default function MsProjectAdminPage() {
  const navigate = useNavigate();
  const [authUser] = useState(readAuthUser);
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
  const [lockedOnly, setLockedOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const isAdministrator = String(authUser?.roles || '').toLowerCase() === 'administrator';

  const filteredProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter((project) => {
      if (lockedOnly && !project.checked_out_by) return false;
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
  }, [lockedOnly, projects, search]);

  const checkedOutCount = useMemo(
    () => projects.filter((project) => project.checked_out_by).length,
    [projects]
  );

  const loadProjects = useCallback(async () => {
    if (!isAdministrator) {
      setProjects([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const rows = await fetchMsProjects({ limit: 200 });
      setProjects(rows);
    } catch (error) {
      setProjects([]);
      toast.error('Gagal load MS Project', { description: error.message });
    } finally {
      setLoading(false);
    }
  }, [isAdministrator]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const openForceCheckin = (project) => {
    setSelectedProject(project);
    setReason(
      project.checked_out_by
        ? `Release stale checkout from ${project.checked_out_by}`
        : 'Admin force check-in'
    );
  };

  const closeModal = () => {
    if (saving) return;
    setSelectedProject(null);
    setReason('');
  };

  const confirmForceCheckin = async () => {
    if (!selectedProject || saving || !reason.trim()) return;

    setSaving(true);
    try {
      await forceCheckinProject(selectedProject.project_id, {
        actor: authUser?.username || authUser?.name || 'admin-web',
        reason: reason.trim(),
      });
      toast.success('Project berhasil force check-in');
      setSelectedProject(null);
      setReason('');
      await loadProjects();
    } catch (error) {
      toast.error('Force check-in gagal', { description: error.message });
    } finally {
      setSaving(false);
    }
  };

  const buttonBase =
    'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm md:px-6">
        <button
          type="button"
          onClick={() => navigate('/operations-hub')}
          className={`${buttonBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <div className="text-center">
          <h1 className="text-sm font-extrabold text-slate-800 md:text-base">MS Project Admin</h1>
          <p className="text-[10px] font-bold uppercase text-slate-500">Force Check-In Control</p>
        </div>
        <button
          type="button"
          onClick={loadProjects}
          disabled={loading || !isAdministrator}
          className={`${buttonBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </header>

      <main className="flex-1 overflow-hidden px-4 py-3 md:px-6 md:py-4">
        {!isAdministrator ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
            Hanya role administrator yang bisa membuka MS Project Admin.
          </div>
        ) : (
          <div className="flex h-full flex-col gap-3">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
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
                      placeholder="Nama project, ID, user checkout..."
                    />
                  </div>
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

                <div className="grid grid-cols-2 gap-2 text-center text-xs font-bold">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                    <div className="text-[10px] uppercase">Checked Out</div>
                    <div className="text-base font-extrabold">{checkedOutCount}</div>
                  </div>
                  <div className="rounded-lg border border-[#90e0ef] bg-[#caf0f8] px-3 py-2 text-[#0077b6]">
                    <div className="text-[10px] uppercase">Total</div>
                    <div className="text-base font-extrabold">{projects.length}</div>
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
                        Checked Out
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-700">
                        Updated
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-extrabold text-slate-700">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                          <Loader2 className="mx-auto animate-spin text-[#0096c7]" size={24} />
                          <div className="mt-2 text-sm font-bold">Loading projects...</div>
                        </td>
                      </tr>
                    ) : filteredProjects.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-12 text-center text-sm font-bold text-slate-400"
                        >
                          Tidak ada project sesuai filter.
                        </td>
                      </tr>
                    ) : (
                      filteredProjects.map((project) => (
                        <tr key={project.project_id} className="hover:bg-slate-50">
                          <td className="max-w-[360px] px-3 py-2">
                            <div className="truncate font-extrabold text-slate-800">
                              {project.project_name}
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[11px] font-semibold text-slate-400">
                              {project.project_id}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <ProjectStatusBadge project={project} />
                            <div className="mt-1 text-[11px] font-semibold text-slate-500">
                              Rev {project.revision_no ?? '-'} / Published{' '}
                              {project.published_revision_no ?? '-'}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-bold text-slate-700">
                              {project.checked_out_by || '-'}
                            </div>
                            <div className="text-[11px] font-semibold text-slate-500">
                              {formatDateTime(project.checked_out_at)}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-bold text-slate-700">
                              {project.updated_by || '-'}
                            </div>
                            <div className="text-[11px] font-semibold text-slate-500">
                              {formatDateTime(project.updated_at)}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => openForceCheckin(project)}
                              disabled={!project.checked_out_by}
                              className={`${buttonBase} ${
                                project.checked_out_by
                                  ? 'bg-red-600 text-white hover:bg-red-500'
                                  : 'border border-slate-200 bg-slate-50 text-slate-400'
                              }`}
                            >
                              {project.checked_out_by ? (
                                <ShieldAlert size={15} />
                              ) : (
                                <CheckCircle2 size={15} />
                              )}
                              Force Check-In
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </main>

      <ForceCheckinModal
        project={selectedProject}
        reason={reason}
        saving={saving}
        onReasonChange={setReason}
        onClose={closeModal}
        onConfirm={confirmForceCheckin}
      />
    </div>
  );
}
