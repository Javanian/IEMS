/**
 * Core & IAM Domain JSON Schemas
 */

import { SYSTEM_ROLES, PERMISSIONS } from '../../auth/roles.js';
import { ISO_CURRENCIES } from '../../common/decimal.js';

export const OrganizationSchema = {
  $id: 'https://iems.org/schemas/core-iam/organization.json',
  type: 'object',
  required: ['id', 'code', 'name', 'status', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    code: { type: 'string', minLength: 2, maxLength: 32 },
    name: { type: 'string', minLength: 2, maxLength: 255 },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const LegalEntitySchema = {
  $id: 'https://iems.org/schemas/core-iam/legal-entity.json',
  type: 'object',
  required: ['id', 'organizationId', 'code', 'name', 'taxId', 'baseCurrency', 'status', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    code: { type: 'string', minLength: 2, maxLength: 32 },
    name: { type: 'string', minLength: 2, maxLength: 255 },
    taxId: { type: 'string', minLength: 3, maxLength: 64 },
    baseCurrency: { type: 'string', enum: ISO_CURRENCIES },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const PlantSchema = {
  $id: 'https://iems.org/schemas/core-iam/plant.json',
  type: 'object',
  required: ['id', 'legalEntityId', 'code', 'name', 'timezone', 'address', 'status', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    legalEntityId: { type: 'string', format: 'uuid' },
    code: { type: 'string', minLength: 2, maxLength: 32 },
    name: { type: 'string', minLength: 2, maxLength: 255 },
    timezone: { type: 'string', minLength: 3, maxLength: 64 },
    address: { type: 'string', minLength: 5, maxLength: 500 },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const UserSchema = {
  $id: 'https://iems.org/schemas/core-iam/user.json',
  type: 'object',
  required: ['id', 'organizationId', 'username', 'email', 'displayName', 'status', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    username: { type: 'string', minLength: 3, maxLength: 64 },
    email: { type: 'string', format: 'email' },
    displayName: { type: 'string', minLength: 2, maxLength: 128 },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const RoleSchema = {
  $id: 'https://iems.org/schemas/core-iam/role.json',
  type: 'object',
  required: ['id', 'code', 'name', 'description', 'isSystemRole'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    code: { type: 'string', enum: SYSTEM_ROLES },
    name: { type: 'string', minLength: 2, maxLength: 64 },
    description: { type: 'string', maxLength: 255 },
    isSystemRole: { type: 'boolean' }
  },
  additionalProperties: false
} as const;

export const PermissionSchema = {
  $id: 'https://iems.org/schemas/core-iam/permission.json',
  type: 'object',
  required: ['id', 'code', 'module', 'action', 'description'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    code: { type: 'string', enum: PERMISSIONS },
    module: { type: 'string', minLength: 2, maxLength: 64 },
    action: { type: 'string', minLength: 2, maxLength: 64 },
    description: { type: 'string', maxLength: 255 }
  },
  additionalProperties: false
} as const;

export const UserScopeSchema = {
  $id: 'https://iems.org/schemas/core-iam/user-scope.json',
  type: 'object',
  required: ['id', 'userId', 'roleId', 'isExplicitGrant', 'validFrom'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    roleId: { type: 'string', format: 'uuid' },
    plantId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    isExplicitGrant: { type: 'boolean' },
    validFrom: { type: 'string', format: 'date-time' },
    validTo: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const SessionSchema = {
  $id: 'https://iems.org/schemas/core-iam/session.json',
  type: 'object',
  required: ['id', 'userId', 'plantId', 'tokenHash', 'issuedAt', 'expiresAt', 'clientIp', 'userAgent'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    plantId: { type: 'string' },
    tokenHash: { type: 'string', minLength: 32 },
    issuedAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' },
    revokedAt: { type: 'string', format: 'date-time' },
    clientIp: { type: 'string' },
    userAgent: { type: 'string' }
  },
  additionalProperties: false
} as const;

export const BadgeSchema = {
  $id: 'https://iems.org/schemas/core-iam/badge.json',
  type: 'object',
  required: ['id', 'employeeId', 'badgeNumber', 'nfcTagId', 'status', 'issuedAt', 'expiresAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    employeeId: { type: 'string', minLength: 2, maxLength: 64 },
    badgeNumber: { type: 'string', minLength: 3, maxLength: 64 },
    nfcTagId: { type: 'string', minLength: 4, maxLength: 128 },
    status: { type: 'string', enum: ['ACTIVE', 'REVOKED', 'EXPIRED'] },
    issuedAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const EmployeeQualificationSchema = {
  $id: 'https://iems.org/schemas/core-iam/employee-qualification.json',
  type: 'object',
  required: ['id', 'employeeId', 'skillCode', 'certificationLevel', 'evidenceReference', 'validFrom', 'validTo', 'verifiedBy', 'status'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    employeeId: { type: 'string', minLength: 2, maxLength: 64 },
    skillCode: { type: 'string', minLength: 2, maxLength: 64 },
    certificationLevel: { type: 'string', minLength: 1, maxLength: 32 },
    evidenceReference: { type: 'string', minLength: 2, maxLength: 255 },
    validFrom: { type: 'string', format: 'date-time' },
    validTo: { type: 'string', format: 'date-time' },
    verifiedBy: { type: 'string', minLength: 2, maxLength: 128 },
    status: { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'REVOKED'] }
  },
  additionalProperties: false
} as const;
