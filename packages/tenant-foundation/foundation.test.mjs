import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
let repl, client, db, foundation;
const ids = Object.fromEntries(['t1','t2','u','e1','e2','p1','p2','p3','m1','m2'].map(k => [k, randomUUID()]));
before(async () => {
  repl = await MongoMemoryReplSet.create({ binary: { ...(process.env.MONGOMS_SYSTEM_BINARY ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY } : {}), version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  client = await MongoClient.connect(repl.getUri());
  db = client.db(`tenant_foundation_owned_${randomUUID().replaceAll('-', '')}`);
});
after(async () => { if (db) await db.dropDatabase(); if (client) await client.close(); if (repl) await repl.stop(); });
test('real Mongo stores two tenants, memberships and only hashed bearer tokens', async () => {
  const api = await import('./index.mjs');
  foundation = api.createTenantFoundation({ client, db, roleActions: { reader: ['resource.read'], writer: ['resource.read','resource.write'] } });
  await foundation.initialize();
  for (const id of [ids.t1, ids.t2]) await foundation.provisionTenant({ id });
  await foundation.provisionUser({ id: ids.u, tenantId: ids.t1 });
  await foundation.provisionLegalEntity({ id: ids.e1, tenantId: ids.t1 });
  await foundation.provisionLegalEntity({ id: ids.e2, tenantId: ids.t2 });
  for (const [id, tenantId, legalEntityId] of [[ids.p1,ids.t1,ids.e1],[ids.p2,ids.t1,ids.e1],[ids.p3,ids.t2,ids.e2]]) await foundation.provisionPlant({ id, tenantId, legalEntityId });
  await foundation.provisionMembership({ id: ids.m1, tenantId: ids.t1, userId: ids.u, legalEntityIds: [ids.e1], plantIds: [ids.p1,ids.p2], roles: [{ role: 'writer', plantIds: [ids.p1] }, { role: 'reader', plantIds: [ids.p2] }] });
  await foundation.provisionMembership({ id: ids.m2, tenantId: ids.t2, userId: ids.u, legalEntityIds: [ids.e2], plantIds: [ids.p3], roles: [{ role: 'reader', plantIds: [ids.p3] }] });
  const issued = await foundation.issueSession({ userId: ids.u, tenantId: ids.t1, selectedPlantId: ids.p1, ttlMs: 60000 });
  const stored = await db.collection('sessions').findOne({ _id: issued.sessionId });
  assert.equal(stored.tokenHash, createHash('sha256').update(issued.token).digest('hex'));
  assert.ok(!JSON.stringify(stored).includes(issued.token));
  assert.equal(await db.collection('tenants').countDocuments(), 2);
  const scope = await foundation.authenticate(issued.token);
  assert.equal(scope.tenantId, ids.t1);
  assert.equal((await foundation.authorize(scope, { plantId: ids.p1, action: 'resource.write' })).plantId, ids.p1);
});

const denied = promise => assert.rejects(promise, { code: 'SCOPE_DENIED', message: 'Scope denied' });
async function login(tenantId = ids.t1, selectedPlantId = ids.p1) {
  return foundation.issueSession({ userId: ids.u, tenantId, selectedPlantId, ttlMs: 60000 });
}
test('target plant roles never inherit selected plant writer; forged scopes and unknown actions deny', async () => {
  const s = await login();
  const scope = await foundation.authenticate(s.token);
  await denied(foundation.authorize({ ...scope }, { plantId: ids.p1, action: 'resource.read' }));
  await denied(foundation.authorize(scope, { plantId: ids.p2, action: 'resource.write' }));
  await denied(foundation.authorize(scope, { plantId: ids.p3, action: 'resource.read' }));
  await denied(foundation.authorize(scope, { tenantId: ids.t2, plantId: ids.p1, action: 'resource.read' }));
  await denied(foundation.authorize(scope, { plantId: ids.p1, action: 'admin' }));
  await denied(foundation.authorize(scope, { plantId: null, action: 'resource.read' }));
  assert.equal((await foundation.authorize(scope, { plantId: ids.p2, action: 'resource.read' })).plantId, ids.p2);
  await denied(login(ids.t1, ids.p3));
  await denied(login(undefined, null));
  const other = await login(ids.t2, ids.p3);
  const otherScope = await foundation.authenticate(other.token);
  await denied(foundation.authorize(otherScope, { plantId: ids.p3, action: 'resource.write' }));
});
test('strict aliases reject malformed, null, repeated and conflicting scope values', async () => {
  const { resolveScopeAliases } = await import('./index.mjs');
  assert.deepEqual(resolveScopeAliases({ body: { tenantId: ids.t1 }, query: { tenant_id: ids.t1, plantId: ids.p1 }, headers: { 'x-plant-id': ids.p1 } }), { tenantId: ids.t1, plantId: ids.p1 });
  for (const sources of [{}, { body: { tenantId: null, plantId: ids.p1 } }, { body: { tenantId: ids.t1, tenant_id: ids.t2, plantId: ids.p1 } }, { query: { tenantId: [ids.t1], plantId: ids.p1 } }, { body: { tenantId: ids.t1, plantId: ids.p1 }, headers: { 'x-tenant-id': ids.t2 } }]) {
    assert.throws(() => resolveScopeAliases(sources), { code: 'SCOPE_DENIED' });
  }
});
test('expired and revoked sessions plus membership version bumps invalidate already verified scopes', async () => {
  const expired = await login();
  await db.collection('sessions').updateOne({ _id: expired.sessionId }, { $set: { expiresAt: new Date(0) } });
  await denied(foundation.authenticate(expired.token));
  await denied(foundation.authenticate('unknown'));
  const revoked = await login();
  const scope = await foundation.authenticate(revoked.token);
  await foundation.revokeSession({ tenantId: ids.t1, sessionId: revoked.sessionId });
  await denied(foundation.authenticate(revoked.token));
  await denied(foundation.authorize(scope, { plantId: ids.p1, action: 'resource.read' }));
  const stale = await login();
  const staleScope = await foundation.authenticate(stale.token);
  await foundation.invalidateMembership({ tenantId: ids.t1, membershipId: ids.m1, expectedVersion: 1, active: true });
  await denied(foundation.authenticate(stale.token));
  await denied(foundation.authorize(staleScope, { plantId: ids.p1, action: 'resource.read' }));
  await denied(foundation.invalidateMembership({ tenantId: ids.t1, membershipId: ids.m1, expectedVersion: 1, active: true }));
  const fresh = await login();
  await foundation.invalidateMembership({ tenantId: ids.t1, membershipId: ids.m1, expectedVersion: 2, active: false });
  await denied(foundation.authenticate(fresh.token));
  await denied(login());
});
test('audit is append-only on public API and audit failure rolls back session revocation', async () => {
  assert.equal(foundation.updateAudit, undefined);
  assert.equal(foundation.deleteAudit, undefined);
  const issued = await login(ids.t2, ids.p3);
  const before = await foundation.listAudit({ tenantId: ids.t2 });
  await db.command({ collMod: 'audit', validator: { kind: { $ne: 'sessions.revoked' } }, validationLevel: 'strict' });
  await assert.rejects(foundation.revokeSession({ tenantId: ids.t2, sessionId: issued.sessionId }));
  assert.ok(await foundation.authenticate(issued.token));
  assert.deepEqual(await foundation.listAudit({ tenantId: ids.t2 }), before);
  await db.command({ collMod: 'audit', validator: {} });
  await denied(foundation.revokeSession({ tenantId: ids.t1, sessionId: issued.sessionId }));
  await foundation.revokeSession({ tenantId: ids.t2, sessionId: issued.sessionId });
  await denied(foundation.authenticate(issued.token));
  const after = await foundation.listAudit({ tenantId: ids.t2 });
  assert.deepEqual(after.slice(0, before.length), before);
  assert.equal(after.length, before.length + 1);
  assert.ok(after.every(a => a.tenantId === ids.t2));
});
test('switch rotates token and validates tenant ancestry; scoped filters overwrite no caller scope', async () => {
  const issued = await login(ids.t2, ids.p3);
  const scope = await foundation.authenticate(issued.token);
  await denied(foundation.switchSession(scope, { tenantId: ids.t1, selectedPlantId: ids.p3, ttlMs: 60000 }));
  const switched = await foundation.switchSession(scope, { tenantId: ids.t2, selectedPlantId: ids.p3, ttlMs: 60000 });
  await denied(foundation.authenticate(issued.token));
  const fresh = await foundation.authenticate(switched.token);
  assert.deepEqual(await foundation.scopedFilter(fresh, { plantId: ids.p3, action: 'resource.read' }, { _id: 'resource-1' }), { $and: [{ tenantId: ids.t2, plantId: ids.p3 }, { _id: 'resource-1' }] });
  await denied(foundation.scopedFilter(fresh, { plantId: ids.p1, action: 'resource.read' }, {}));
  await foundation.revokeSession({ tenantId: ids.t2, sessionId: switched.sessionId });
  await denied(foundation.scopedFilter(fresh, { plantId: ids.p3, action: 'resource.read' }, {}));
});
test('real scoped resource reads cannot see the other tenant and disabled identities fail closed', async () => {
  const issued = await login(ids.t2, ids.p3);
  const scope = await foundation.authenticate(issued.token);
  await db.collection('resources').insertMany([{ _id: randomUUID(), tenantId: ids.t1, plantId: ids.p1, key: 'same' }, { _id: randomUUID(), tenantId: ids.t2, plantId: ids.p3, key: 'same' }]);
  const rows = await db.collection('resources').find(await foundation.scopedFilter(scope, { plantId: ids.p3, action: 'resource.read' }, { key: 'same' })).toArray();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenantId, ids.t2);
  const impossible = await foundation.scopedFilter(scope, { plantId: ids.p3, action: 'resource.read' }, { tenantId: ids.t1 });
  assert.equal(await db.collection('resources').countDocuments(impossible), 0);
  for (const [collection, key] of [['tenants',ids.t2], ['users',ids.u], ['plants',ids.p3], ['legalEntities',ids.e2]]) {
    await db.collection(collection).updateOne({ _id: key }, { $set: { active: false } });
    await denied(foundation.authenticate(issued.token));
    await denied(foundation.authorize(scope, { plantId: ids.p3, action: 'resource.read' }));
    await db.collection(collection).updateOne({ _id: key }, { $set: { active: true } });
  }
});
test('explicit tenant-wide grants still never cross tenants', async () => {
  const userId = randomUUID();
  await foundation.provisionUser({ id: userId, tenantId: ids.t1 });
  await foundation.provisionMembership({ id: randomUUID(), tenantId: ids.t1, userId, legalEntityIds: [], plantIds: [], tenantWide: true, roles: [{ role: 'reader', plantIds: [], tenantWide: true }] });
  const issued = await foundation.issueSession({ userId, tenantId: ids.t1, selectedPlantId: ids.p2, ttlMs: 60000 });
  const scope = await foundation.authenticate(issued.token);
  assert.ok(await foundation.authorize(scope, { plantId: ids.p1, action: 'resource.read' }));
  await denied(foundation.authorize(scope, { plantId: ids.p3, action: 'resource.read' }));
  await denied(foundation.authorize(scope, { plantId: ids.p1, action: 'resource.write' }));
});
test('membership creation rejects null-all, unknown roles and cross-tenant ancestry without partial records', async () => {
  const userId = randomUUID();
  await denied(foundation.provisionUser({ id: userId }));
  await foundation.provisionUser({ id: userId, tenantId: ids.t1 });
  const base = { id: randomUUID(), tenantId: ids.t1, userId, legalEntityIds: [ids.e1], plantIds: [ids.p1], roles: [{ role: 'reader', plantIds: [ids.p1] }] };
  for (const change of [{ plantIds: null }, { roles: [{ role: 'superadmin', plantIds: [ids.p1] }] }, { plantIds: [ids.p3] }, { legalEntityIds: [ids.e2] }, { roles: [{ role: 'writer', plantIds: [ids.p3] }] }]) await denied(foundation.provisionMembership({ ...base, ...change }));
  assert.equal(await db.collection('memberships').countDocuments({ userId }), 0);
  await denied(foundation.issueSession({ userId, tenantId: ids.t1, selectedPlantId: ids.p1, ttlMs: 60000 }));
});
