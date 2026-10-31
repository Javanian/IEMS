import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { readVendorPurchaseOrder } from '../../apps/portfolio-api/src/portals.mjs';
import { createApprovedOrderDocumentSource } from '../scoped-ai/issued-documents.mjs';
import { createVendorDraftAuthority } from '../scoped-ai/vendor-source.mjs';
import { createAiDocuments } from '../scoped-ai/documents.mjs';
import { effectHash, effectTransaction } from './effects.mjs';

process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
test('v16 actual source observations preserve authority and write no collection', { timeout: 150000 }, async t => {
  const h = await startOwned(t), { db, client } = h, a = h.seeded[0], scope = await h.scopeOf(h.alpha);
  await db.collection('memberships').updateOne({ _id: a.membershipId }, { $push: { roles: { $each: ['aiIssuedDocumentAdmin', 'portalAccessAdmin'].map(role => ({ role, plantIds: [a.plantId], tenantWide: false })) } } });
  const vendor = await h.ok('/procurement/vendors', { name: 'Owned observation vendor' }, 201);
  const pr = await h.ok('/procurement/requests', { vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Owned PO observation', quantity: '1.50', uom: 'EA', unitPrice: '12.00', currency: 'USD' }] }, 201);
  await h.ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await h.ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: randomUUID() });
  await h.ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const grantId = randomUUID();
  await h.ok('/portals/grants', { grantId, userId: a.userId, partyId: vendor._id, kind: 'VENDOR', actions: ['portal.vendor.read'], expiresAt: new Date(Date.now() + 3600000).toISOString(), commandKey: randomUUID() });
  const authority = createVendorDraftAuthority(h.runtime), issued = createApprovedOrderDocumentSource(h.runtime);
  const raw = await effectTransaction(client, session => readVendorPurchaseOrder(db, { tenantId: a.tenantId, plantId: a.plantId, cohort: 'LEGACY', vendorId: vendor._id, orderId: po._id }, session));
  const reference = { cohort: 'LEGACY', vendorId: vendor._id, orderId: po._id, documentRevision: raw.documentRevision, sourceHash: raw.sourceHash };
  const resourceId = randomUUID();
  await h.ok(`/ai/documents/${resourceId}/publish`, { key: randomUUID(), expectedRevision: 0, title: 'Owned issued observation', allowedUserIds: [a.userId], sourceReference: reference });
  const source = h.runtime.rag.documents.source;
  const grant = await h.runtime.foundation.authorize(scope, { plantId: a.plantId, action: 'ai.index' });
  const snapshot = async () => {
    const result = {};
    for (const { name } of (await db.listCollections({}, { nameOnly: true }).toArray()).sort((x, y) => x.name.localeCompare(y.name))) result[name] = effectHash(await db.collection(name).find({}).sort({ _id: 1 }).toArray());
    return result;
  };
  const observe = (reader = source, overrides = {}) => effectTransaction(client, session => reader.readSnapshot({ scope, grant, resourceId, session, ...overrides }));
  const recipient = (overrides = {}) => effectTransaction(client, async session => {
    const fresh = await h.runtime.foundation.authorize(scope, { plantId: a.plantId, action: 'ai.vendor.source.read' });
    const result = await authority.readRecipient({ grant: fresh, vendorId: vendor._id, grantId, session, ...overrides });
    assert.deepEqual(await h.runtime.foundation.authorize(scope, { plantId: a.plantId, action: 'ai.vendor.source.read' }), fresh);
    return result;
  });
  const noWrites = async action => { const before = await snapshot(); try { return await action(); } finally { assert.deepEqual(await snapshot(), before); } };
  async function fault(name, filter, update, action) {
    const original = await db.collection(name).findOne(filter);
    await db.collection(name).updateOne(filter, update);
    try { await noWrites(action); } finally { await db.collection(name).replaceOne({ _id: original._id }, original); }
  }
  await t.test('all three read ports retain original output and hash with zero durable writes', async () => {
    const observation = await noWrites(() => observe());
    const recipientView = await noWrites(() => recipient());
    const issuedView = await noWrites(() => effectTransaction(client, session => issued.readSnapshot({ scope, grant, reference, session })));
    assert.ok(issuedView.text.includes('"quantity":"1.50"')); assert.ok(issuedView.text.includes(raw.sourceHash));
    const before = await db.collection('aiDocuments').findOne({ _id: resourceId });
    assert.deepEqual(await effectTransaction(client, session => source.readAuthorized({ scope, grant, resourceId, session })), observation);
    assert.equal((await db.collection('aiDocuments').findOne({ _id: resourceId })).readFence, (before.readFence ?? 0) + 1);
    const party = await db.collection('portal_party_grants').findOne({ _id: grantId });
    assert.deepEqual(await effectTransaction(client, session => authority.recipient({ grant, vendorId: vendor._id, grantId, session })), recipientView);
    assert.equal((await db.collection('portal_party_grants').findOne({ _id: grantId })).authorizationFence, party.authorizationFence + 1);
    assert.deepEqual(await effectTransaction(client, session => issued.readAuthorized({ scope, grant, reference, session })), issuedView);
  });
  await t.test('opaque scope, fresh grant and nested observation port are mandatory', async () => {
    await noWrites(() => assert.rejects(observe(source, { scope: { ...scope } }), { status: 403 }));
    for (const field of ['tenantId', 'plantId', 'legalEntityId', 'userId', 'membershipId', 'membershipVersion']) await noWrites(() => assert.rejects(observe(source, { grant: { ...grant, [field]: field === 'membershipVersion' ? grant[field] + 1 : randomUUID() } }), { status: 403 }));
    const missing = createAiDocuments({ ...h.runtime, issuedSource: { readAuthorized: issued.readAuthorized } });
    await noWrites(() => assert.rejects(observe(missing.source), { code: 'AI_ISSUED_SOURCE_OBSERVATION_UNAVAILABLE' }));
    await noWrites(() => assert.rejects(effectTransaction(client, session => issued.readSnapshot({ scope: null, grant, reference, session })), { code: 'AI_ISSUED_SOURCE_SCOPE_REQUIRED' }));
  });
  await t.test('current session, user, membership, permission and ACL revocation deny without writes', async () => {
    for (const [name, filter, update] of [
      ['sessions', { userId: a.userId, revoked: false }, { $set: { revoked: true } }],
      ['users', { _id: a.userId }, { $set: { active: false } }],
      ['memberships', { _id: a.membershipId }, { $inc: { version: 1 } }],
      ['memberships', { _id: a.membershipId }, { $set: { roles: [] } }],
    ]) await fault(name, filter, update, () => assert.rejects(observe(), { status: 403 }));
    await fault('aiDocuments', { _id: resourceId }, { $set: { allowedUserIds: [] } }, () => assert.rejects(observe(), { code: 'AI_DOCUMENT_NOT_FOUND' }));
    await fault('aiDocuments', { _id: resourceId }, { $set: { contentHash: '0'.repeat(64) } }, () => assert.rejects(observe(), { status: 409 }));
  });
  await t.test('recipient wrong tuple, revoked or expired grant and inactive membership deny without writes', async () => {
    await noWrites(() => assert.rejects(recipient({ vendorId: randomUUID() }), { code: 'AI_RECIPIENT_DENIED' }));
    for (const [name, filter, update] of [
      ['portal_party_grants', { _id: grantId }, { $set: { active: false } }],
      ['portal_party_grants', { _id: grantId }, { $set: { expiresAt: new Date(0) } }],
      ['portal_party_grants', { _id: grantId }, { $set: { plantId: randomUUID() } }],
      ['memberships', { _id: a.membershipId }, { $set: { active: false } }],
    ]) await fault(name, filter, update, () => assert.rejects(recipient(), { status: 403 }));
  });
  await t.test('issued source rejects tamper, superseded revision and wrong legal entity without writes', async () => {
    await noWrites(() => assert.rejects(effectTransaction(client, session => issued.readSnapshot({ scope, grant, reference: { ...reference, sourceHash: '0'.repeat(64) }, session })), { code: 'AI_ISSUED_SOURCE_SUPERSEDED' }));
    await fault('purchaseOrders', { _id: po._id }, { $inc: { documentRevision: 1 } }, () => assert.rejects(observe(), { status: 409 }));
    await fault('purchaseOrders', { _id: po._id }, { $set: { legalEntityId: randomUUID() } }, () => assert.rejects(observe(), { status: 403 }));
  });
});
