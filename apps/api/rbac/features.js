const FEATURES = [
  { id: 'operations_hub', label: 'Operations Hub' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'order_progress', label: 'Order Progress' },
  { id: 'ews', label: 'Early Warning' },
  { id: 'sow_management', label: 'SOW Management' },
  { id: 'sow_scheduling', label: 'SOW Scheduling' },
  { id: 'sow_verification', label: 'SOW Verification' },

  { id: 'sow_subcont', label: 'SOW Subcont' },
  { id: 'shift_rules', label: 'Shift Capacity' },
  { id: 'roster_operator', label: 'Roster Operator' },

  { id: 'bay_scheduling', label: 'Bay Scheduling' },
  { id: 'msproject_mapping', label: 'MS Project Mapping' },
  { id: 'msproject_collab', label: 'MS Project Collaboration' },
  { id: 'ms_project_admin', label: 'MS Project Admin' },
  { id: 'component_tracking', label: 'Component Tracking' },
  { id: 'kanban_board', label: 'Kanban Board' },
  { id: 'buffer_transaction', label: 'Buffer Transaction' },
  { id: 'receiving_shipment', label: 'Receiving & Shipping' },
  { id: 'consumable_control', label: 'Consumable Control' },
  { id: 'tools_management', label: 'Tools Management' },
  { id: 'timesheet_validation', label: 'Timesheet Validation' },
  { id: 'operator_performance', label: 'Operator Performance' },
  { id: 'machine_hours', label: 'Machine Hours' },
  { id: 'nfc_users', label: 'NFC Users' },
  { id: 'sap_log', label: 'SAP Log' },
  { id: 'manage_users', label: 'Manage Users' },
];

const FEATURE_IDS = FEATURES.map((f) => f.id);
const FEATURE_ID_SET = new Set(FEATURE_IDS);

module.exports = { FEATURES, FEATURE_IDS, FEATURE_ID_SET };
