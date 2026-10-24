import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';

test('independent K2a adoption, competing legacy paths and pre-consumption custody ordering', async t => {
  const h = await startOwned(t), key = () => randomUUID();
  const account = await h.ok('/crm/accounts', { name: 'Synthetic independent K2a customer' }, 201);
  const commercial = { taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic independent K2a assembly', quantity: '10', uom: 'UN', unitPrice: '1.00', currency: 'USD' }] };
  const quote = await h.ok('/commercial/quotes', { ...commercial, accountId: account._id, expiresAt: new Date(Date.now() + 3600000).toISOString() }, 201);
  await h.ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await h.ok(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const so = await h.ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: key() });
  const vendor = await h.ok('/procurement/vendors', { name: 'Synthetic independent K2a vendor' }, 201);
  const pr = await h.ok('/procurement/requests', { ...commercial, lines: [{ ...commercial.lines[0], quantity: '20' }], vendorId: vendor._id }, 201);
  await h.ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await h.ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: key() });
  await h.ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const makeReceipt = async count => {
    const row = await h.ok('/warehouse/receipts', { purchaseOrderId: po._id, expectedVersion: 2, vendorId: vendor._id, lineIndex: 0, quantity: String(count), uom: 'UN', serials: Array.from({ length: count }, () => `K2A-QA-${key()}`), lotNumber: `LOT-${key()}`, heatNumber: `HEAT-${key()}`, idempotencyKey: key() }, 201);
    await h.ok(`/warehouse/receipts/${row._id}/release`, { expectedVersion: 1, reason: 'Synthetic K2a inspection', idempotencyKey: key() });
    await h.ok(`/warehouse/receipts/${row._id}/putaway`, { expectedVersion: 2, location: 'K2A-QA-BIN', idempotencyKey: key() });
    return row;
  };
  const legacyFirst = await makeReceipt(2), adoptedFirst = await makeReceipt(2), component = await makeReceipt(4), invalidOrigin = await makeReceipt(2);
  const planned = await h.ok('/manufacturing/work-orders', { salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, quantities: ['2', '2'], uom: 'UN', serialized: true, genealogyRequired: true, serialCustodyRequired: true, idempotencyKey: key() }, 201);
  const [target, idle] = planned.workOrders;
  const receiptPath = receipt => `/warehouse/receipts/${receipt._id}/serial-custody`;
  const claimsPath = wo => `/manufacturing/work-orders/${wo._id}/serial-claims`;
  const receiptView = receipt => h.ok(receiptPath(receipt));
  const claimsView = wo => h.ok(claimsPath(wo));
  const receiptRow = receipt => h.db.collection('warehouseReceipts').findOne({ _id: receipt._id });
  const snapshot = async () => {
    const excluded = new Set(['sessions', 'memberships', 'users', 'tenants', 'plants', 'legalEntities', 'credentials', 'ownedRun']);
    const names = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).filter(name => !excluded.has(name)).sort();
    return Object.fromEntries(await Promise.all(names.map(async name => [name, await h.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
  };
  const stock = async receipt => {
    const row = await receiptRow(receipt);
    return Object.fromEntries(['quantity', 'availableQuantity', 'reservedQuantity', 'shippedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity'].filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]]));
  };
  const adoptBody = async receipt => ({ expectedVersion: (await receiptRow(receipt)).version, reason: 'Synthetic explicit untouched receipt adoption', idempotencyKey: key() });
  const reserveBody = async receipt => ({ expectedVersion: (await receiptRow(receipt)).version, salesOrderId: so._id, accountId: account._id, lineIndex: 0, quantity: '1', uom: 'UN', idempotencyKey: key() });
  const claimBody = async (wo, receipt) => {
    const [current, source] = await Promise.all([claimsView(wo), receiptView(receipt)]);
    return { expectedVersion: current.workOrderVersion, expectedReceiptVersion: source.receiptVersion, receiptId: receipt._id, serialUnitIds: source.units.filter(unit => unit.status === 'AVAILABLE').map(unit => unit._id), reason: 'Synthetic explicit source identities', idempotencyKey: key() };
  };
  const releaseBody = (current, claim) => ({ expectedVersion: current.workOrderVersion, operations: [{ code: 'K2A-QA-OP', instruction: 'Synthetic independent custody operation' }], materials: [{ receiptId: component._id, quantityPerUnit: '2', uom: 'UN' }], serialClaims: [{ receiptId: component._id, claimId: claim._id }], idempotencyKey: key() });
  const afterAuthorization = async (action, intervention, command) => {
    const original = h.runtime.foundation; let reached = 0;
    h.runtime.foundation = { ...original, authorize: async (...args) => {
      const result = await original.authorize(...args);
      if (args[1]?.action === action && reached === 0) { reached++; await intervention(); }
      return result;
    } };
    try { const result = await command(); assert.equal(reached, 1); return result; }
    finally { h.runtime.foundation = original; }
  };
  const applyHold = async receipt => {
    const response = await h.send(`/warehouse/receipts/${receipt._id}/holds`, { headers: { 'Idempotency-Key': key() }, body: { expectedReceiptVersion: (await receiptRow(receipt)).version, reasonCode: 'QC_SUSPECT', reasonNote: 'Synthetic K2a late source hold' } });
    assert.equal(response.status, 201, JSON.stringify(response)); return response.data.hold;
  };
  const releaseHold = async hold => {
    const response = await h.send(`/warehouse/holds/${hold.id}/release`, { headers: { 'Idempotency-Key': key() }, body: { expectedVersion: hold.version, reasonCode: 'INSPECTION_PASSED', reasonNote: 'Synthetic K2a source hold cleared' } });
    assert.equal(response.status, 200, JSON.stringify(response));
  };

  await t.test('legacy reservation committed before adoption prevents promotion with no partial authority', async () => {
    const body = await adoptBody(legacyFirst); let afterReserve;
    const response = await afterAuthorization('custody.adopt', async () => { await h.ok(`/warehouse/receipts/${legacyFirst._id}/reserve`, await reserveBody(legacyFirst)); afterReserve = await snapshot(); }, () => h.req(`${receiptPath(legacyFirst)}/adopt`, body, h.alpha));
    assert.equal(response.status, 409, JSON.stringify(response)); assert.deepEqual(await snapshot(), afterReserve);
    assert.equal((await receiptView(legacyFirst)).tracked, false); assert.equal((await receiptRow(legacyFirst)).serialCustody, undefined);
    const retry = await h.req(`${receiptPath(legacyFirst)}/adopt`, await adoptBody(legacyFirst), h.alpha);
    assert.equal(retry.status, 409); assert.deepEqual(await snapshot(), afterReserve);
  });

  let adoptionRequest, adoptionResponse;
  await t.test('adoption committed before a legacy reservation permanently blocks quantity-only use', async () => {
    const body = await reserveBody(adoptedFirst), beforeStock = await stock(adoptedFirst); let afterAdopt;
    const response = await afterAuthorization('warehouse.reserve', async () => { adoptionRequest = await adoptBody(adoptedFirst); adoptionResponse = await h.ok(`${receiptPath(adoptedFirst)}/adopt`, adoptionRequest); afterAdopt = await snapshot(); }, () => h.req(`/warehouse/receipts/${adoptedFirst._id}/reserve`, body, h.alpha));
    assert.equal(response.status, 409); assert.deepEqual(await snapshot(), afterAdopt); assert.deepEqual(await stock(adoptedFirst), beforeStock);
    assert.equal((await receiptView(adoptedFirst)).claimableQuantity, '2');
    const fresh = await h.req(`/warehouse/receipts/${adoptedFirst._id}/reserve`, await reserveBody(adoptedFirst), h.alpha);
    assert.equal(fresh.status, 409); assert.equal(fresh.error.code, 'SERIAL_CUSTODY_REQUIRED'); assert.deepEqual(await snapshot(), afterAdopt);
  });

  await t.test('manufactured-origin registry contamination prevents adoption without effects', async () => {
    const registry = await h.db.collection('warehouseSerials').findOne({ receiptId: invalidOrigin._id });
    await h.db.collection('warehouseSerials').updateOne({ _id: registry._id }, { $set: { sourceType: 'MANUFACTURING_OUTPUT', workOrderId: target._id, unitId: key() } });
    try {
      const before = await snapshot();
      const response = await h.req(`${receiptPath(invalidOrigin)}/adopt`, await adoptBody(invalidOrigin), h.alpha);
      assert.equal(response.status, 409); assert.equal(response.error.code, 'SERIAL_CUSTODY_SOURCE_INVALID');
      assert.deepEqual(await snapshot(), before); assert.equal((await receiptView(invalidOrigin)).tracked, false);
    } finally { await h.db.collection('warehouseSerials').replaceOne({ _id: registry._id }, registry); }
  });

  await t.test('invalid inactive hold cache prevents new claims without making legacy quantity stock', async () => {
    const original = await receiptRow(adoptedFirst), body = await claimBody(idle, adoptedFirst);
    await h.db.collection('warehouseReceipts').updateOne({ _id: adoptedFirst._id }, { $set: { hold: { active: false } } });
    try {
      const current = await receiptView(adoptedFirst);
      assert.equal(current.tracked, true); assert.equal(current.claimableQuantity, '0');
      assert.ok(current.sourceHolds.some(hold => hold.legacy && hold.reasonCodes.includes('INVALID_HOLD_CACHE')));
      const before = await snapshot(), response = await h.req(claimsPath(idle), body, h.alpha);
      assert.equal(response.status, 409); assert.equal(response.error.code, 'STOCK_ENCUMBERED'); assert.deepEqual(await snapshot(), before);
    } finally { await h.db.collection('warehouseReceipts').updateOne({ _id: adoptedFirst._id }, Object.hasOwn(original, 'hold') ? { $set: { hold: original.hold } } : { $unset: { hold: '' } }); }
  });

  let claim, claimedRequest, claimedResponse, released, releasedRequest;
  const sourceStock = await stock(component);
  await h.ok(`${receiptPath(component)}/adopt`, await adoptBody(component));
  await t.test('claim and abandon preceding release invalidate its captured WO version without quantity movement', async () => {
    const stale = { ...releaseBody(await claimsView(target), { _id: key() }), serialClaims: [] }; let afterClaim;
    const response = await afterAuthorization('manufacturing.release', async () => { claimedRequest = await claimBody(target, component); claimedResponse = await h.ok(claimsPath(target), claimedRequest); claim = claimedResponse.claims[0]; afterClaim = await snapshot(); }, () => h.req(`/manufacturing/work-orders/${target._id}/release`, stale, h.alpha));
    assert.equal(response.status, 409); assert.equal(response.error.code, 'VERSION_CONFLICT'); assert.deepEqual(await snapshot(), afterClaim);
    assert.equal(claim.serialUnitIds.length, 4); assert.deepEqual(await stock(component), sourceStock);
    const body = releaseBody(await claimsView(target), claim); let afterAbandon;
    const abandoned = await afterAuthorization('manufacturing.release', async () => { await h.ok(`${claimsPath(target)}/abandon`, { expectedVersion: (await claimsView(target)).workOrderVersion, expectedClaimVersion: claim.version, claimId: claim._id, reason: 'Synthetic explicit abandoned source choice', idempotencyKey: key() }); afterAbandon = await snapshot(); }, () => h.req(`/manufacturing/work-orders/${target._id}/release`, body, h.alpha));
    assert.equal(abandoned.status, 409); assert.equal(abandoned.error.code, 'VERSION_CONFLICT'); assert.deepEqual(await snapshot(), afterAbandon);
    assert.equal((await claimsView(target)).claims.length, 0); assert.equal((await receiptView(component)).claimableQuantity, '4'); assert.deepEqual(await stock(component), sourceStock);
    const legacy = await h.req(`/warehouse/receipts/${component._id}/reserve`, await reserveBody(component), h.alpha);
    assert.equal(legacy.status, 409); assert.equal(legacy.error.code, 'SERIAL_CUSTODY_REQUIRED'); assert.deepEqual(await snapshot(), afterAbandon);
    claimedRequest = await claimBody(target, component); claimedResponse = await h.ok(claimsPath(target), claimedRequest); claim = claimedResponse.claims[0];
  });

  await t.test('trailing duplicate serial in persisted claim cannot become frozen release evidence', async () => {
    const stored = await h.db.collection('serialCustodyClaims').findOne({ _id: claim._id });
    await h.db.collection('serialCustodyClaims').updateOne({ _id: claim._id }, { $set: { serials: [...stored.serials, stored.serials.at(-1)] } });
    try {
      const current = await claimsView(target), before = await snapshot();
      const response = await h.req(`/manufacturing/work-orders/${target._id}/release`, releaseBody(current, claim), h.alpha);
      assert.equal(response.status, 409); assert.equal(response.error.code, 'SERIAL_CUSTODY_SOURCE_INVALID'); assert.deepEqual(await snapshot(), before);
    } finally { await h.db.collection('serialCustodyClaims').updateOne({ _id: claim._id }, { $set: { serials: stored.serials } }); }
  });

  await t.test('release preceding abandon reserves exactly four ratio2 identities and prevents unclaim', async () => {
    const current = await claimsView(target), body = { expectedVersion: current.workOrderVersion, expectedClaimVersion: claim.version, claimId: claim._id, reason: 'Synthetic competing abandon', idempotencyKey: key() }; let afterRelease;
    const response = await afterAuthorization('custody.abandon', async () => { releasedRequest = releaseBody(current, claim); released = await h.ok(`/manufacturing/work-orders/${target._id}/release`, releasedRequest); afterRelease = await snapshot(); }, () => h.req(`${claimsPath(target)}/abandon`, body, h.alpha));
    assert.equal(response.status, 409); assert.deepEqual(await snapshot(), afterRelease);
    const currentClaim = (await claimsView(target)).claims[0]; assert.equal(currentClaim.status, 'RESERVED'); assert.equal(currentClaim.serialUnitIds.length, 4);
    assert.ok((await receiptView(component)).units.every(unit => unit.status === 'RESERVED' && unit.workOrderId === target._id));
    const row = await receiptRow(component); assert.equal(row.availableQuantity, '0'); assert.equal(row.manufacturingReservedQuantity, '4');
    assert.deepEqual(new Set(released.routing.materials[0].serialCustody.serialUnitIds), new Set(claim.serialUnitIds));
  });

  const record = () => ({ expectedVersion: released.version, operationIndex: 0, inputQuantity: '2', goodQuantity: '0', scrapQuantity: '2', uom: 'UN', evidence: 'Synthetic zero-good consumes inputs exactly once', outputSerials: [], idempotencyKey: key() });
  await t.test('later hold blocks first consumption but retains the exact authorized release replay', async () => {
    let hold, afterHold;
    const response = await afterAuthorization('manufacturing.record', async () => { hold = await applyHold(component); afterHold = await snapshot(); }, () => h.req(`/manufacturing/work-orders/${target._id}/record`, record(), h.alpha));
    try {
      assert.equal(response.status, 409); assert.equal(response.error.code, 'STOCK_ENCUMBERED'); assert.deepEqual(await snapshot(), afterHold);
      assert.ok((await receiptView(component)).units.every(unit => unit.status === 'RESERVED'));
      assert.deepEqual(await h.ok(`/manufacturing/work-orders/${target._id}/release`, releasedRequest), released); assert.deepEqual(await snapshot(), afterHold);
    }
    finally { if (hold) await releaseHold(hold); }
  });

  await t.test('audit failure rolls back custody, quantities, stock evidence and key; zero-good retry consumes once', async () => {
    const body = record(), before = await snapshot();
    await h.db.command({ collMod: 'manufacturingAudit', validator: { qaForbidden: { $exists: true } }, validationLevel: 'strict' });
    try {
      const response = await h.req(`/manufacturing/work-orders/${target._id}/record`, body, h.alpha);
      assert.equal(response.status, 500); assert.deepEqual(await snapshot(), before);
    } finally { await h.db.command({ collMod: 'manufacturingAudit', validator: {} }); }
    const result = await h.ok(`/manufacturing/work-orders/${target._id}/record`, body);
    assert.equal(result.output.quantity, '0');
    const current = await receiptView(component); assert.ok(current.units.every(unit => unit.status === 'CONSUMED' && unit.workOrderId === target._id));
    const row = await receiptRow(component); assert.equal(row.manufacturingReservedQuantity, '0'); assert.equal(row.manufacturingConsumedQuantity, '4');
    assert.equal(await h.db.collection('manufacturingMovements').countDocuments({ workOrderId: target._id, kind: 'MATERIAL_CONSUMED' }), 1);
    assert.equal(await h.db.collection('manufacturingOutputUnits').countDocuments({ workOrderId: target._id }), 0);
    const committed = await snapshot(); assert.deepEqual(await h.ok(`/manufacturing/work-orders/${target._id}/record`, body), result); assert.deepEqual(await snapshot(), committed);
    assert.deepEqual(await h.ok(claimsPath(target), claimedRequest), claimedResponse); assert.deepEqual(await snapshot(), committed);
  });

  await t.test('committing guard denies acknowledged adoption and claim replays after real membership revocation', async () => {
    for (const [action, path, body] of [['custody.adopt', `${receiptPath(adoptedFirst)}/adopt`, adoptionRequest], ['custody.claim', claimsPath(target), claimedRequest]]) {
      const before = await snapshot(), membership = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId }); let revoked = false;
      try {
        const response = await afterAuthorization(action, async () => { revoked = true; await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: [] } }); }, () => h.req(path, body, h.alpha));
        assert.equal(revoked, true); assert.equal(response.status, 403); assert.deepEqual(await snapshot(), before);
      } finally { await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: membership.roles } }); }
    }
    const before = await snapshot(); assert.deepEqual(await h.ok(`${receiptPath(adoptedFirst)}/adopt`, adoptionRequest), adoptionResponse); assert.deepEqual(await snapshot(), before);
  });
});
