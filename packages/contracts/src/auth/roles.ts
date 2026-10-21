/**
 * Canonical Role & Permission Matrix
 *
 * Implements strict deny-by-default RBAC per plant and domain action.
 * Rule: Technical admin does NOT automatically approve business transactions
 * (quotations, sales orders, QC release, or invoice posting).
 */

export const SYSTEM_ROLES = [
  'admin',
  'supervisor',
  'sales',
  'estimator',
  'engineering',
  'planner',
  'storekeeper',
  'operator',
  'qc',
  'maintenance',
  'dispatch',
  'finance',
  'auditor'
] as const;

export type RoleCode = (typeof SYSTEM_ROLES)[number];

export const PERMISSIONS = [
  // IAM & Platform (Technical Administration)
  'iam:user:read',
  'iam:user:write',
  'iam:role:manage',
  'iam:scope:manage',
  'iam:badge:manage',
  'iam:qualification:verify',
  'system:config:manage',
  'system:audit:read',

  // Commercial & Sales
  'commercial:inquiry:read',
  'commercial:inquiry:write',
  'commercial:estimate:write',
  'commercial:quotation:read',
  'commercial:quotation:write',
  'commercial:quotation:approve',
  'commercial:quotation:accept',
  'commercial:order:read',
  'commercial:order:write',
  'commercial:order:confirm',
  'commercial:order:amend',
  'commercial:order:cancel',

  // Engineering & Technical
  'engineering:document:read',
  'engineering:document:write',
  'engineering:document:release',
  'engineering:bom:read',
  'engineering:bom:write',
  'engineering:bom:release',
  'engineering:routing:read',
  'engineering:routing:write',
  'engineering:routing:release',

  // Repair & Remanufacturing
  'repair:asset:read',
  'repair:asset:register',
  'repair:case:read',
  'repair:case:intake',
  'repair:diagnostic:authorize',
  'repair:teardown:record',
  'repair:disposition:propose',
  'repair:disposition:approve',
  'repair:claim:read',
  'repair:claim:manage',

  // Planning
  'planning:workorder:read',
  'planning:workorder:create',
  'planning:workorder:release',
  'planning:schedule:read',
  'planning:schedule:manage',
  'planning:mrp:run',

  // Shop Floor Execution
  'execution:traveler:read',
  'execution:session:start',
  'execution:session:stop',
  'execution:material:consume',
  'execution:output:record',
  'execution:scrap:record',
  'execution:rework:order',

  // Quality & Inspection
  'quality:inspection:read',
  'quality:inspection:record',
  'quality:release:approve',
  'quality:ncr:create',
  'quality:ncr:disposition',
  'quality:spc:read',

  // Maintenance & Tooling
  'maintenance:equipment:read',
  'maintenance:equipment:manage',
  'maintenance:calibration:record',
  'maintenance:workorder:manage',

  // Logistics & Warehouse
  'logistics:stock:read',
  'logistics:movement:post',
  'logistics:reservation:create',
  'logistics:reservation:fulfill',
  'logistics:shipment:read',
  'logistics:shipment:manage',
  'logistics:shipment:dispatch',
  'logistics:pod:record',

  // Billing & Finance
  'billing:entitlement:read',
  'billing:invoice:read',
  'billing:invoice:create',
  'billing:invoice:approve',
  'billing:invoice:post',
  'billing:payment:allocate',
  'billing:deposit:apply'
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number];

