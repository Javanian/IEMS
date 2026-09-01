export const LEVELS = {
  NO_ACCESS: 'no_access',
  READ_ONLY: 'read_only',
  FULL_ACCESS: 'full_access',
};

const RANK = {
  [LEVELS.NO_ACCESS]: 0,
  [LEVELS.READ_ONLY]: 1,
  [LEVELS.FULL_ACCESS]: 2,
};

export function rankOf(level) {
  return RANK[level] ?? 0;
}

export const ROLES = ['administrator', 'supervisor', 'foreman', 'warehouse', 'user'];

export function normalizeRole(role) {
  const r = String(role || '')
    .trim()
    .toLowerCase();
  if (r === 'admin') return 'administrator';
  return r;
}

const DEFAULT_KEY = '__default__';

export const PERMISSION_MATRIX = {
  administrator: {
    [DEFAULT_KEY]: LEVELS.FULL_ACCESS,
  },

  supervisor: {
    [DEFAULT_KEY]: LEVELS.READ_ONLY,
    sow_management: LEVELS.FULL_ACCESS,
    sow_scheduling: LEVELS.FULL_ACCESS,
    timesheet_validation: LEVELS.FULL_ACCESS,
    machine_hours: LEVELS.FULL_ACCESS,
    roster_operator: LEVELS.FULL_ACCESS,
    roster_foreman_team: LEVELS.FULL_ACCESS,
    manage_users: LEVELS.NO_ACCESS,
    ms_project_admin: LEVELS.NO_ACCESS,
    config_rules: LEVELS.FULL_ACCESS,
  },

  foreman: {
    [DEFAULT_KEY]: LEVELS.READ_ONLY,
    sow_management: LEVELS.FULL_ACCESS,
    timesheet_validation: LEVELS.FULL_ACCESS,
    machine_hours: LEVELS.FULL_ACCESS,
    roster_operator: LEVELS.FULL_ACCESS,
    roster_foreman_team: LEVELS.FULL_ACCESS,
    manage_users: LEVELS.NO_ACCESS,
    ms_project_admin: LEVELS.NO_ACCESS,
  },

  warehouse: {
    [DEFAULT_KEY]: LEVELS.NO_ACCESS,
    operations_hub: LEVELS.READ_ONLY,
    dashboard: LEVELS.READ_ONLY,
    consumable_control: LEVELS.FULL_ACCESS,
    tools_management: LEVELS.FULL_ACCESS,
    receiving_shipment: LEVELS.FULL_ACCESS,
    component_tracking: LEVELS.READ_ONLY,
    sow_management: LEVELS.READ_ONLY,
  },

  user: {
    [DEFAULT_KEY]: LEVELS.NO_ACCESS,
    operations_hub: LEVELS.READ_ONLY,
    dashboard: LEVELS.READ_ONLY,
    ews: LEVELS.READ_ONLY,
    sow_management: LEVELS.READ_ONLY,
  },
};

const UNKNOWN_ROLE_LEVEL = LEVELS.NO_ACCESS;

export function resolveLevel(role, featureId) {
  const normalized = normalizeRole(role);
  const roleMatrix = PERMISSION_MATRIX[normalized];
  if (!roleMatrix) return UNKNOWN_ROLE_LEVEL;
  return roleMatrix[featureId] ?? roleMatrix[DEFAULT_KEY] ?? LEVELS.NO_ACCESS;
}

export function canRead(level) {
  return rankOf(level) >= RANK[LEVELS.READ_ONLY];
}

export function canWrite(level) {
  return rankOf(level) >= RANK[LEVELS.FULL_ACCESS];
}

const WRITE_ACTIONS = new Set([
  'write',
  'create',
  'edit',
  'update',
  'delete',
  'submit',
  'save',
  'approve',
]);

export function actionAllowed(level, action) {
  if (WRITE_ACTIONS.has(String(action || '').toLowerCase())) return canWrite(level);
  return canRead(level);
}
