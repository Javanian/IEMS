import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAiDocuments, textChunks } from './documents.mjs';
import { contentHash } from '../tenant-foundation/commands.mjs';

function fixture(issuedSource = null) {
  const grant = Object.fromEntries(['tenantId', 'plantId', 'legalEntityId', 'userId'].map(k => [k, randomUUID()]));
  const resourceId = randomUUID(), membershipId = randomUUID();
  const rows = new Map(), writes = [];
  rows.set('users', [{ _id: grant.userId, active: true }]);
  rows.set('memberships', [{ _id: membershipId, tenantId: grant.tenantId, userId: grant.userId, active: true, version: 1,
    plantIds: [grant.plantId], legalEntityIds: [grant.legalEntityId] }]);
  const matches = (row, filter) => Object.entries(filter).every(([k, v]) => Array.isArray(row[k]) ? row[k].includes(v) : row[k] === v);
  const collection = name => {
    if (!rows.has(name)) rows.set(name, []);
    const list = rows.get(name);
    return {
      async findOne(filter) { return structuredClone(list.find(row => matches(row, filter)) ?? null); },
      async insertOne(row) { list.push(structuredClone(row)); },
      async insertMany(values) { list.push(...structuredClone(values)); },
      async updateOne(filter, update) {
        const row = list.find(r => matches(r, filter)); if (!row) return { matchedCount: 0 };
        writes.push(name); Object.assign(row, update.$set);
        for (const [k, v] of Object.entries(update.$inc ?? {})) row[k] = (row[k] ?? 0) + v;
        return { matchedCount: 1 };
      },
      async replaceOne(filter, value) { const index = list.findIndex(r => matches(r, filter)); if (index < 0) return { matchedCount: 0 };
        list[index] = structuredClone(value); return { matchedCount: 1 }; },
    };
  };
  const runtime = { db: { collection }, client: { startSession: () => ({ startTransaction() {}, inTransaction: () => true,
    async commitTransaction() {}, async abortTransaction() {}, async endSession() {} }) },
    foundation: { async authorizeInTransaction() { return grant; } } };
  const api = createAiDocuments({ ...runtime, issuedSource }), scope = {};
  const publish = (overrides = {}) => api.publish(scope, { plantId: grant.plantId, resourceId, key: randomUUID(),
    expectedRevision: 0, title: 'Manual', text: 'Evidence text', allowedUserIds: [grant.userId], ...overrides });
  const read = (overrides = {}) => api.source.readAuthorized({ grant: { ...grant, ...overrides }, resourceId, session: { inTransaction: () => true } });
  return { api, rows, grant, scope, resourceId, publish, read, writes };
}
test('manual ingestion has versioned ACL, fences target principals and returns revision citation source', async () => {
  const f = fixture(); const result = await f.publish(); const source = await f.read();
  assert.equal(result.revision, 1); assert.equal(source.aclRevision, 1); assert.deepEqual(source.chunks, ['Evidence text']);
  assert.equal(f.rows.get('aiDocuments')[0].provenance, 'MANUAL_TEXT');
  assert.ok(f.writes.includes('users')); assert.ok(f.writes.includes('memberships')); assert.ok(f.writes.includes('aiDocuments'));
  assert.equal(f.rows.get('audit').length, 1); assert.equal(f.rows.get('outbox').length, 1);
});
for (const field of ['tenantId', 'plantId', 'legalEntityId', 'userId']) {
  test(`source denies foreign ${field}`, async () => {
    const f = fixture(); await f.publish(); await assert.rejects(f.read({ [field]: randomUUID() }), { status: 404 });
  });
}
test('revoked document denies existing index reads and same command replay cannot un-revoke', async () => {
  const f = fixture(); const key = randomUUID(); await f.publish({ key });
  await f.api.revoke(f.scope, { plantId: f.grant.plantId, resourceId: f.resourceId, key: 'revoke', expectedRevision: 1 });
  await assert.rejects(f.read(), { status: 404 });
  const replay = await f.publish({ key }); assert.equal(replay.replayed, true);
  assert.equal(f.rows.get('aiDocuments')[0].active, false);
});
test('ACL update invalidates previous revision and removed reader loses source access', async () => {
  const f = fixture(); await f.publish();
  await f.publish({ expectedRevision: 1, text: 'Updated evidence' });
  const source = await f.read(); assert.equal(source.revision, 2); assert.equal(source.aclRevision, 2);
  f.rows.get('aiDocuments')[0].allowedUserIds = [randomUUID()]; await assert.rejects(f.read(), { status: 404 });
});
test('invalid reader or membership scope refuses ingestion', async () => {
  const f = fixture(); f.rows.get('memberships')[0].plantIds = [];
  await assert.rejects(f.publish(), { code: 'AI_DOCUMENT_READER_DENIED' }); assert.equal(f.rows.get('aiDocuments').length, 0);
});
test('source corruption and missing transaction fail closed', async () => {
  const f = fixture(); await f.publish(); f.rows.get('aiDocuments')[0].chunks = ['modified'];
  await assert.rejects(f.read(), { code: 'AI_DOCUMENT_CORRUPT' });
  await assert.rejects(f.api.source.readAuthorized({ grant: f.grant, resourceId: f.resourceId }), { status: 403 });
});
test('plain text ingestion bounds and deterministic chunks preserve citation offsets', () => {
  assert.deepEqual(textChunks('one\r\ntwo'), ['one\ntwo']); assert.equal(textChunks('a'.repeat(4001)).length, 3);
  for (const value of ['', '  ', 'a'.repeat(100001), 'a\0b']) assert.throws(() => textChunks(value), { code: 'AI_INVALID_TEXT' });
  assert.equal(contentHash({ title: 'x', chunks: textChunks('abc') }), contentHash({ title: 'x', chunks: ['abc'] }));
});

test('issued documents derive text in the transaction and recheck business authority on source reads and replay', async () => {
  let denied = false, checks = 0, receivedScope;
  const f = fixture({ async readAuthorized({ scope, session }) {
    checks++; receivedScope = scope; assert.equal(session.inTransaction(), true);
    if (denied) throw Object.assign(new Error('SOURCE_REVOKED'), { code: 'SOURCE_REVOKED', status: 403 });
    return { title: 'Approved PO', text: 'Authoritative approved facts' };
  } });
  const sourceReference = { cohort: 'LEGACY', vendorId: randomUUID(), orderId: randomUUID(), documentRevision: 1, sourceHash: 'a'.repeat(64) };
  await f.publish({ key: 'issued', sourceReference, text: 'Untrusted replacement must be ignored' });
  assert.equal(receivedScope, f.scope); assert.equal(f.rows.get('aiDocuments')[0].provenance, 'COMMERCIAL_APPROVED_REVISION');
  assert.deepEqual((await f.api.source.readAuthorized({ scope: f.scope, grant: f.grant, resourceId: f.resourceId,
    session: { inTransaction: () => true } })).chunks, ['Authoritative approved facts']);
  denied = true;
  await assert.rejects(f.publish({ key: 'issued', sourceReference, text: 'Untrusted replacement must be ignored' }), { code: 'SOURCE_REVOKED' });
  await assert.rejects(f.api.source.readAuthorized({ scope: f.scope, grant: f.grant, resourceId: f.resourceId,
    session: { inTransaction: () => true } }), { code: 'SOURCE_REVOKED' });
  assert.ok(checks >= 4);
});
