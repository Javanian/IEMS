export interface FoundationScope {
  tenantId: string;
  plantId: string;
  legalEntityId: string;
}

export interface FoundationCommandContract<Input> {
  tenantId: string;
  plantId: string;
  action: string;
  key: string;
  aggregateId: string;
  expectedRevision: number;
  input: Input;
}

export interface FoundationCommandResponse<Data> {
  data: Data;
  revision: number;
  commandId: string;
  replayed: boolean;
}

export interface FoundationEvent<Data> extends FoundationScope {
  _id: string;
  aggregateId: string;
  aggregateRevision: number;
  commandId: string;
  type: string;
  schemaVersion: number;
  occurredAt: string;
  data: Data;
}

export interface FoundationMigrationManifest {
  version: 1;
  runId: string;
  tenantId: string;
  authority: 'staging-only';
  counts: Record<string, number>;
  ledgerTotals: Record<string, string>;
  hash: string;
}

export type FoundationCommandFailure =
  | 'COMMIT_OUTCOME_UNKNOWN'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SCOPE_DENIED'
  | 'RESOURCE_NOT_FOUND';
