import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../../../apps/portfolio-api/test/support/owned-mongo.mjs';

test('approved component removal quarantines customer property without manufacturing stock fabrication', async t => {
  const h = await startOwned(t), key = values => ({ idempotencyKey: randomUUID(), ...values });
  const account = await h.ok('/crm/accounts', { name: 'Synthetic component owner' }, 201);
  let row = await h.ok('/repair/cases', key({ accountId: account._id, serial: 'REMAN-LOCAL', condition: 'Damaged seal', currency: 'USD' }), 201);
  const step = async (action, values) => row = await h.ok(`/repair/cases/${row._id}/${action}`, key({ expectedVersion: row.version, evidence: 'Synthetic custody proof', ...values }));
  await step('diagnostic-authorize', { feeCap: '10.00' });
  await step('teardown', { findings: [{ component: 'Seal', disposition: 'REPLACE' }, { component: 'Housing', disposition: 'REPAIR' }] });
  const quote = await h.ok('/commercial/quotes', { accountId: account._id, expiresAt: '2030-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Replace seal and repair housing', quantity: '1', uom: 'EA', unitPrice: '10.00', currency: 'USD' }] }, 201);
  await h.ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await step('scope', { quoteId: quote._id, revision: 1, depositRequired: '0.00' });
  await step('decide', { decision: 'ACCEPT', revision: 1 });
  await step('start', { evidence: undefined });
  const path = `/repair/cases/${row._id}/component-remove`, body = key({ expectedVersion: row.version, component: 'Seal', serial: 'REMOVED-SEAL-01', condition: 'Torn', evidence: 'Removed to labelled customer quarantine' });
  assert.equal((await h.req(path, { ...body, component: 'Housing' }, h.alpha)).error.code, 'COMPONENT_REMOVAL_NOT_AUTHORIZED');
  assert.equal((await h.req(path, body, h.beta)).status, 404);
  const restore = await h.setRoles(h.seeded[0], ['repairRead']);
  try { assert.equal((await h.req(path, body, h.alpha)).status, 403); } finally { await restore(); }
  row = await h.ok(path, body);
  assert.deepEqual(await h.ok(path, body), row);
  const removed = row.componentRemovals[0]; assert.equal(removed.status, 'QUARANTINED');
  assert.equal((await h.req(path, { ...body, expectedVersion: row.version, idempotencyKey: randomUUID() }, h.alpha)).error.code, 'COMPONENT_ALREADY_REMOVED');
  const disposition = `/repair/cases/${row._id}/component-dispose`;
  assert.equal((await h.req(disposition, key({ expectedVersion: row.version, componentId: removed.componentId, disposition: 'SCRAP', evidence: 'Not authorized to scrap' }), h.alpha)).error.code, 'COMPONENT_SCRAP_NOT_AUTHORIZED');
  await step('component-dispose', { componentId: removed.componentId, disposition: 'RETURN_TO_CUSTOMER' });
  assert.equal(row.componentRemovals[0].status, 'RETURNED_TO_CUSTOMER');
  const saved = await h.db.collection('repairRemovedComponents').findOne({ _id: removed.componentId });
  assert.equal(saved.ownerAccountId, account._id); assert.equal(saved.parentSerial, 'REMAN-LOCAL'); assert.equal(saved.scopeRevision, 1);
  assert.equal(await h.db.collection('repairComponentRevisions').countDocuments({ componentId: saved._id }), 2);
  for (const collection of ['catalogMaterialReservations', 'companyMaterialReservations', 'warehouseReceipts', 'internalExecutions']) assert.equal(await h.db.collection(collection).countDocuments(), 0);
});
