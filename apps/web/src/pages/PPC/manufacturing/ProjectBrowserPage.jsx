import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderSearch, Loader2, RotateCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  fetchBaySchedules,
  fetchMsProjects,
  fetchMsProjectTasks,
} from '../../../services/msProjectService';
import { EmptyState, SearchInput } from '../../../components';
import ProjectScheduleGantt from './ProjectScheduleGantt';

function FetchError({ message, onRetry }) {
  return (
    <div className="m-3 flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-red-700">Failed to load data</p>
      {message && <p className="mt-1 text-xs text-red-600">{message}</p>}
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2
                  text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]
                  active:scale-95 motion-reduce:transition-none motion-reduce:transform-none"
      >
        <RotateCw className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}

export default function ProjectBrowserPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [tasksByProject, setTasksByProject] = useState(() => new Map());
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [tasksError, setTasksError] = useState(null);

  const [expandedIds, setExpandedIds] = useState(() => new Set());

  const [bookingsByProject, setBookingsByProject] = useState(() => new Map());

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoadingProjects(true);
      setProjectsError(null);
      try {
        const rows = await fetchMsProjects({ q: search, limit: 100 });
        setProjects(rows);
      } catch (error) {
        setProjectsError(error.message || 'Could not load the project list.');
      } finally {
        setLoadingProjects(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [search, reloadToken]);

  useEffect(() => {
    if (projects.length === 0) return undefined;
    let cancelled = false;
    setLoadingTasks(true);
    setTasksError(null);
    (async () => {
      try {
        const entries = await Promise.all(
          projects.map(async (p) => {
            try {
              const rows = await fetchMsProjectTasks(p.project_id);
              return [p.project_id, Array.isArray(rows) ? rows : []];
            } catch {
              return [p.project_id, []];
            }
          })
        );
        if (cancelled) return;
        setTasksByProject(new Map(entries));
      } catch {
        if (!cancelled) setTasksError('Could not load project tasks.');
      } finally {
        if (!cancelled) setLoadingTasks(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projects]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchBaySchedules({ limit: 2000 });
        if (cancelled) return;
        const byProject = new Map();
        for (const row of rows) {
          const pid = row.project_id;
          if (!pid) continue;
          if (!byProject.has(pid)) byProject.set(pid, []);
          byProject.get(pid).push({
            task_id: row.task_id,
            area_code: row.area_code,
            area_name: row.area_name,
            bay_codes: Array.isArray(row.bay_codes) ? row.bay_codes : [],
            start_date: row.start_date,
            end_date: row.end_date,
            status: row.status,
          });
        }
        setBookingsByProject(byProject);
      } catch {
        if (!cancelled) setBookingsByProject(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const toggleProject = useCallback((nodeId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const retryTasks = useCallback(() => setReloadToken((n) => n + 1), []);

  const openArea = useCallback(
    (areaCode, date) => {
      const params = new URLSearchParams({ area: areaCode });
      if (date) params.set('date', String(date).slice(0, 10));
      navigate(`/sow-scheduling/area?${params.toString()}`);
    },
    [navigate]
  );

  const filteredProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return projects;
    return projects.filter(
      (p) =>
        String(p.project_name || '')
          .toLowerCase()
          .includes(term) ||
        String(p.project_id || '')
          .toLowerCase()
          .includes(term)
    );
  }, [projects, search]);

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 md:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search projects..."
          className="w-full max-w-sm"
        />
        <button
          type="button"
          onClick={() => setReloadToken((n) => n + 1)}
          disabled={loadingProjects}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
        >
          <RotateCw className={`h-3.5 w-3.5 ${loadingProjects ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loadingProjects ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white py-20 text-sm text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading projects…
        </div>
      ) : projectsError ? (
        <FetchError message={projectsError} onRetry={() => setReloadToken((n) => n + 1)} />
      ) : filteredProjects.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white">
          <EmptyState
            icon={FolderSearch}
            title={search ? 'No projects found' : 'No projects yet'}
            action={
              search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
                >
                  Clear search
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ProjectScheduleGantt
          projects={filteredProjects}
          tasksByProject={tasksByProject}
          bookingsByProject={bookingsByProject}
          expandedIds={expandedIds}
          onToggle={toggleProject}
          onOpenArea={openArea}
          loading={loadingTasks}
          error={tasksError}
          onRetry={retryTasks}
        />
      )}
    </main>
  );
}
