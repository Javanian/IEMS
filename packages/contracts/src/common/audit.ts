/**
 * Canonical Audit & State Transition Metadata
 *
 * Implements immutable traceability: every mutation records actor, timestamp,
 * version, and correlation ID.
 */

export interface AuditMetadata {
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
  version: number;
}

export interface TransitionRecord {
  fromState: string;
  toState: string;
  actorId: string;
  timestamp: string;
  reason?: string;
  correlationId: string;
}

export const AuditMetadataSchema = {
  $id: 'https://iems.org/schemas/common/audit-metadata.json',
  type: 'object',
  required: ['createdBy', 'createdAt', 'version'],
  properties: {
    createdBy: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedBy: { type: 'string', format: 'uuid' },
    updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1, description: 'Optimistic locking concurrency counter' }
  },
  additionalProperties: false
} as const;

export const TransitionRecordSchema = {
  $id: 'https://iems.org/schemas/common/transition-record.json',
  type: 'object',
  required: ['fromState', 'toState', 'actorId', 'timestamp', 'correlationId'],
  properties: {
    fromState: { type: 'string' },
    toState: { type: 'string' },
    actorId: { type: 'string', format: 'uuid' },
    timestamp: { type: 'string', format: 'date-time' },
    reason: { type: 'string' },
    correlationId: { type: 'string' }
  },
  additionalProperties: false
} as const;
