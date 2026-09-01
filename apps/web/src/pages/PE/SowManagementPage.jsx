import React from 'react';
import { useNavigate, Outlet, useLocation } from 'react-router-dom';
import { List, PlusCircle, Clock, ChevronLeft, ListTree } from 'lucide-react';
import { useCan } from '../../rbac';
import { isManufacturing } from '../../config/appVariant';

const navItems = [
  {
    label: 'SOW List',
    icon: List,
    path: '/sow-management/list',
    description: 'Standard SOW master data',
  },
  {
    label: 'Create SOW',
    icon: PlusCircle,
    path: '/sow-management/create',
    description: 'Tambah SOW baru',
    requiresWrite: true,
  },
  {
    label: 'SOW History',
    icon: Clock,
    path: '/sow-management/history',
    description: 'Riwayat perubahan SOW',
  },

  {
    label: 'Sub-task Standard',
    icon: ListTree,
    path: '/sow-management/subtask-standard',
    description: 'Sub-task standar per operasi (per part number)',
    manufacturingOnly: true,
  },
];

const SowManagementPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const canWriteSow = useCan('sow_management', 'write');
  const manufacturing = isManufacturing();
  const visibleNavItems = navItems.filter(
    (item) => (!item.requiresWrite || canWriteSow) && (!item.manufacturingOnly || manufacturing)
  );

  return (
    <div className="h-screen h-dvh w-screen flex flex-col bg-slate-50">
      {}
      <header
        className="flex-shrink-0 flex items-center justify-between px-4 md:px-6 py-2.5
                         bg-white border-b border-slate-200 shadow-sm"
      >
        <button
          onClick={() => navigate('/operations-hub')}
          className="min-h-[44px] min-w-[44px] flex items-center gap-1.5
                     bg-white border border-slate-200 text-slate-700
                     hover:bg-slate-50 hover:border-slate-300 px-3 py-1.5
                     rounded-lg text-xs font-semibold transition-all active:scale-95"
        >
          <ChevronLeft size={14} />
          Back
        </button>
        <h1 className="text-sm md:text-base font-extrabold text-slate-800">SOW Management</h1>
        <div className="w-[72px]" /> {}
      </header>

      {}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {}
        <aside
          className="flex-shrink-0 bg-white border-b border-slate-200
                          md:border-b-0 md:border-r md:w-56 md:overflow-y-auto"
        >
          {}
          <div className="px-4 py-3 border-b border-slate-100">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Menu
            </span>
          </div>

          {}
          <nav className="flex flex-row md:flex-col px-2 py-2 gap-1">
            {visibleNavItems.map((item) => {
              const isActive = location.pathname === item.path;
              const Icon = item.icon;

              if (item.disabled) {
                return (
                  <div
                    key={item.path}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg
                               opacity-40 cursor-not-allowed select-none"
                  >
                    <Icon size={16} className="text-slate-400 flex-shrink-0" />
                    <div className="hidden md:block">
                      <div className="text-xs font-semibold text-slate-500">{item.label}</div>
                      <div className="text-[10px] text-slate-400">{item.description}</div>
                    </div>
                    <span
                      className="hidden md:inline-block ml-auto text-[9px] font-bold
                                     bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full"
                    >
                      Soon
                    </span>
                  </div>
                );
              }

              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left
                              min-h-[44px] w-full transition-all active:scale-95
                              ${isActive ? 'text-white' : 'text-slate-700 hover:bg-slate-50'}`}
                  style={
                    isActive
                      ? {
                          background: 'linear-gradient(135deg, #023e8a 0%, #0077b6 100%)',
                        }
                      : {}
                  }
                >
                  <Icon
                    size={16}
                    className={`flex-shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`}
                  />
                  <div className="hidden md:block">
                    <div
                      className={`text-xs font-semibold ${isActive ? 'text-white' : 'text-slate-700'}`}
                    >
                      {item.label}
                    </div>
                    <div
                      className={`text-[10px] ${isActive ? 'text-[#ade8f4]' : 'text-slate-400'}`}
                    >
                      {item.description}
                    </div>
                  </div>
                  <span className="md:hidden text-xs font-semibold">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {}
        <div className="flex-1 overflow-y-auto bg-slate-50">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default SowManagementPage;
