import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';

async function authorized(h, { currency = 'USD', total = '1.00', minimum = '0.40' } = {}) {
  const a = await h.ok('/crm/accounts', { name: 'Wave3e synthetic' }, 201);
  let row = await h.ok('/repair/cases', { accountId: a._id, serial: key(), condition: 'inspection', currency, idempotencyKey: key() }, 201);
  const step = async (action, values = {}) => row = await h.ok(`/repair/cases/${row._id}/${action}`, { expectedVersion: row.version, idempotencyKey: key(), ...values });
  await step('diagnostic-authorize', { feeCap: total, evidence: 'cap' });
  const findings = [{ component: 'Housing', disposition: 'REPAIR' }];
  await step('teardown', { findings, evidence: 'inspection' });
  const q = await h.ok('/commercial/quotes', { accountId: a._id, expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Housing', quantity: '1', uom: 'EA', unitPrice: total, currency }] }, 201);
  await h.ok(`/commercial/quotes/${q._id}/approve`, { expectedVersion: 1, revision: 1 });
  await step('scope', { quoteId: q._id, revision: 1, depositRequired: minimum, evidence: 'scope' });
  await step('decide', { decision: 'ACCEPT', revision: 1, evidence: 'decision' });
  return { get row() { return row; }, step, findings };
}
const names = ['repairCases', 'repairInvoices', 'repairDeposits', 'repairKeys', 'repairAudit', 'repairOutbox'];
const snapshot = h => Promise.all(names.map(n => h.db.collection(n).find().sort({ _id: 1 }).toArray()));
const counters = h => Promise.all(names.map(n => h.db.collection(n).countDocuments()));

test('wave3e cumulative cap rejects excess atomically, preserves minimum, distinct keys and retries', { timeout: 120000 }, async t => {
  const h = await startOwned(t), f = await authorized(h), path = `/repair/cases/${f.row._id}/deposit`;
  const body = amount => ({ expectedVersion: f.row.version, amount, currency: 'USD', reference: key(), idempotencyKey: key() });
  const excess = body('1.01'), before = await snapshot(h);
  const rejected = await h.req(path, excess, h.alpha);
  assert.equal(rejected.status, 409); assert.equal(rejected.error.code, 'DEPOSIT_EXCEEDED');
  assert.deepEqual(await snapshot(h), before);
  const insufficient = await h.req(`/repair/cases/${f.row._id}/start`, { expectedVersion: f.row.version, idempotencyKey: key() }, h.alpha);
  assert.equal(insufficient.error.code, 'DEPOSIT_REQUIRED');
  const first = body('0.60');
  assert.equal((await h.req(path, first, h.beta)).status, 404);
  assert.equal((await h.req(path, { ...first, plantId: h.seeded[1].plantId }, h.alpha)).status, 403);
  const restore = await h.setRoles(h.seeded[0], ['repairRead']);
  assert.equal((await h.req(path, first, h.alpha)).status, 403); await restore();
  for (const name of ['repairAudit', 'repairOutbox']) {
    await h.db.command({ collMod: name, validator: { forbidden: { $exists: true } } });
    try { assert.equal((await h.req(path, first, h.alpha)).status, 500); assert.deepEqual(await snapshot(h), before); }
    finally { await h.db.command({ collMod: name, validator: {} }); }
  }
  const race = [first, body('0.60')], count = await counters(h);
  const results = await Promise.all(race.map(b => h.req(path, b, h.alpha)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.deepEqual(await counters(h), count.map((n, i) => n + (i === 0 || i === 1 ? 0 : 1)));
  const winner = results.findIndex(r => r.status === 200);
  assert.deepEqual(await h.ok(path, race[winner]), results[winner].data);
  const current = await h.ok(`/repair/cases/${f.row._id}`);
  const over = { ...body('0.41'), expectedVersion: current.version };
  const funded = await snapshot(h);
  assert.equal((await h.req(path, over, h.alpha)).error.code, 'DEPOSIT_EXCEEDED');
  assert.deepEqual(await snapshot(h), funded);
  await h.ok(path, { ...body('0.40'), expectedVersion: current.version });
  const full = await h.ok(`/repair/cases/${f.row._id}`);
  assert.equal((await h.ok(`/repair/cases/${full._id}/start`, { expectedVersion: full.version, idempotencyKey: key() })).depositVerified, '1.00');
});

test('wave3e stored historical overfunding refuses start without remediation', { timeout: 120000 }, async t => {
  const h = await startOwned(t), f = await authorized(h);
  await h.db.collection('repairDeposits').insertOne({ _id: key(), tenantId: f.row.tenantId, plantId: f.row.plantId, caseId: f.row._id, accountId: f.row.ownerAccountId, currency: 'USD', amount: '1.01' });
  const before = await snapshot(h);
  const r = await h.req(`/repair/cases/${f.row._id}/start`, { expectedVersion: f.row.version, idempotencyKey: key() }, h.alpha);
  assert.equal(r.status, 409); assert.equal(r.error.code, 'DEPOSIT_EXCEEDED'); assert.deepEqual(await snapshot(h), before);
  for (const [status, action, values] of [
    ['IN_PROGRESS', 'execute', { dispositions: f.findings, evidence: 'execution' }],
    ['TESTING', 'test', { result: 'PASS', evidence: 'test' }],
    ['TEST_PASSED', 'qc', { evidence: 'qc' }],
    ['READY_FOR_RETURN', 'return', { evidence: 'return' }],
    ['RETURNED', 'bill', {}]
  ]) {
    await h.db.collection('repairCases').updateOne({ _id: f.row._id }, { $set: { status } });
    const prior = await snapshot(h);
    const blocked = await h.req(`/repair/cases/${f.row._id}/${action}`, { expectedVersion: f.row.version, idempotencyKey: key(), ...values }, h.alpha);
    assert.equal(blocked.status, 409, action);
    assert.equal(blocked.error.code, 'DEPOSIT_EXCEEDED', action);
    assert.deepEqual(await snapshot(h), prior);
  }
});

test('wave3e cap uses exact frozen totals for JPY, KWD and greater-than-safe-integer amounts', { timeout: 120000 }, async t => {
  const h = await startOwned(t);
  for (const [currency, total, first, rest, excess, zero] of [
    ['JPY', '2', '1', '1', '2', '0'],
    ['KWD', '0.002', '0.001', '0.001', '0.002', '0.000'],
    ['USD', '99999999999999999999.99', '99999999999999999999.98', '0.01', '0.02', '0.00']
  ]) {
    const f = await authorized(h, { currency, total, minimum: zero });
    await f.step('deposit', { amount: first, currency, reference: key() });
    const before = await snapshot(h);
    const rejected = await h.req(`/repair/cases/${f.row._id}/deposit`, { expectedVersion: f.row.version, idempotencyKey: key(), amount: excess, currency, reference: key() }, h.alpha);
    assert.equal(rejected.error.code, 'DEPOSIT_EXCEEDED'); assert.deepEqual(await snapshot(h), before);
    await f.step('deposit', { amount: rest, currency, reference: key() });
    assert.equal((await f.step('start')).depositVerified, total);
  }
});

test('wave3e every stored receipt field and pinned identity fails closed on reads, PDF and issue replay', { timeout: 120000 }, async t => {
  const h = await startOwned(t), f = await authorized(h, { minimum: '0.00' });
  await f.step('start'); await f.step('execute', { dispositions: f.findings, evidence: 'executed' });
  await f.step('test', { result: 'PASS', evidence: 'pass' }); await f.step('qc', { evidence: 'qc' }); await f.step('bill');
  const body = { kind: 'repairInvoice', sourceId: f.row.finalInvoiceId, sourceVersion: 1 };
  const record = await h.ok('/documents/issues', body), intents = h.db.collection('documentIntents');
  const original = await intents.findOne({ _id: record._id });
  const counts = async () => Promise.all(['documentAudit', 'documentOutbox', 'documentRecords'].map(n => h.db.collection(n).countDocuments()));
  const before = await counts();
  const mutations = [
    ['record.snapshot.total', '999999.00'], ['record.snapshot.lines.0.description', 'FORGED'],
    ['record.template.name', 'FORGED'], ['record.sourceId', key()], ['record.sourceVersion', 2],
    ['record.kind', 'shipment'], ['record.tenantId', key()], ['record.plantId', key()],
    ['record.legalEntityId', key()], ['record.issuedAt', new Date(0)], ['record._id', key()],
    ['record.contentHash', '0'.repeat(64)], ['record.pdfHash', '0'.repeat(64)], ['record.extra', 'untrusted'],
    ['snapshot.lines.0.description', 'FORGED'], ['sourceVersion', 2], ['rendererId', key()]
  ];
  for (const [field, value] of mutations) {
    await intents.updateOne({ _id: record._id }, { $set: { [field]: value } });
    assert.equal((await h.req(`/documents/issues/${record._id}`, undefined, h.alpha)).status, 500, field);
    assert.equal((await h.raw(`/documents/issues/${record._id}/pdf`)).status, 500, field);
    if (field.startsWith('record.')) assert.equal((await h.req('/documents/issues', body, h.alpha)).status, 500, field);
    assert.deepEqual(await counts(), before);
    await intents.replaceOne({ _id: record._id }, original);
  }
  assert.deepEqual(await h.ok(`/documents/issues/${record._id}`), record);
  assert.deepEqual(await h.ok('/documents/issues', body), record);
  assert.equal((await h.req(`/documents/issues/${record._id}`, undefined, h.beta)).status, 404);
  const restore = await h.setRoles(h.seeded[0], ['documentReader']);
  assert.equal((await h.req(`/documents/issues/${record._id}`, undefined, h.alpha)).status, 403); await restore();
});