export const RolePermissionMatrix: Record<RoleCode, readonly PermissionCode[]> = {
  admin: [
    'iam:user:read',
    'iam:user:write',
    'iam:role:manage',
    'iam:scope:manage',
    'iam:badge:manage',
    'iam:qualification:verify',
    'system:config:manage',
    'system:audit:read'
  ],

  supervisor: [
    'commercial:inquiry:read',
    'commercial:quotation:read',
    'commercial:order:read',
    'commercial:order:confirm',
    'engineering:document:read',
    'engineering:bom:read',
    'engineering:routing:read',
    'repair:case:read',
    'repair:disposition:approve',
    'planning:workorder:read',
    'planning:workorder:release',
    'planning:schedule:manage',
    'execution:traveler:read',
    'execution:rework:order',
    'quality:inspection:read',
    'quality:ncr:disposition',
    'logistics:stock:read',
    'logistics:shipment:read',
    'billing:invoice:read',
    'system:audit:read'
  ],

  sales: [
    'commercial:inquiry:read',
    'commercial:inquiry:write',
    'commercial:quotation:read',
    'commercial:quotation:write',
    'commercial:quotation:approve',
    'commercial:quotation:accept',
    'commercial:order:read',
    'commercial:order:write',
    'commercial:order:confirm',
    'commercial:order:amend',
    'commercial:order:cancel',
    'repair:asset:read',
    'repair:case:read',
    'repair:case:intake',
    'repair:diagnostic:authorize',
    'repair:claim:read',
    'repair:claim:manage',
    'billing:entitlement:read',
    'billing:invoice:read'
  ],

  estimator: [
    'commercial:inquiry:read',
    'commercial:estimate:write',
    'commercial:quotation:read',
    'commercial:quotation:write',
    'engineering:bom:read',
    'engineering:routing:read',
    'repair:case:read',
    'repair:teardown:record'
  ],

  engineering: [
    'engineering:document:read',
    'engineering:document:write',
    'engineering:document:release',
    'engineering:bom:read',
    'engineering:bom:write',
    'engineering:bom:release',
    'engineering:routing:read',
    'engineering:routing:write',
    'engineering:routing:release',
    'repair:asset:read',
    'repair:case:read',
    'repair:teardown:record',
    'repair:disposition:propose',
    'repair:disposition:approve',
    'quality:spc:read'
  ],

  planner: [
    'commercial:order:read',
    'engineering:bom:read',
    'engineering:routing:read',
    'planning:workorder:read',
    'planning:workorder:create',
    'planning:workorder:release',
    'planning:schedule:read',
    'planning:schedule:manage',
    'planning:mrp:run',
    'logistics:stock:read',
    'logistics:reservation:create',
    'logistics:reservation:fulfill',
    'execution:traveler:read'
  ],

  storekeeper: [
    'logistics:stock:read',
    'logistics:movement:post',
    'logistics:reservation:create',
    'logistics:reservation:fulfill',
    'logistics:shipment:read',
    'logistics:shipment:manage',
    'repair:asset:read',
    'repair:asset:register'
  ],

  operator: [
    'execution:traveler:read',
    'execution:session:start',
    'execution:session:stop',
    'execution:material:consume',
    'execution:output:record',
    'execution:scrap:record'
  ],

  qc: [
    'engineering:document:read',
    'quality:inspection:read',
    'quality:inspection:record',
    'quality:release:approve',
    'quality:ncr:create',
    'quality:ncr:disposition',
    'quality:spc:read',
    'repair:case:read',
    'repair:teardown:record',
    'maintenance:calibration:record'
  ],

  maintenance: [
    'maintenance:equipment:read',
    'maintenance:equipment:manage',
    'maintenance:calibration:record',
    'maintenance:workorder:manage'
  ],

  dispatch: [
    'logistics:stock:read',
    'logistics:shipment:read',
    'logistics:shipment:manage',
    'logistics:shipment:dispatch',
    'logistics:pod:record'
  ],

  finance: [
    'commercial:quotation:read',
    'commercial:order:read',
    'logistics:shipment:read',
    'billing:entitlement:read',
    'billing:invoice:read',
    'billing:invoice:create',
    'billing:invoice:approve',
    'billing:invoice:post',
    'billing:payment:allocate',
    'billing:deposit:apply'
  ],

  auditor: [
    'system:audit:read',
    'commercial:inquiry:read',
    'commercial:quotation:read',
    'commercial:order:read',
    'engineering:document:read',
    'engineering:bom:read',
    'engineering:routing:read',
    'repair:case:read',
    'repair:claim:read',
    'planning:workorder:read',
    'planning:schedule:read',
    'execution:traveler:read',
    'quality:inspection:read',
    'quality:spc:read',
    'logistics:stock:read',
    'logistics:shipment:read',
    'billing:entitlement:read',
    'billing:invoice:read'
  ]
};

export function hasPermission(role: RoleCode, permission: PermissionCode): boolean {
  const allowed = RolePermissionMatrix[role];
  return allowed ? allowed.includes(permission) : false;
}

export function assertRolePermission(role: RoleCode, permission: PermissionCode): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Access Denied: Role "${role}" lacks required permission "${permission}"`);
  }
}
