import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const key = () => randomUUID();
export const reason = 'Synthetic independently observed catalog receipt boundary';

export async function domainSnapshot(h) {
  const excluded = new Set(['sessions', 'memberships', 'users', 'tenants', 'plants', 'legalEntities', 'credentials', 'ownedRun']);
  const names = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).filter(name => !excluded.has(name)).sort();
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await h.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
}

export async function denyNoEffects(h, path, body, code) {
  const before = await domainSnapshot(h), response = await h.req(path, body, h.alpha);
  assert.equal(response.status, 409, `${path}: ${JSON.stringify(response)}`);
  assert.equal(response.error.code, code, path); assert.deepEqual(await domainSnapshot(h), before);
  return response;
}

export async function withReplacement(h, collection, original, replacement, effect) {
  await h.db.collection(collection).replaceOne({ _id: original._id }, replacement);
  try { return await effect(); }
  finally { await h.db.collection(collection).replaceOne({ _id: original._id }, original); }
}

export async function afterAuthorization(h, action, intervention, command) {
  const original = h.runtime.foundation; let reached = 0;
  h.runtime.foundation = { ...original, authorize: async (...args) => {
    const result = await original.authorize(...args);
    if (args[1]?.action === action && reached === 0) { reached++; await intervention(); }
    return result;
  } };
  try { const response = await command(); assert.equal(reached, 1, action); return response; }
  finally { h.runtime.foundation = original; }
}

export async function legacyFixture(h) {
  const financial = { taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP' };
  const account = await h.ok('/crm/accounts', { name: 'Synthetic independent mapping customer' }, 201);
  const quote = await h.ok('/commercial/quotes', { ...financial, accountId: account._id, expiresAt: new Date(Date.now() + 3600000).toISOString(), lines: [{ description: 'Synthetic legacy entitlement control', quantity: '10', uom: 'UN', unitPrice: '1.00', currency: 'USD' }] }, 201);
  await h.ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await h.ok(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const so = await h.ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: key() });
  const vendor = await h.ok('/procurement/vendors', { name: 'Synthetic actual mapping supplier' }, 201);
  const pr = await h.ok('/procurement/requests', { ...financial, vendorId: vendor._id, lines: [{ description: 'Synthetic legacy physical source', quantity: '20', uom: 'UN', unitPrice: '1.00', currency: 'USD' }] }, 201);
  await h.ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await h.ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: key() });
  await h.ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const receive = (quantity, suffix) => h.ok('/warehouse/receipts', { purchaseOrderId: po._id, vendorId: vendor._id, expectedVersion: 2, lineIndex: 0, quantity, uom: 'UN', lotNumber: `MAP-QA-LEGACY-${suffix}`, heatNumber: `MAP-QA-HEAT-${suffix}`, idempotencyKey: key() }, 201);
  let receipt = await receive('10', 'MAIN');
  receipt = await h.ok(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: receipt.version, reason, idempotencyKey: key() });
  receipt = await h.ok(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion: receipt.version, location: 'MAP-QA-LEGACY', idempotencyKey: key() });
  const bin = await h.ok('/warehouse/bins', { expectedVersion: 1, code: 'MAP-QA-ALTERNATE', idempotencyKey: key() }, 201);
  await h.ok(`/warehouse/receipts/${receipt._id}/reserve`, { expectedVersion: receipt.version, salesOrderId: so._id, accountId: account._id, lineIndex: 0, quantity: '1', uom: 'UN', idempotencyKey: key() });
  const reservation = await h.db.collection('warehouseReservations').findOne({ receiptId: receipt._id });
  const batch = await h.ok('/manufacturing/work-orders', { salesOrderId: so._id, expectedVersion: so.version, lineIndex: 0, quantities: ['1', '1', '1'], uom: 'UN', idempotencyKey: key() }, 201);
  const operations = [{ code: 'MAP-QA-OP', instruction: 'Synthetic explicit legacy guard control' }], materials = [{ receiptId: receipt._id, quantityPerUnit: '1', uom: 'UN' }];
  const released = await h.ok(`/manufacturing/work-orders/${batch.workOrders[0]._id}/release`, { expectedVersion: 1, operations, materials, idempotencyKey: key() });
  const engineeringBody = { expectedVersion: 1, salesOrderId: so._id, salesOrderVersion: so.version, lineIndex: 0, uom: 'UN', operations, materials };
  const engineering = await h.ok('/manufacturing/engineering', { ...engineeringBody, idempotencyKey: key() }, 201);
  const approvedEngineering = await h.ok(`/manufacturing/engineering/${engineering._id}/release`, { expectedVersion: engineering.version, revision: engineering.currentRevision, idempotencyKey: key() });
  const draftEngineering = await h.ok('/manufacturing/engineering', { ...engineeringBody, idempotencyKey: key() }, 201);
  return { account, vendor, so, po, receipt, bin, reservation, workOrders: batch.workOrders, released, operations, materials, engineeringBody, approvedEngineering, draftEngineering, receive };
}
