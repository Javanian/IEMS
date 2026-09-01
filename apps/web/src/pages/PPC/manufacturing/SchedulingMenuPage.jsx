import React from 'react';
import {
  CalendarClock,
  ChevronRight,
  DatabaseZap,
  ExternalLink,
  FolderKanban,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const FEATURE_TILES = [
  {
    key: 'projects',
    to: '/sow-scheduling/projects',
    label: 'View All Projects',
    description: 'MS Project files and tasks',
    icon: FolderKanban,
  },
  {
    key: 'map',
    to: '/sow-scheduling/map',
    label: 'Map SAP Operations',
    description: 'Link SOW operations to MS Project tasks',
    icon: DatabaseZap,
  },
  {
    key: 'area',
    to: '/sow-scheduling/area',
    label: 'Scheduling Area',
    description: 'Reserve bays and set area schedules',
    icon: CalendarClock,
  },
];

const ADMIN_TILE = {
  to: '/ms-project-admin',
  label: 'Super Admin Panel',
  description: 'Force check-in and revision locks',
  icon: ShieldCheck,
};

export default function SchedulingMenuPage() {
  const navigate = useNavigate();

  return (
    <main className="flex-1 px-4 py-6 md:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {FEATURE_TILES.map((tile) => {
            const Icon = tile.icon;
            return (
              <button
                key={tile.key}
                type="button"
                onClick={() => navigate(tile.to)}
                className="group flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all duration-150 hover:border-[#90e0ef] hover:bg-slate-50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none motion-reduce:transform-none"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#caf0f8] text-[#0077b6] transition-colors group-hover:bg-[#ade8f4]">
                  <Icon className="h-6 w-6" />
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-base font-extrabold text-slate-800">{tile.label}</span>
                  <ChevronRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
                </span>
                <span className="text-xs text-slate-500">{tile.description}</span>
              </button>
            );
          })}
        </div>

        {}
        <button
          type="button"
          onClick={() => navigate(ADMIN_TILE.to)}
          className="group mt-3 flex w-full items-center gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-left transition-all duration-150 hover:border-[#90e0ef] hover:bg-white active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none motion-reduce:transform-none"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-extrabold text-slate-800">{ADMIN_TILE.label}</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <ExternalLink className="h-3 w-3" />
                Other page
              </span>
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">{ADMIN_TILE.description}</span>
          </span>
          <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      </div>
    </main>
  );
}
