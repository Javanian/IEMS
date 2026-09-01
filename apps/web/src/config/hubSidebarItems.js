import {
  BarChart2,
  Bell,
  BookOpen,
  Boxes,
  CalendarClock,
  ClipboardList,
  CreditCard,
  Database,
  Factory,
  Gauge,
  Hammer,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck,
  TimerReset,
  Truck,
  UserCog,
  Users,
  UsersRound,
} from 'lucide-react';

export const sidebarItems = [
  { title: 'Dashboard', icon: LayoutDashboard, path: '/dashboard', group: 'Overview' },
  {
    title: 'Order Progress',
    icon: BarChart2,
    path: '/order-progress-dashboard',
    group: 'Overview',
  },
  { title: 'Update Progress', icon: ListChecks, path: '/progress-update', group: 'Overview' },
  {
    title: 'SOW Management',
    icon: BookOpen,
    path: '/sow-management/list',
    group: 'SOW & Planning',
  },
  {
    title: 'SOW Scheduling',
    icon: CalendarClock,
    path: '/sow-scheduling',
    group: 'SOW & Planning',
  },
  { title: 'Shift Capacity', icon: TimerReset, path: '/shift-definition', group: 'SOW & Planning' },
  { title: 'Roster Operator', icon: Users, path: '/ews/roster', group: 'Production' },
  { title: 'Foreman Team', icon: UsersRound, path: '/ews/foreman-team', group: 'Production' },
  { title: 'EWS Notifications', icon: Bell, path: '/ews/notifications', group: 'Production' },
  { title: 'Kanban Board', icon: Factory, path: '/kanban-board', group: 'Production' },
  { title: 'Component Tracking', icon: Boxes, path: '/component-tracking', group: 'Production' },
  { title: 'Receiving & Shipping', icon: Truck, path: '/receiving-shipment', group: 'Production' },
  {
    title: 'Consumable Control',
    icon: ClipboardList,
    path: '/consumable-control',
    group: 'Inventory & Tools',
  },
  {
    title: 'Tools Management',
    icon: Hammer,
    path: '/tools-management',
    group: 'Inventory & Tools',
  },
  {
    title: 'MS Project Admin',
    icon: ShieldCheck,
    path: '/ms-project-admin',
    group: 'Administration',
  },
  { title: 'Configuration Rules', icon: Settings, path: '/config-rules', group: 'Administration' },
  { title: 'Manage User', icon: UserCog, path: '/manage-user', group: 'Administration' },

  { title: 'NFC Users', icon: CreditCard, path: '/nfc-users', group: 'Administration' },
  { title: 'TimeSheet', icon: ShieldCheck, path: '/timesheet-validation', group: 'Administration' },
  {
    title: 'Machine Hours',
    icon: Gauge,
    path: '/machine-hours-sqlserver',
    group: 'Administration',
  },
  { title: 'SAP Log', icon: Database, path: '/sap-log', group: 'Administration' },
];

export const HUB_HIDDEN_MENUS_KEY = 'mps2.hubHiddenMenus';

export function getHiddenHubMenus() {
  try {
    const raw = JSON.parse(localStorage.getItem(HUB_HIDDEN_MENUS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function setHiddenHubMenus(paths) {
  localStorage.setItem(HUB_HIDDEN_MENUS_KEY, JSON.stringify(paths));
}
