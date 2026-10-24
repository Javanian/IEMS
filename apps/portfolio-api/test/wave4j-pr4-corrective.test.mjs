import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';

test('sourced commercial revisions compare provenance values and exact keys independent of order', async t => {
  const h = await startOwned(t);
  const account = await h.ok('/crm/accounts', { name: 'Synthetic provenance customer' }, 201);
  const inquiry = await h.ok('/commercial/inquiries', { accountId: account._id, lines: [{ itemCode: 'PART-A', description: 'Frozen part', quantity: '1.250000', uom: 'EA', drawingNumber: 'DRAW-A', drawingRevision: 'B' }], idempotencyKey: randomUUID() }, 201);
  const path = `/commercial/inquiries/${inquiry._id}`;
  await h.ok(`${path}/stage`, { expectedVersion: 1, toStage: 'SUBMITTED', reason: 'Synthetic submit', idempotencyKey: randomUUID() });
  await h.ok(`${path}/stage`, { expectedVersion: 2, toStage: 'IN_REVIEW', reason: 'Synthetic review', idempotencyKey: randomUUID() });
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  const converted = await h.ok(`${path}/convert`, { expectedVersion: 3, revision: 1, expiresAt, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', prices: [{ inquiryLineId: inquiry.revisions[0].lines[0].lineId, unitPrice: '10.00', currency: 'USD' }], idempotencyKey: randomUUID() });
  const quote = converted.quote, original = structuredClone(quote.revisions[0]);
  const provenance = original.lines[0].provenance;
  const reordered = Object.fromEntries(Object.entries(provenance).reverse());
  assert.notDeepEqual(Object.keys(reordered), Object.keys(provenance));
  const body = { expectedVersion: 1, expiresAt, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ ...original.lines[0], unitPrice: '12.00', provenance: reordered }] };
  const revised = await h.ok(`/commercial/quotes/${quote._id}/revisions`, body);
  assert.equal(revised.version, 2);
  assert.deepEqual(revised.revisions[0], JSON.parse(JSON.stringify(original)));
  assert.equal(revised.revisions[1].lines[0].unitPrice, '12.00');
  assert.deepEqual(revised.revisions[1].lines[0].provenance, provenance);
  assert.deepEqual(Object.keys(revised.revisions[1].lines[0].provenance), Object.keys(provenance));

  const snapshots = () => Promise.all(['quotes', 'commercialAudit', 'commercialOutbox'].map(name => h.db.collection(name).find({}).sort({ _id: 1 }).toArray()));
  const before = await snapshots();
  const tampered = [
    ['extra key', { ...provenance, extra: 'not-source-owned' }],
    ['missing key', Object.fromEntries(Object.entries(provenance).filter(([key]) => key !== 'drawingRevision'))],
    ['changed value', { ...provenance, drawingRevision: 'C' }],
    ['changed type', { ...provenance, inquiryRevision: String(provenance.inquiryRevision) }],
    ['null provenance', null],
    ['array provenance', Object.values(provenance)],
    ['omitted provenance', undefined],
  ];
  for (const [label, candidate] of tampered) {
    await t.test(`${label} remains SOURCE_TAMPER with no writes`, async () => {
      const response = await h.req(`/commercial/quotes/${quote._id}/revisions`, { ...body, expectedVersion: 2, lines: [{ ...body.lines[0], provenance: candidate }] }, h.alpha);
      assert.equal(response.status, 422, JSON.stringify(response));
      assert.equal(response.error.code, 'SOURCE_TAMPER');
      assert.deepEqual(await snapshots(), before);
    });
  }
});

test('quoteEditor can create an inquiry from a known scoped account without crm grants', async t => {
  const h = await startOwned(t);
  const account = await h.ok('/crm/accounts', { name: 'Synthetic known account' }, 201);
  const foreignAccount = await h.ok('/crm/accounts', { name: 'Synthetic foreign account' }, 201, h.beta);
  const restore = await h.setRoles(h.seeded[0], ['quoteEditor']);
  try {
    const identity = await h.ok('/session/me');
    assert.ok(identity.permissions.includes('quote.write'));
    assert.equal(identity.permissions.includes('crm.read'), false);
    assert.equal((await h.req('/crm/accounts', undefined, h.alpha)).status, 403);
    const body = { accountId: account._id, lines: [{ itemCode: 'PART-A', description: 'Known customer part', quantity: '1', uom: 'EA', drawingNumber: 'DRAW-A', drawingRevision: 'A' }], idempotencyKey: randomUUID() };
    const created = await h.ok('/commercial/inquiries', body, 201);
    assert.equal(created.accountId, account._id);
    assert.equal(created.stage, 'DRAFT');
    assert.equal((await h.req('/commercial/inquiries', { ...body, accountId: foreignAccount._id, idempotencyKey: randomUUID() }, h.alpha)).status, 404);
    assert.equal((await h.req('/commercial/inquiries', { ...body, accountId: randomUUID(), idempotencyKey: randomUUID() }, h.alpha)).status, 404);
    assert.equal(await h.db.collection('inquiries').countDocuments(), 1);
    assert.equal((await h.req('/crm/accounts', undefined, h.alpha)).status, 403);
  } finally { await restore(); }
});
