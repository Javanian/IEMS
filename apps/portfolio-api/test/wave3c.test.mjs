import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { startOwned, orderWithStock } from './support/owned-mongo.mjs';

const key = () => randomUUID();
async function repairInvoice(h, final = false) {
  const account = await h.ok('/crm/accounts', { name: 'Wave3c repair customer' }, 201);
  let row = await h.ok('/repair/cases', { accountId: account._id, serial: key(), condition: 'Synthetic inspection', currency: 'USD', idempotencyKey: key() }, 201);
  const step = async (action, values = {}) => row = await h.ok(`/repair/cases/${row._id}/${action}`, { expectedVersion: row.version, idempotencyKey: key(), ...values });
  await step('diagnostic-authorize', { feeCap: '1.00', evidence: 'Authorized cap' });
  const findings = [{ component: 'Housing', disposition: 'REPAIR' }];
  await step('teardown', { findings, evidence: 'Inspection' });
  const q = await h.ok('/commercial/quotes', { accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Repair housing', quantity: '1', uom: 'EA', unitPrice: '1.00', currency: 'USD' }] }, 201);
  await h.ok(`/commercial/quotes/${q._id}/approve`, { expectedVersion: 1, revision: 1 });
  await step('scope', { quoteId: q._id, revision: 1, depositRequired: '0.00', evidence: 'Frozen scope' });
  await step('decide', { decision: final ? 'ACCEPT' : 'REJECT', revision: 1, evidence: 'Customer decision', ...(final ? {} : { diagnosticFee: '1.00' }) });
  if (final) {
    await step('start'); await step('execute', { dispositions: findings, evidence: 'Executed' });
    await step('test', { result: 'PASS', evidence: 'Tested' }); await step('qc', { evidence: 'QC release' }); await step('bill');
  }
  return h.ok(`/repair/invoices/${final ? row.finalInvoiceId : row.diagnosticInvoiceId}`);
}

test('wave3c real Mongo unique-index collision maps to domain reference conflict with transaction rollback', { timeout: 120000 }, async t => {
  const h = await startOwned(t), invoice = await repairInvoice(h);
  const original = h.db.collection.bind(h.db);
  await original('repairPayments').insertOne({ _id: key(), tenantId: invoice.tenantId, plantId: invoice.plantId, reference: 'WAVE3C-INDEX-COLLISION', source: 'OWNED_COLLISION_PROBE' });
  h.db.collection = name => {
    const collection = original(name);
    if (name === 'repairPayments') {
      collection.findOne = async () => null;
    }
    return collection;
  };
  const before = await Promise.all(['repairInvoices', 'repairKeys', 'repairAudit', 'repairOutbox'].map(n => original(n).find().sort({ _id: 1 }).toArray()));
  try {
    const result = await h.req(`/repair/invoices/${invoice._id}/settle`, { expectedVersion: 1, amount: '0.50', currency: 'USD', reference: 'WAVE3C-INDEX-COLLISION', idempotencyKey: key() }, h.alpha);
    assert.equal(result.status, 409, JSON.stringify(result)); assert.equal(result.error.code, 'DUPLICATE_REFERENCE');
    assert.deepEqual(await Promise.all(['repairInvoices', 'repairKeys', 'repairAudit', 'repairOutbox'].map(n => original(n).find().sort({ _id: 1 }).toArray())), before);
    assert.equal(await original('repairPayments').countDocuments(), 1);
  } finally { h.db.collection = original; }
});

const paymentCollections = ['repairInvoices', 'repairPayments', 'repairKeys', 'repairAudit', 'repairOutbox'];
test('wave3c cross-invoice duplicate repair reference returns domain conflict and no loser effects', { timeout: 120000 }, async t => {
  const h = await startOwned(t), invoices = await Promise.all([repairInvoice(h), repairInvoice(h)]);
  const counts = await Promise.all(paymentCollections.map(n => h.db.collection(n).countDocuments()));
  const bodies = invoices.map(() => ({ expectedVersion: 1, amount: '0.50', currency: 'USD', reference: 'WAVE3C-SAME-REFERENCE', idempotencyKey: key() }));
  const results = await Promise.all(invoices.map((v, i) => h.req(`/repair/invoices/${v._id}/settle`, bodies[i], h.alpha)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409], JSON.stringify(results));
  const loser = results.findIndex(r => r.status === 409), winner = 1 - loser;
  assert.equal(results[loser].error.code, 'DUPLICATE_REFERENCE');
  assert.deepEqual(await h.ok(`/repair/invoices/${invoices[loser]._id}`), invoices[loser]);
  assert.equal(await h.db.collection('repairPayments').countDocuments(), 1);
  assert.deepEqual(await Promise.all(paymentCollections.map(n => h.db.collection(n).countDocuments())), counts.map((n, i) => n + (i ? 1 : 0)));
  const before = await Promise.all(paymentCollections.map(n => h.db.collection(n).find().sort({ _id: 1 }).toArray()));
  assert.deepEqual(await h.ok(`/repair/invoices/${invoices[winner]._id}/settle`, bodies[winner]), results[winner].data);
  assert.equal((await h.req(`/repair/invoices/${invoices[loser]._id}/settle`, bodies[loser], h.alpha)).error.code, 'DUPLICATE_REFERENCE');
  assert.deepEqual(await Promise.all(paymentCollections.map(n => h.db.collection(n).find().sort({ _id: 1 }).toArray())), before);
  console.log(JSON.stringify({ wave3c: 'reference-race', database: h.db.databaseName, statuses: results.map(r => r.status), counts: await Promise.all(paymentCollections.map(n => h.db.collection(n).countDocuments())) }));
});

test('wave3c repair financial source is immutable across settlement with strict authorization and recovery', { timeout: 120000 }, async t => {
  const h = await startOwned(t);
  for (const final of [false, true]) {
    const invoice = await repairInvoice(h, final), body = { kind: 'repairInvoice', sourceId: invoice._id, sourceVersion: 1 };
    const sourcePath = `/documents/sources/repairInvoice/${invoice._id}?sourceVersion=1`;
    const source = await h.ok(sourcePath);
    assert.equal(source.total, invoice.total); assert.equal(source.kind, 'invoice');
    assert.equal((await h.req('/documents/issues', { ...body, sourceVersion: 2 }, h.alpha)).status, 400);
    assert.equal((await h.req('/documents/issues', { ...body, snapshot: source }, h.alpha)).status, 400);
    assert.equal((await h.req(sourcePath, undefined, h.beta)).status, 404);
    const restore = await h.setRoles(h.seeded[0], ['documentIssuer', 'fulfillmentRead']);
    try { assert.equal((await h.req('/documents/issues', body, h.alpha)).status, 403); }
    finally { await restore(); }
    await h.db.command({ collMod: 'documentIntents', validator: { state: { $ne: 'READY' } } });
    try { assert.equal((await h.req('/documents/issues', body, h.alpha)).status, 500); }
    finally { await h.db.command({ collMod: 'documentIntents', validator: {} }); }
    const intent = await h.db.collection('documentIntents').findOne({ sourceId: invoice._id });
    assert.equal(intent.state, 'PREPARED');
    assert.equal((await h.req(`/documents/issues/${intent._id}`, undefined, h.alpha)).status, 404);
    await h.ok(`/repair/invoices/${invoice._id}/settle`, { expectedVersion: 1, amount: '0.50', currency: 'USD', reference: key(), idempotencyKey: key() });
    assert.deepEqual(await h.ok(sourcePath), source);
    const denied = await h.setRoles(h.seeded[0], ['documentReader', 'repairRead']);
    try { assert.equal((await h.req('/documents/issues', body, h.alpha)).status, 403); }
    finally { await denied(); }
    const results = await Promise.all([1, 2, 3].map(() => h.req('/documents/issues', body, h.alpha)));
    assert.deepEqual(results.map(r => r.status), [200, 200, 200], JSON.stringify(results));
    assert.deepEqual(results[0].data, results[1].data); assert.deepEqual(results[0].data, results[2].data);
    assert.equal(results[0].data._id, intent._id);
    assert.equal(await h.db.collection('documentAudit').countDocuments({ sourceId: invoice._id }), 1);
    assert.equal(await h.db.collection('documentOutbox').countDocuments({ sourceId: invoice._id }), 1);
    const pdf = await h.raw(`/documents/issues/${intent._id}/pdf`);
    assert.equal(pdf.status, 200); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    const noSource = await h.setRoles(h.seeded[0], ['documentReader']);
    try { assert.equal((await h.raw(`/documents/issues/${intent._id}/pdf`)).status, 403); }
    finally { await noSource(); }
  }
});

test('wave3c cumulative fractional invoice documents preserve ledger line amount exactly', { timeout: 120000 }, async t => {
  const h = await startOwned(t), flow = await orderWithStock(h, { orderQuantity: '1', receiptQuantity: '1', reserve: '1' });
  const shipment = await h.ok('/fulfillment/shipments', { salesOrderId: flow.so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', reference: 'Wave3c fractional', sources: [{ sourceType: 'RESERVATION', sourceId: flow.reservation._id, quantity: '1' }], idempotencyKey: key() }, 201);
  const invoices = [];
  for (let i = 0; i < 2; i++) invoices.push(await h.ok('/fulfillment/invoices', { salesOrderId: flow.so._id, expectedVersion: 1, lines: [{ shipmentId: shipment._id, quantity: '0.5' }], idempotencyKey: key() }, 201));
  assert.deepEqual(invoices.map(i => i.total), ['0.03', '0.02']);
  for (const invoice of invoices) {
    const record = await h.ok('/documents/issues', { kind: 'invoice', sourceId: invoice._id, sourceVersion: 1 });
    assert.equal(record.snapshot.total, invoice.total); assert.equal(record.snapshot.lines[0].amount, invoice.lines[0].amount);
    const pdf = await h.raw(`/documents/issues/${record._id}/pdf`);
    assert.equal(pdf.status, 200);
    const { getDocument } = await import('../../../packages/document-rendering/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    const evidence = new URL(`../evidence/wave3c-a-${key()}/`, import.meta.url);
    await mkdir(evidence, { recursive: true });
    await writeFile(new URL('invoice.pdf', evidence), bytes);
    const doc = await getDocument({ data: bytes, useSystemFonts: true }).promise;
    const text = (await (await doc.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
    assert.ok(text.includes(invoice.total), text);
    await writeFile(new URL('parsed.json', evidence), JSON.stringify({ invoice, record, text }, null, 2));
    console.log(JSON.stringify({ wave3cEvidence: evidence.pathname, total: invoice.total }));
    await doc.destroy();
  }
});
