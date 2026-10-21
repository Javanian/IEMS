/**
 * Core & IAM Domain Types
 *
 * Covers organizational boundaries, plants, identities, RBAC, sessions, badges,
 * and operator qualifications.
 */

import type { RoleCode, PermissionCode } from '../../auth/roles.js';
import type { CurrencyCode } from '../../common/decimal.js';

export interface Organization {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface LegalEntity {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  taxId: string;
  baseCurrency: CurrencyCode;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface Plant {
  id: string;
  legalEntityId: string;
  code: string;
  name: string;
  timezone: string;
  address: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  organizationId: string;
  username: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  code: RoleCode;
  name: string;
  description: string;
  isSystemRole: boolean;
}

export interface Permission {
  id: string;
  code: PermissionCode;
  module: string;
  action: string;
  description: string;
}

export interface UserScope {
  id: string;
  userId: string;
  roleId: string;
  plantId: string | null;
  isExplicitGrant: boolean;
  validFrom: string;
  validTo?: string;
}

export interface Session {
  id: string;
  userId: string;
  plantId: string;
  tokenHash: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
  clientIp: string;
  userAgent: string;
}

export interface Badge {
  id: string;
  employeeId: string;
  badgeNumber: string;
  nfcTagId: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  issuedAt: string;
  expiresAt: string;
}

export interface EmployeeQualification {
  id: string;
  employeeId: string;
  skillCode: string;
  certificationLevel: string;
  evidenceReference: string;
  validFrom: string;
  validTo: string;
  verifiedBy: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}
