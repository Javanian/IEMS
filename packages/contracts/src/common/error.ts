/**
 * Canonical Error Envelope & Codes
 *
 * All failed API responses follow this single envelope contract.
 * Never leak stack traces, internal database columns, or remote credentials to UI.
 */

export const ERROR_CODES = {
  // Authentication & Session
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  INVALID_BADGE_TOKEN: 'INVALID_BADGE_TOKEN',

  // Validation & Input
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  MALFORMED_DECIMAL: 'MALFORMED_DECIMAL',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',

  // Concurrency & Idempotency
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
  OPTIMISTIC_LOCK_CONFLICT: 'OPTIMISTIC_LOCK_CONFLICT',
  IDEMPOTENCY_PAYLOAD_MISMATCH: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
  IDEMPOTENCY_IN_PROGRESS: 'IDEMPOTENCY_IN_PROGRESS',

  // Business Rules & Domain Invariants
  EXCEEDED_BILLING_CAP: 'EXCEEDED_BILLING_CAP',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  UNAUTHORIZED_DISPOSITION: 'UNAUTHORIZED_DISPOSITION',
  OBSOLETE_REVISION_REJECTED: 'OBSOLETE_REVISION_REJECTED',
  UNAUTHORIZED_DIAGNOSTIC_SCOPE: 'UNAUTHORIZED_DIAGNOSTIC_SCOPE',
  MISSING_CUSTOMER_AUTHORIZATION: 'MISSING_CUSTOMER_AUTHORIZATION',
  UNQUALIFIED_OPERATOR: 'UNQUALIFIED_OPERATOR',
  EXPIRED_CALIBRATION: 'EXPIRED_CALIBRATION',
  ALREADY_POSTED: 'ALREADY_POSTED',

  // System & Integration
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  BAD_GATEWAY: 'BAD_GATEWAY',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  ADAPTER_TIMEOUT_UNKNOWN: 'ADAPTER_TIMEOUT_UNKNOWN'
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface FieldError {
  field: string;
  message: string;
  code?: string;
  rejectedValue?: unknown;
}

export interface ErrorEnvelope {
  code: ErrorCode | string;
  message: string;
  correlationId: string;
  timestamp: string;
  path: string;
  fieldErrors?: FieldError[];
  details?: Record<string, unknown>;
}

export function createErrorEnvelope(params: {
  code: ErrorCode | string;
  message: string;
  correlationId: string;
  path: string;
  fieldErrors?: FieldError[];
  details?: Record<string, unknown>;
  timestamp?: string;
}): ErrorEnvelope {
  return {
    code: params.code,
    message: params.message,
    correlationId: params.correlationId,
    timestamp: params.timestamp ?? new Date().toISOString(),
    path: params.path,
    ...(params.fieldErrors && params.fieldErrors.length > 0 ? { fieldErrors: params.fieldErrors } : {}),
    ...(params.details ? { details: params.details } : {})
  };
}

export const FieldErrorSchema = {
  $id: 'https://iems.org/schemas/common/field-error.json',
  type: 'object',
  required: ['field', 'message'],
  properties: {
    field: { type: 'string', description: 'Dot-delimited field path (e.g. "lines[0].quantity").' },
    message: { type: 'string', description: 'Human-readable explanation of why the field failed validation.' },
    code: { type: 'string', description: 'Optional specific error code for field.' },
    rejectedValue: { description: 'The rejected value (omitted if sensitive).' }
  },
  additionalProperties: false
} as const;

export const ErrorEnvelopeSchema = {
  $id: 'https://iems.org/schemas/common/error-envelope.json',
  type: 'object',
  required: ['code', 'message', 'correlationId', 'timestamp', 'path'],
  properties: {
    code: {
      type: 'string',
      description: 'Machine-readable stable error code.'
    },
    message: {
      type: 'string',
      description: 'Human-readable message explaining the failure and remediation steps.'
    },
    correlationId: {
      type: 'string',
      description: 'Unique trace identifier for tracing the request across server logs.'
    },
    timestamp: {
      type: 'string',
      format: 'date-time',
      description: 'ISO-8601 UTC timestamp when error occurred.'
    },
    path: {
      type: 'string',
      description: 'Canonical API path of the request.'
    },
    fieldErrors: {
      type: 'array',
      items: { $ref: 'https://iems.org/schemas/common/field-error.json' },
      description: 'Specific validation errors per field, if applicable.'
    },
    details: {
      type: 'object',
      additionalProperties: true,
      description: 'Structured metadata clarifying the conflict or constraint violation.'
    }
  },
  additionalProperties: false
} as const;
