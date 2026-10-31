export type UUID = string;
export interface FoundationCommand {
  tenantId: UUID; plantId: UUID; action: string; key: string; aggregateId: UUID;
  expectedRevision: number; input: unknown;
}
export interface CommandOutput {
  data: unknown; revision: number; events: Array<{ type: string; version: number; data: unknown }>;
}
export class CommandError extends Error { code: string; status: number; constructor(code: string, status: number, message?: string); }
export function canonicalJson(value: unknown): string;
export function contentHash(value: unknown): string;
export function boundedTransaction<T>(client: { startSession: (...args: any[]) => any }, effect: (session: { inTransaction(): boolean; [key: string]: any }) => Promise<T>, options?: { attempts?: number; commitAttempts?: number }): Promise<T>;
export type CommandAdmission = (descriptor: { scope: VerifiedScope; grant: Grant; session: { inTransaction(): boolean; [key: string]: any }; namespace: string; key: string; action: string; aggregateId: string; payloadHash: string; replayed: boolean }) => Promise<unknown>;
export function createCommandExecutor(options: { client: { startSession: (...args: any[]) => any }; db: { collection: (...args: any[]) => any }; foundation: TenantFoundation; admission?: CommandAdmission }): {
  initialize(): Promise<void>;
  execute(scope: VerifiedScope, command: FoundationCommand, effect: (context: { session: { inTransaction(): boolean; [key: string]: any }; grant: Grant; aggregateId: UUID; expectedRevision: number; input: unknown }) => Promise<CommandOutput>): Promise<{ data: unknown; revision: number; commandId: UUID; replayed: boolean }>;
  readResource(scope: VerifiedScope, target: Target & { collection: 'files' | 'jobs' | 'exports' | 'readModels'; resourceId: string }): Promise<Record<string, unknown>>;
};
declare const verified: unique symbol;
export interface VerifiedScope {
  readonly [verified]: true;
  readonly tenantId: UUID;
  readonly userId: UUID;
  readonly membershipId: UUID;
  readonly membershipVersion: number;
  readonly selectedPlantId: UUID;
}
export interface Target { tenantId?: UUID; plantId: UUID; action: string }
export interface Grant { readonly tenantId: UUID; readonly plantId: UUID; readonly legalEntityId: UUID; readonly userId: UUID; readonly membershipId: UUID; readonly membershipVersion: number }
export interface SessionIssue { token: string; sessionId: UUID; expiresAt: Date }
export interface RoleGrant { role: string; plantIds: UUID[]; tenantWide?: boolean }
export interface Audit { _id: UUID; tenantId: UUID; kind: string; subjectId: UUID; occurredAt: Date }
export interface TenantFoundation {
  initialize(): Promise<void>;
  provisionTenant(input: { id: UUID }): Promise<UUID>;
  provisionUser(input: { id: UUID; tenantId: UUID }): Promise<UUID>;
  provisionLegalEntity(input: { id: UUID; tenantId: UUID }): Promise<UUID>;
  provisionPlant(input: { id: UUID; tenantId: UUID; legalEntityId: UUID }): Promise<UUID>;
  provisionMembership(input: { id: UUID; tenantId: UUID; userId: UUID; legalEntityIds: UUID[]; plantIds: UUID[]; tenantWide?: boolean; roles: RoleGrant[] }): Promise<UUID>;
  issueSession(input: { userId: UUID; tenantId: UUID; selectedPlantId: UUID; ttlMs: number }): Promise<SessionIssue>;
  authenticate(token: string): Promise<VerifiedScope>;
  authorize(scope: VerifiedScope, target: Target): Promise<Grant>;
  // Call before idempotency/effects on EVERY transaction callback retry; session must be active and from the same MongoClient.
  // Writes session, membership (including role grants), and active scope records to conflict with concurrent revocation.
  authorizeInTransaction(scope: VerifiedScope, target: Target, options: { session: { inTransaction(): boolean } }): Promise<Grant>;
  scopedFilter(scope: VerifiedScope, target: Target, predicate?: Record<string, unknown>): Promise<{ $and: [ { tenantId: UUID; plantId: UUID }, Record<string, unknown> ] }>;
  switchSession(scope: VerifiedScope, input: { tenantId: UUID; selectedPlantId: UUID; ttlMs: number }): Promise<SessionIssue>;
  revokeSession(input: { tenantId: UUID; sessionId: UUID }): Promise<void>;
  invalidateMembership(input: { tenantId: UUID; membershipId: UUID; expectedVersion: number; active: boolean }): Promise<void>;
  listAudit(input: { tenantId: UUID; limit?: number }): Promise<Audit[]>;
}
export class ScopeDenied extends Error { readonly code: 'SCOPE_DENIED'; readonly status: 403 }
export function resolveScopeAliases(sources?: { body?: Record<string, unknown>; query?: Record<string, unknown>; headers?: Record<string, unknown> }): Readonly<{ tenantId: UUID; plantId: UUID }>;
// Pass real MongoClient/Db from the integration's installed driver, not request objects.
export function createTenantFoundation(options: { client: { startSession: (...args: any[]) => any }; db: { collection: (...args: any[]) => any }; roleActions: Readonly<Record<string, readonly string[]>> }): TenantFoundation;
