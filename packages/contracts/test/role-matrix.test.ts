import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYSTEM_ROLES,
  PERMISSIONS,
  RolePermissionMatrix,
  hasPermission,
  assertRolePermission,
  type RoleCode
} from '../src/auth/roles.js';

test('Role matrix - all 13 canonical roles registered', () => {
  assert.strictEqual(SYSTEM_ROLES.length, 13);
  const expectedRoles = [
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
  ];

  for (const role of expectedRoles as RoleCode[]) {
    assert.ok(SYSTEM_ROLES.includes(role), `Role ${role} missing from SYSTEM_ROLES`);
    assert.ok(RolePermissionMatrix[role], `Role ${role} missing from RolePermissionMatrix`);
  }
});

test('Role matrix - permissions assigned in matrix are all declared in PERMISSIONS', () => {
  const permSet = new Set(PERMISSIONS);
  for (const role of SYSTEM_ROLES) {
    const rolePerms = RolePermissionMatrix[role];
    for (const p of rolePerms) {
      assert.ok(permSet.has(p), `Role ${role} has undeclared permission: ${p}`);
    }
  }
});

test('Separation of duties: Technical Admin cannot approve business transactions', () => {
  // Admin is IT/Platform only, NOT business approver
  assert.strictEqual(hasPermission('admin', 'commercial:quotation:approve'), false);
  assert.strictEqual(hasPermission('admin', 'commercial:order:confirm'), false);
  assert.strictEqual(hasPermission('admin', 'quality:release:approve'), false);
  assert.strictEqual(hasPermission('admin', 'billing:invoice:post'), false);

  assert.throws(() => assertRolePermission('admin', 'commercial:quotation:approve'), /Access Denied/);
});

test('Domain role authority assertions', () => {
  // Sales
  assert.strictEqual(hasPermission('sales', 'commercial:quotation:approve'), true);
  assert.strictEqual(hasPermission('sales', 'commercial:order:confirm'), true);
  assert.strictEqual(hasPermission('sales', 'execution:session:start'), false);

  // Finance
  assert.strictEqual(hasPermission('finance', 'billing:invoice:post'), true);
  assert.strictEqual(hasPermission('finance', 'billing:payment:allocate'), true);
  assert.strictEqual(hasPermission('finance', 'engineering:bom:release'), false);

  // Operator
  assert.strictEqual(hasPermission('operator', 'execution:session:start'), true);
  assert.strictEqual(hasPermission('operator', 'execution:output:record'), true);
  assert.strictEqual(hasPermission('operator', 'commercial:quotation:write'), false);

  // QC
  assert.strictEqual(hasPermission('qc', 'quality:release:approve'), true);
  assert.strictEqual(hasPermission('qc', 'quality:inspection:record'), true);
  assert.strictEqual(hasPermission('qc', 'billing:invoice:post'), false);

  // Auditor has read-only access, zero write access
  const auditorPerms = RolePermissionMatrix.auditor;
  assert.ok(auditorPerms.length > 0);
  for (const p of auditorPerms) {
    assert.ok(p.endsWith(':read'), `Auditor should only have read permissions, found: ${p}`);
  }
});
