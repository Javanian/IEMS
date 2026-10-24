import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';

const command = values => ({ idempotencyKey: randomUUID(), ...values });
const collections = ['repairCases', 'repairInvoices', 'repairDeposits', 'repairPayments', 'repairKeys', 'repairAudit', 'repairOutbox'];
async function verifiedMutation(h, path, body, status = 200) {
  const snapshot = () => Promise.all(collections.map(n => h.db.collection(n).find().sort({ _id: 1 }).toArray()));
  const before = await snapshot();
  assert.equal((await h.req(path, body, h.beta)).status, 404);
  assert.equal((await h.req(path, { ...body, expectedVersion: 999 }, h.alpha)).status, 409);
  const restore = await h.setRoles(h.seeded[0], ['repairRead']);
  try { assert.equal((await h.req(path, body, h.alpha)).status, 403); }
  finally { await restore(); }
  assert.deepEqual(await snapshot(), before);
  for (const name of ['repairAudit', 'repairOutbox']) {
    await h.db.command({ collMod: name, validator: { forbidden: { $exists: true } } });
    try { assert.equal((await h.req(path, body, h.alpha)).status, 500); assert.deepEqual(await snapshot(), before); }
    finally { await h.db.command({ collMod: name, validator: {} }); }
  }
  const results = await Promise.all([1, 2, 3].map(() => h.req(path, body, h.alpha)));
  assert.deepEqual(results.map(r => r.status), [status, status, status], JSON.stringify(results));
  assert.deepEqual(results[0].data, results[1].data); assert.deepEqual(results[0].data, results[2].data);
  assert.equal((await h.req(path, { ...body, expectedVersion: body.expectedVersion + 1 }, h.alpha)).error.code, 'IDEMPOTENCY_CONFLICT');
  return results[0].data;
}
test('repair intake preserves customer ownership and immutable custody with authorized replay', { timeout: 120000 }, async t => {
  const h = await startOwned(t);
  console.log(JSON.stringify({ ownedDatabase: h.db.databaseName, marker: (await h.db.collection('ownedRun').findOne())._id, cleanup: 'marker-verified dropDatabase and replica stop registered in t.after' }));
  const account = await h.ok('/crm/accounts', { name: 'Synthetic repair customer' }, 201);
  const body = command({ accountId: account._id, serial: 'REPAIR-SYNTHETIC', condition: 'Damaged housing', currency: 'KWD' });
  const row = await h.ok('/repair/cases', body, 201);
  assert.equal(row.ownerAccountId, account._id); assert.equal(row.status, 'INTAKE');
  assert.equal(row.custody[0].kind, 'RECEIVED');
  assert.deepEqual(await h.ok('/repair/cases', body, 201), row);
  assert.equal(await h.db.collection('repairCases').countDocuments(), 1);
  assert.equal((await h.req(`/repair/cases/${row._id}`, undefined, h.beta)).status, 404);
  assert.equal((await h.req('/repair/cases', { ...body, serial: 'changed' }, h.alpha)).status, 409);
  assert.equal((await h.req('/repair/cases', { ...body, tenantId: h.seeded[1].tenantId }, h.alpha)).status, 403);
  const path = `/repair/cases/${row._id}`;
  const step = (action, expectedVersion, values = {}, status = 200) => verifiedMutation(h, `${path}/${action}`, command({ expectedVersion, ...values }), status);
  assert.equal((await h.req(`${path}/teardown`, command({ expectedVersion: 1, evidence: 'Unauthorized' }), h.alpha)).status, 409);
  await step('diagnostic-authorize', 1, { feeCap: '100.001', evidence: 'Customer authorization record' });
  await step('teardown', 2, { evidence: 'Opened and inspected housing', findings: [{ component: 'Housing', disposition: 'REPAIR' }] });
  const quote = await h.ok('/commercial/quotes', { accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Housing repair', quantity: '1', uom: 'EA', unitPrice: '99999999999999999999.999', currency: 'KWD' }] }, 201);
  await h.ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await h.ok(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const scoped = await step('scope', 3, { quoteId: quote._id, revision: 1, depositRequired: '3000.001', evidence: 'Revised scoped repair' });
  assert.equal(scoped.scopes[0].snapshot.total, '99999999999999999999.999');
  await step('decide', 4, { decision: 'ACCEPT', revision: 1, evidence: 'Customer accepted scope' });
  assert.equal((await h.req(`${path}/start`, command({ expectedVersion: 5 }), h.alpha)).status, 409);
  await step('deposit', 5, { amount: '3000.000', currency: 'KWD', reference: 'Synthetic bank receipt one' });
  assert.equal((await h.req(`${path}/start`, command({ expectedVersion: 6 }), h.alpha)).status, 409);
  for (const amount of [1, '1e0', '-1.000', '0.0001', '01.000']) assert.equal((await h.req(`${path}/deposit`, command({ expectedVersion: 6, amount, currency: 'KWD', reference: 'Invalid' }), h.alpha)).status, 400);
  await step('deposit', 6, { amount: '0.001', currency: 'KWD', reference: 'Synthetic bank receipt two' });
  const started = await step('start', 7);
  assert.equal(started.depositVerified, '3000.001'); assert.equal(started.status, 'IN_PROGRESS');
  for (const amount of [1, '1e0', '-1.000', '0.0001', '01.000']) assert.equal((await h.req(`${path}/deposit`, command({ expectedVersion: 7, amount, currency: 'KWD', reference: 'Invalid' }), h.alpha)).status, 409);
  const invoiceRead = await h.req('/repair/invoices', undefined, h.alpha); assert.equal(invoiceRead.status, 200);
  assert.equal((await h.db.collection('quotes').findOne({ _id: quote._id })).repairFence, 2);
  assert.deepEqual(invoiceRead.data, []);
  await step('execute', 8, { dispositions: [{ component: 'Housing', disposition: 'REPAIR' }], evidence: 'Housing restored' });
  await step('test', 9, { result: 'PASS', evidence: 'Pressure pass' });
  await step('qc', 10, { evidence: 'QC release' });
  const finalCase = await step('bill', 11);
  const finalInvoice = await h.ok(`/repair/invoices/${finalCase.finalInvoiceId}`);
  assert.equal(finalInvoice.total, '99999999999999999999.999');
  assert.equal(finalInvoice.depositApplied, '3000.001');
  assert.equal(finalInvoice.remaining, '99999999999999996999.998');
  assert.equal(await h.db.collection('repairInvoices').countDocuments({ caseId: row._id, kind: 'FINAL' }), 1);
});

test('repair rejected diagnostic invoice stays in custody until evidenced return and atomic rollback', { timeout: 120000 }, async t => {
  const h = await startOwned(t);
  console.log(JSON.stringify({ ownedDatabase: h.db.databaseName, marker: (await h.db.collection('ownedRun').findOne())._id, cleanup: 'marker-verified dropDatabase and replica stop registered in t.after' }));
  const account = await h.ok('/crm/accounts', { name: 'Synthetic rejected repair' }, 201);
  let row = await h.ok('/repair/cases', command({ accountId: account._id, serial: 'REJECT-UNIT', condition: 'Broken', currency: 'USD' }), 201);
  const path = `/repair/cases/${row._id}`;
  const step = async (action, values = {}) => { row = await verifiedMutation(h, `${path}/${action}`, command({ expectedVersion: row.version, ...values })); return row; };
  await step('diagnostic-authorize', { feeCap: '100.00', evidence: 'Customer caps fee' });
  await step('teardown', { evidence: 'Inspection', findings: [{ component: 'Shaft', disposition: 'REPLACE' }] });
  const quote = await h.ok('/commercial/quotes', { accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Replacement', quantity: '1', uom: 'EA', unitPrice: '500.00', currency: 'USD' }] }, 201);
  await h.ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await step('scope', { quoteId: quote._id, revision: 1, depositRequired: '100.00', evidence: 'Proposed scope' });
  const reject = command({ expectedVersion: row.version, decision: 'REJECT', revision: 1, diagnosticFee: '90.01', evidence: 'Customer declined' });
  assert.equal((await h.req(`${path}/decide`, { ...reject, diagnosticFee: '100.01' }, h.alpha)).status, 409);
  const names = ['repairCases', 'repairInvoices', 'repairDeposits', 'repairKeys', 'repairAudit', 'repairOutbox'];
  const snapshot = () => Promise.all(names.map(n => h.db.collection(n).find().sort({ _id: 1 }).toArray()));
  for (const name of ['repairAudit', 'repairOutbox']) {
    const before = await snapshot();
    await h.db.command({ collMod: name, validator: { forbidden: { $exists: true } } });
    try { assert.equal((await h.req(`${path}/decide`, reject, h.alpha)).status, 500); assert.deepEqual(await snapshot(), before); }
    finally { await h.db.command({ collMod: name, validator: {} }); }
  }
  row = await h.ok(`${path}/decide`, reject);
  assert.equal(row.status, 'REJECTED'); assert.equal(row.custodyState, 'RELEASED_FOR_RETURN');
  const invoice = await h.db.collection('repairInvoices').findOne({ caseId: row._id });
  assert.equal(invoice.total, '90.01'); assert.equal(invoice.currency, 'USD'); assert.equal(invoice.snapshot.lines[0].uom, 'EA');
  assert.deepEqual(await h.ok(`${path}/decide`, reject), row);
  assert.equal(await h.db.collection('repairInvoices').countDocuments(), 1);
  assert.equal((await h.req(`${path}/start`, command({ expectedVersion: row.version }), h.alpha)).status, 409);
  await step('return', { evidence: 'POD synthetic customer collection' });
  assert.equal(row.custodyState, 'RETURNED_UNREPAIRED_TO_CUSTOMER'); assert.equal(row.ownerAccountId, account._id);
  const settlement = command({ expectedVersion: 1, amount: '90.01', currency: 'USD', reference: 'Diagnostic receipt' });
  assert.equal((await h.req(`/repair/invoices/${invoice._id}/settle`, { ...settlement, amount: '90.02' }, h.alpha)).status, 409);
  const settled = await verifiedMutation(h, `/repair/invoices/${invoice._id}/settle`, settlement);
  assert.equal(settled.status, 'PAID'); assert.equal(settled.remaining, '0.00');
  assert.equal((await h.ok(path)).custodyState, 'RETURNED_UNREPAIRED_TO_CUSTOMER');
});

 test('repair execution failed test requires rework, latest pass and hold-free QC before return', { timeout: 120000 }, async t => {
  const h = await startOwned(t);
  console.log(JSON.stringify({ ownedDatabase: h.db.databaseName, marker: (await h.db.collection('ownedRun').findOne())._id, cleanup: 'marker-verified dropDatabase and replica stop registered in t.after' }));
  const account = await h.ok('/crm/accounts', { name: 'Synthetic execution' }, 201);
  let row = await h.ok('/repair/cases', command({ accountId: account._id, serial: 'EXEC-UNIT', condition: 'Broken', currency: 'USD' }), 201);
  const path = `/repair/cases/${row._id}`;
  const step = async (action, values = {}) => { row = await verifiedMutation(h, `${path}/${action}`, command({ expectedVersion: row.version, ...values })); return row; };
  const denied = (action, values = {}) => h.req(`${path}/${action}`, command({ expectedVersion: row.version, ...values }), h.alpha);
  await step('diagnostic-authorize', { feeCap: '0.00', evidence: 'Free diagnosis authorized' });
  await step('teardown', { evidence: 'Examined', findings: [{ component: 'Shaft', disposition: 'REPAIR' }, { component: 'Seal', disposition: 'REPLACE' }] });
  const quote = await h.ok('/commercial/quotes', { accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Repair', quantity: '1', uom: 'EA', unitPrice: '500.00', currency: 'USD' }] }, 201);
  await h.ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await step('scope', { quoteId: quote._id, revision: 1, depositRequired: '0.00', evidence: 'Scoped repair' });
  await step('decide', { decision: 'ACCEPT', revision: 1, evidence: 'Customer accepted' });
  await step('deposit', { amount: '100.01', currency: 'USD', reference: 'Billing deposit 1' });
  await step('deposit', { amount: '0.02', currency: 'USD', reference: 'Billing deposit 2' });
  await step('start');
  assert.equal((await denied('qc', { evidence: 'Premature' })).status, 409);
  await step('execute', { evidence: 'Repaired shaft; replaced seal', dispositions: [{ component: 'Shaft', disposition: 'REPAIR' }, { component: 'Seal', disposition: 'REPLACE' }] });
  await step('test', { result: 'FAIL', evidence: 'Leak at seal' });
  assert.equal((await denied('test', { result: 'PASS', evidence: 'Cannot bypass rework' })).status, 409);
  await step('rework', { evidence: 'Reseated seal' });
  await step('test', { result: 'PASS', evidence: 'Pressure retest passed' });
  await step('hold', { active: true, evidence: 'Pending inspection' });
  assert.equal((await denied('qc', { evidence: 'Held' })).status, 409);
  await step('hold', { active: false, evidence: 'Inspection cleared' });
  await step('qc', { evidence: 'Final independent inspection' });
  assert.equal(row.custodyState, 'RELEASED_FOR_RETURN');
  await step('return', { evidence: 'POD collection' });
  assert.equal(row.custodyState, 'RETURNED_TO_CUSTOMER'); assert.equal(row.tests.length, 2); assert.equal(row.reworks.length, 1);
  await step('bill');
  const billed = await h.ok(`/repair/invoices/${row.finalInvoiceId}`);
  assert.equal(billed.kind, 'FINAL'); assert.equal(billed.total, '500.00'); assert.equal(billed.remaining, '399.97');
  assert.equal(billed.depositApplied, '100.03'); assert.equal(billed.depositIds.length, 2);
  for (const depositId of billed.depositIds) assert.equal((await h.db.collection('repairDeposits').findOne({ _id: depositId })).appliedInvoiceId, billed._id);
  assert.equal((await denied('bill')).status, 409);
  const settlement = command({ expectedVersion: 1, amount: '399.97', currency: 'USD', reference: 'Final receipt' });
  const settled = await verifiedMutation(h, `/repair/invoices/${billed._id}/settle`, settlement);
  assert.equal(settled.remaining, '0.00'); assert.equal(settled.status, 'PAID');
  assert.equal(await h.db.collection('repairPayments').countDocuments(), 1);
  for (const role of ['repairRead', 'repairIntake', 'repairDiagnosticAuthorize', 'repairTeardown', 'repairScope', 'repairDecide', 'repairDeposit', 'repairStart', 'repairExecute', 'repairTest', 'repairRework', 'repairQc', 'repairHold', 'repairReturn']) {
    const restore = await h.setRoles(h.seeded[0], [role]);
    try {
      assert.equal((await h.req('/repair/cases', undefined, h.alpha)).status, 200);
      for (const [action, permittedRole] of [['start', 'repairStart'], ['qc', 'repairQc'], ['return', 'repairReturn']]) if (role !== permittedRole) assert.equal((await denied(action)).status, 403);
    } finally { await restore(); }
  }
  const foundation = h.runtime.foundation;
  let restore;
  h.runtime.foundation = { ...foundation, authorize: async (...args) => { const result = await foundation.authorize(...args); restore = await h.setRoles(h.seeded[0], ['repairRead']); return result; } };
  try { assert.equal((await denied('return', { evidence: 'Revoked actor' })).status, 403); }
  finally { h.runtime.foundation = foundation; if (restore) await restore(); }
});
