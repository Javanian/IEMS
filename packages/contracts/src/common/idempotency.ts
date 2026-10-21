/**
 * Canonical Idempotency Contract
 *
 * Request metadata for endpoints that support idempotency.
 * Storage, scope isolation and replay enforcement belong to the server.
 */

import { createHash } from 'node:crypto';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{8,128}$/;

export type IdempotencyStatus = 'PENDING' | 'RESOLVED' | 'FAILED';

export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  clientPath: string;
  clientMethod: string;
  statusCode?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  status: IdempotencyStatus;
  createdAt: string;
  expiresAt: string;
}

export function computeRequestHash(method: string, path: string, body: unknown): string {
  const normalizedMethod = method.toUpperCase().trim();
  const normalizedPath = path.toLowerCase().trim().replace(/\/+$/, '') || '/';
  const serializedBody = body === undefined || body === null ? '' : JSON.stringify(body);

  return createHash('sha256')
    .update(`${normalizedMethod}|${normalizedPath}|${serializedBody}`)
    .digest('hex');
}

export function isValidIdempotencyKey(key: unknown): boolean {
  return typeof key === 'string' && IDEMPOTENCY_KEY_REGEX.test(key);
}

export const IdempotencyRecordSchema = {
  $id: 'https://iems.org/schemas/common/idempotency-record.json',
  type: 'object',
  required: ['key', 'requestHash', 'clientPath', 'clientMethod', 'status', 'createdAt', 'expiresAt'],
  properties: {
    key: {
      type: 'string',
      pattern: '^[A-Za-z0-9_-]{8,128}$',
      description: 'Client-supplied unique idempotency key.'
    },
    requestHash: {
      type: 'string',
      pattern: '^[a-f0-9]{64}$',
      description: 'SHA-256 digest of method + canonical path + serialized body.'
    },
    clientPath: { type: 'string' },
    clientMethod: { type: 'string' },
    statusCode: { type: 'integer', minimum: 100, maximum: 599 },
    responseHeaders: {
      type: 'object',
      additionalProperties: { type: 'string' }
    },
    responseBody: { description: 'Cached JSON response body' },
    status: {
      type: 'string',
      enum: ['PENDING', 'RESOLVED', 'FAILED']
    },
    createdAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;
