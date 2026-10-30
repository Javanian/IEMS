import { createHash } from 'node:crypto';
import { boundedTransaction, contentHash, CommandError } from '../../../packages/tenant-foundation/commands.mjs';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const invalid = () => { throw new CommandError('MIGRATION_MANIFEST_INVALID', 400); };
function stableId(tenantId, domain, sourceId) {
  const digest = createHash('sha256').update(JSON.stringify(['iems-migration-v1', tenantId, domain, sourceId])).digest('hex').slice(0, 32).split('');
  digest[12] = '8'; digest[16] = '8';
  const value = digest.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
function totals(records) {
  const sums = new Map();
  for (const record of records) for (const entry of record.ledger || []) {
    if (!entry || typeof entry.unit !== 'string' || !/^[A-Z][A-Z0-9_]{0,15}$/.test(entry.unit) || typeof entry.amount !== 'string' || !/^-?\d{1,30}(\.\d{1,12})?$/.test(entry.amount)) invalid();
    const [integer, fraction = ''] = entry.amount.replace('-', '').split('.');
    const value = BigInt(integer + fraction.padEnd(12, '0')) * (entry.amount.startsWith('-') ? -1n : 1n);
    sums.set(entry.unit, (sums.get(entry.unit) || 0n) + value);
  }
  return Object.fromEntries([...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([unit, value]) => {
    const abs = (value < 0n ? -value : value).toString().padStart(13, '0');
    return [unit, `${value < 0n ? '-' : ''}${abs.slice(0, -12)}.${abs.slice(-12)}`];
  }));
}
export function planMigration(input) {
  if (!input || input.version !== 1 || !uuid(input.runId) || !uuid(input.tenantId) || !Array.isArray(input.records) || input.records.length > 500 || Buffer.byteLength(JSON.stringify(input)) > 4 * 1024 * 1024) invalid();
  const keys = new Set();
  const rows = input.records.map(record => {
    if (!record || typeof record.domain !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(record.domain) || typeof record.sourceId !== 'string' || !record.sourceId.length || record.sourceId.length > 256 || !Array.isArray(record.references || []) || !Array.isArray(record.ledger || [])) invalid();
    const key = JSON.stringify([record.domain, record.sourceId]);
    if (keys.has(key)) invalid(); keys.add(key);
    return { stableId: stableId(input.tenantId, record.domain, record.sourceId), domain: record.domain, sourceId: record.sourceId, data: record.data, references: record.references || [], ledger: record.ledger || [] };
  }).sort((a, b) => a.stableId.localeCompare(b.stableId));
  for (const row of rows) for (const ref of row.references) {
    if (!ref || !keys.has(JSON.stringify([ref.domain, ref.sourceId]))) throw new CommandError('MIGRATION_RELATIONSHIP_MISSING', 409);
  }
  const grouped = new Map();
  for (const row of rows) grouped.set(row.domain, (grouped.get(row.domain) || 0) + 1);
  const counts = Object.fromEntries(grouped);
  const plan = { version: 1, runId: input.runId, tenantId: input.tenantId, authority: 'staging-only', rows, counts, ledgerTotals: totals(rows), hash: contentHash(rows) };
  if (input.expected && (input.expected.hash !== plan.hash || contentHash(input.expected.counts) !== contentHash(counts) || contentHash(input.expected.ledgerTotals) !== contentHash(plan.ledgerTotals))) throw new CommandError('MIGRATION_PARITY_FAILED', 409);
  return plan;
}
function owned(db) {
  if (!/^(portfolio_owned_|tenant_foundation_owned_)[A-Za-z0-9_]{1,80}$/.test(db.databaseName)) throw new CommandError('OWNED_DATABASE_REQUIRED', 403);
}
export async function initializeMigration(db) {
  owned(db);
  await db.collection('foundationMigrationRows').createIndex({ tenantId: 1, runId: 1, stableId: 1 }, { unique: true });
}
export async function stageMigration(client, db, input) {
  owned(db);
  const plan = planMigration(input);
  if (!input.expected) throw new CommandError('MIGRATION_RECONCILED_MANIFEST_REQUIRED', 409);
  return boundedTransaction(client, async session => {
    const runs = db.collection('foundationMigrationRuns');
    const previous = await runs.findOne({ _id: plan.runId }, { session });
    if (previous) {
      if (previous.tenantId !== plan.tenantId || previous.hash !== plan.hash || previous.status !== 'STAGED') throw new CommandError('MIGRATION_RUN_CONFLICT', 409);
      await verifyMigration(db, { runId: plan.runId, tenantId: plan.tenantId }, session);
      return { runId: plan.runId, status: previous.status, replayed: true };
    }
    const occurredAt = new Date();
    if (plan.rows.length) await db.collection('foundationMigrationRows').insertMany(plan.rows.map(row => ({ ...row, _id: `${plan.runId}:${row.stableId}`, runId: plan.runId, tenantId: plan.tenantId })), { session });
    const { rows, ...manifest } = plan;
    await runs.insertOne({ ...manifest, _id: plan.runId, status: 'STAGED', occurredAt }, { session });
    await db.collection('audit').insertOne({ _id: `${plan.runId}:staged`, tenantId: plan.tenantId, kind: 'migration.staged', subjectId: plan.runId, occurredAt }, { session });
    return { runId: plan.runId, status: 'STAGED', replayed: false };
  });
}
export async function verifyMigration(db, { runId, tenantId }, session) {
  owned(db);
  if (!uuid(runId) || !uuid(tenantId)) invalid();
  const manifest = await db.collection('foundationMigrationRuns').findOne({ _id: runId, tenantId, status: 'STAGED' }, { session });
  if (!manifest) throw new CommandError('MIGRATION_RUN_NOT_FOUND', 404);
  const records = await db.collection('foundationMigrationRows').find({ runId, tenantId }, { session }).sort({ stableId: 1 }).toArray();
  const rows = records.map(({ _id, runId: r, tenantId: t, ...row }) => row);
  const computed = planMigration({ version: 1, runId, tenantId, records: rows });
  if (computed.hash !== manifest.hash || contentHash(computed.counts) !== contentHash(manifest.counts) || contentHash(computed.ledgerTotals) !== contentHash(manifest.ledgerTotals) || contentHash(rows) !== computed.hash) throw new CommandError('MIGRATION_PARITY_FAILED', 409);
  return { runId, tenantId, hash: manifest.hash, counts: manifest.counts, ledgerTotals: manifest.ledgerTotals, rows: rows.length };
}
export async function rollbackMigration(client, db, target) {
  return boundedTransaction(client, async session => {
    owned(db);
    if (!uuid(target.runId) || !uuid(target.tenantId)) invalid();
    const previous = await db.collection('foundationMigrationRuns').findOne({ _id: target.runId, tenantId: target.tenantId, status: 'ROLLED_BACK' }, { session });
    if (previous) return { runId: target.runId, tenantId: target.tenantId, status: 'ROLLED_BACK', replayed: true };
    const verified = await verifyMigration(db, target, session);
    const filter = { _id: target.runId, tenantId: target.tenantId, status: 'STAGED', hash: verified.hash };
    const result = await db.collection('foundationMigrationRuns').updateOne(filter, { $set: { status: 'ROLLED_BACK', rolledBackAt: new Date() } }, { session });
    if (result.matchedCount !== 1) throw new CommandError('MIGRATION_RUN_CONFLICT', 409);
    const removed = await db.collection('foundationMigrationRows').deleteMany({ runId: target.runId, tenantId: target.tenantId }, { session });
    if (removed.deletedCount !== verified.rows) throw new CommandError('MIGRATION_PARITY_FAILED', 409);
    await db.collection('audit').insertOne({ _id: `${target.runId}:rolled-back`, tenantId: target.tenantId, kind: 'migration.rolled-back', subjectId: target.runId, occurredAt: new Date() }, { session });
    return { ...verified, status: 'ROLLED_BACK' };
  });
}
