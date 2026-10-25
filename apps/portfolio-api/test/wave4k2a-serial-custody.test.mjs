import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';

const key = () => randomUUID();
const command = values => ({ expectedVersion: 1, idempotencyKey: key(), ...values });
const woPath = wo => `/manufacturing/work-orders/${wo._id}`;
const receiptPath = receipt => `/warehouse/receipts/${receipt._id}`;
const stocks = rows => rows.map(row => Object.fromEntries(['_id', 'quantity', 'availableQuantity', 'reservedQuantity', 'shippedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity'].map(k => [k, row[k]])));

async function setup(h, { quantities = ['2', '1', '1', '1', '1'], ratios = ['1', '2'] } = {}) {
  const total = quantities.reduce((sum, n) => sum + Number(n), 0), prefix = key().slice(0, 8), ok = h.ok;
  const account = await ok('/crm/accounts', { name: 'Supplemental custody customer' }, 201);
  const quote = await ok('/commercial/quotes', { accountId: account._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', expiresAt: '2027-01-01T00:00:00.000Z', lines: [{ description: 'Supplemental received-serial assembly', quantity: String(total), uom: 'UN', unitPrice: '1.00', currency: 'USD' }] }, 201);
  await ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 }); await ok(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const so = await ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: key() });
  const vendor = await ok('/procurement/vendors', { name: 'Supplemental serial supplier' }, 201);
  const lines = ratios.map((ratio, index) => ({ description: `Supplemental component ${index}`, quantity: String(total * Number(ratio)), uom: index ? 'SET' : 'UN', unitPrice: '1.00', currency: 'USD' }));
  const pr = await ok('/procurement/requests', { vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines }, 201);
  await ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: key() }); await ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const receipts = [];
  for (let i = 0; i < lines.length; i++) {
    const receipt = await ok('/warehouse/receipts', command({ expectedVersion: 2, purchaseOrderId: po._id, vendorId: vendor._id, lineIndex: i, quantity: lines[i].quantity, uom: lines[i].uom, serials: Array.from({ length: Number(lines[i].quantity) }, (_, j) => `${prefix}_PART_${i}_${j}`), lotNumber: `${prefix}_LOT_${i}`, heatNumber: `${prefix}_HEAT_${i}` }), 201);
    await ok(`${receiptPath(receipt)}/release`, command({ reason: 'Supplemental incoming inspection' })); await ok(`${receiptPath(receipt)}/putaway`, command({ expectedVersion: 2, location: 'CUSTODY-BIN' })); receipts.push(receipt);
  }
  const plan = command({ expectedVersion: so.version, salesOrderId: so._id, lineIndex: 0, quantities, uom: 'UN', serialized: true, genealogyRequired: true, serialCustodyRequired: true });
  const workOrders = (await ok('/manufacturing/work-orders', plan, 201)).workOrders;
  const routing = { operations: [{ code: 'ASSEMBLE', instruction: 'Supplemental assembly entry' }, { code: 'PACK', instruction: 'Supplemental packing entry' }], materials: receipts.map((r, i) => ({ receiptId: r._id, quantityPerUnit: ratios[i], uom: lines[i].uom })) };
  return { so, account, receipts, workOrders, routing, plan, ratios };
}

test('K2a explicit incoming custody, claims, manual and engineering reserve/consume at ratios1/2', async t => {
  const h = await startOwned(t), data = await setup(h), { receipts, workOrders: wos, routing } = data;
  const post = (path, body, cookie = h.alpha) => h.req(path, body, cookie);
  const receiptView = receipt => h.ok(`${receiptPath(receipt)}/serial-custody`);
  const woView = wo => h.ok(`${woPath(wo)}/serial-claims`);
  const receiptRows = () => h.db.collection('warehouseReceipts').find({ _id: { $in: receipts.map(r => r._id) } }).sort({ _id: 1 }).toArray();
  const originalStock = stocks(await receiptRows());
  const names = ['warehouseReceipts', 'warehouseReservations', 'warehouseMovements', 'warehouseSerials', 'warehouseAudit', 'warehouseOutbox', 'warehouseKeys', 'manufacturingWorkOrders', 'manufacturingMovements', 'manufacturingAudit', 'manufacturingOutbox', 'manufacturingKeys', 'serialCustodyUnits', 'serialCustodyClaims', 'serialCustodyEvents'];
  const snapshot = () => Promise.all(names.map(n => h.db.collection(n).find().sort({ _id: 1 }).toArray()));
  const adopt = async receipt => { const current = await receiptView(receipt), body = command({ expectedVersion: current.receiptVersion, reason: 'Explicit unused received serial adoption' }); return { body, response: await post(`${receiptPath(receipt)}/serial-custody/adopt`, body) }; };
  const claim = async (wo, receipt, selected) => { const current = await woView(wo), source = await receiptView(receipt), body = command({ expectedVersion: current.workOrderVersion, expectedReceiptVersion: source.receiptVersion, receiptId: receipt._id, serialUnitIds: selected, reason: 'Supplemental explicit component claim' }); return { body, response: await post(`${woPath(wo)}/serial-claims`, body) }; };
  const abandon = async (wo, row) => { const current = await woView(wo), body = command({ expectedVersion: current.workOrderVersion, expectedClaimVersion: row.version, claimId: row._id, reason: 'Explicit abandoned supplemental claim' }); return { body, response: await post(`${woPath(wo)}/serial-claims/abandon`, body) }; };
  await t.test('untracked view does not infer availability; adoption rejects forged registry/history and rolls back all authority', async () => {
    const initial = await receiptView(receipts[0]); assert.equal(initial.tracked, false); assert.equal(initial.claimableQuantity, null); assert.deepEqual(initial.units, []); assert.equal(initial.canAdopt, true);
    const before = await snapshot(), registry = await h.db.collection('warehouseSerials').findOne({ receiptId: receipts[0]._id });
    await h.db.collection('warehouseSerials').updateOne({ _id: registry._id }, { $set: { sourceType: 'UNKNOWN_SOURCE' } });
    try { assert.equal((await adopt(receipts[0])).response.error.code, 'SERIAL_CUSTODY_SOURCE_INVALID'); } finally { await h.db.collection('warehouseSerials').replaceOne({ _id: registry._id }, registry); }
    const history = { _id: key(), tenantId: registry.tenantId, plantId: registry.plantId, receiptId: receipts[0]._id, kind: 'TRANSFER' };
    await h.db.collection('warehouseMovements').insertOne(history);
    try { assert.equal((await adopt(receipts[0])).response.error.code, 'SERIAL_CUSTODY_SOURCE_INVALID'); } finally { await h.db.collection('warehouseMovements').deleteOne({ _id: history._id }); }
    assert.deepEqual(await snapshot(), before);
    await h.db.command({ collMod: 'warehouseOutbox', validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
    try { assert.equal((await adopt(receipts[0])).response.status, 500); assert.deepEqual(await snapshot(), before); } finally { await h.db.command({ collMod: 'warehouseOutbox', validator: {} }); }
  });
  const adopted = [];
  await t.test('adoption creates separate identities once, keeps registry and exact stock unchanged, permits idle transfer', async () => {
    for (const receipt of receipts) {
      const result = await adopt(receipt); assert.equal(result.response.status, 200, JSON.stringify(result.response)); adopted.push(result.response.data);
      assert.equal(result.response.data.units.length, Number(result.response.data.quantity)); assert.equal(result.response.data.claimableQuantity, result.response.data.quantity);
      assert.deepEqual((await post(`${receiptPath(receipt)}/serial-custody/adopt`, result.body)).data, result.response.data);
    }
    assert.deepEqual(stocks(await receiptRows()), originalStock);
    const bin = await h.ok('/warehouse/bins', command({ code: 'CUSTODY-IDLE-TRANSFER' }), 201), current = await receiptView(receipts[0]);
    assert.equal((await post(`${receiptPath(receipts[0])}/transfer`, command({ expectedVersion: current.receiptVersion, binId: bin._id, uom: current.uom, reason: 'Whole idle receipt move' }))).status, 200);
    assert.deepEqual(stocks(await receiptRows()), originalStock);
    assert.equal((await post(`${receiptPath(receipts[0])}/count`, command({ expectedVersion: current.receiptVersion + 1, countedQuantity: '6', uom: 'UN', reason: 'Quantity-only count forbidden' }))).error.code, 'SERIAL_CUSTODY_REQUIRED');
    const reserve = command({ expectedVersion: current.receiptVersion + 1, salesOrderId: data.so._id, accountId: data.account._id, lineIndex: 0, quantity: '1', uom: 'UN' });
    assert.equal((await post(`${receiptPath(receipts[0])}/reserve`, reserve)).error.code, 'SERIAL_CUSTODY_REQUIRED');
  });
  let firstClaimBody;
  await t.test('competing WO claims preserve a single owner and abandon frees identities without moving quantity', async () => {
    const unit = (await receiptView(receipts[0])).units[0], a = await woView(wos[3]), b = await woView(wos[4]), source = await receiptView(receipts[0]);
    const bodies = [a, b].map(v => command({ expectedVersion: v.workOrderVersion, expectedReceiptVersion: source.receiptVersion, receiptId: receipts[0]._id, serialUnitIds: [unit._id], reason: 'Concurrent claim of one received identity' }));
    const result = await Promise.all([0, 1].map(i => post(`${woPath(wos[i + 3])}/serial-claims`, bodies[i])));
    assert.deepEqual(result.map(r => r.status).sort(), [200, 409], JSON.stringify(result));
    const winner = result.findIndex(r => r.status === 200), wo = wos[winner + 3], row = result[winner].data.claims[0];
    const heldReceipt = await h.db.collection('warehouseReceipts').findOne({ _id: receipts[0]._id });
    const hold = await h.send(`${receiptPath(receipts[0])}/holds`, { headers: { 'Idempotency-Key': key() }, body: { expectedReceiptVersion: heldReceipt.version, reasonCode: 'QC_SUSPECT', reasonNote: 'Metadata abandon remains permitted' } }); assert.equal(hold.status, 201);
    assert.equal((await abandon(wo, row)).response.status, 200);
    assert.equal((await receiptView(receipts[0])).claimableQuantity, '0');
    assert.equal((await h.send(`/warehouse/holds/${hold.data.hold.id}/release`, { headers: { 'Idempotency-Key': key() }, body: { expectedVersion: hold.data.hold.version, reasonCode: 'INSPECTION_PASSED', reasonNote: 'Source clear after metadata abandon' } })).status, 200);
    assert.deepEqual(stocks(await receiptRows()), originalStock);
    assert.ok((await receiptView(receipts[0])).units.every(u => u.status === 'AVAILABLE'));
    assert.equal((await post(`${receiptPath(receipts[0])}/reserve`, command({ expectedVersion: (await receiptView(receipts[0])).receiptVersion, salesOrderId: data.so._id, accountId: data.account._id, lineIndex: 0, quantity: '1', uom: 'UN' }))).error.code, 'SERIAL_CUSTODY_REQUIRED');
    const before = await snapshot();
    await h.db.command({ collMod: 'manufacturingOutbox', validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
    try { assert.equal((await claim(wos[0], receipts[0], [unit._id])).response.status, 500); assert.deepEqual(await snapshot(), before); } finally { await h.db.command({ collMod: 'manufacturingOutbox', validator: {} }); }
    for (let i = 0; i < receipts.length; i++) {
      const view = await receiptView(receipts[i]), result = await claim(wos[0], receipts[i], view.units.slice(0, i ? 4 : 2).map(u => u._id));
      assert.equal(result.response.status, 200, JSON.stringify(result.response)); if (i === 0) firstClaimBody = result.body;
    }
    assert.deepEqual(stocks(await receiptRows()), originalStock);
    assert.equal((await receiptView(receipts[0])).claimableQuantity, '4'); assert.equal((await receiptView(receipts[0])).quantityAvailable, '6');
    const blockedBin = await h.ok('/warehouse/bins', command({ code: 'CUSTODY-ACTIVE-BLOCKED' }), 201);
    assert.equal((await post(`${receiptPath(receipts[0])}/transfer`, command({ expectedVersion: (await receiptView(receipts[0])).receiptVersion, binId: blockedBin._id, uom: 'UN', reason: 'Active identities cannot move' }))).status, 409);
    const beforeReplay = await snapshot(); assert.equal((await post(`${woPath(wos[0])}/serial-claims`, firstClaimBody)).status, 200); assert.deepEqual(await snapshot(), beforeReplay);
    assert.equal((await post(`${woPath(wos[0])}/serial-claims`, { ...firstClaimBody, reason: 'Changed claim payload' })).error.code, 'IDEMPOTENCY_CONFLICT');
  });
  await t.test('complete manual bindings enforce source sets, integral ratios and active claim authority', async () => {
    const current = await woView(wos[0]), serialClaims = current.claims.map(c => ({ receiptId: c.receiptId, claimId: c._id })), body = command({ expectedVersion: current.workOrderVersion, ...routing, serialClaims });
    const before = await snapshot();
    for (const patch of [{ serialClaims: [] }, { serialClaims: serialClaims.slice(1) }, { serialClaims: [...serialClaims, serialClaims[0]] }, { materials: routing.materials.map((m, i) => i ? m : { ...m, quantityPerUnit: '0.5' }) }, { serialClaims: serialClaims.map((b, i) => i ? b : { ...b, claimId: key() }) }]) assert.ok([400, 409].includes((await post(`${woPath(wos[0])}/release`, { ...body, ...patch, idempotencyKey: key() })).status));
    assert.deepEqual(await snapshot(), before);
    const authorityClaim = await h.db.collection('serialCustodyClaims').findOne({ _id: current.claims[0]._id });
    await h.db.collection('serialCustodyClaims').updateOne({ _id: authorityClaim._id }, { $set: { serials: [...authorityClaim.serials, authorityClaim.serials.at(-1)] } });
    try { assert.equal((await post(`${woPath(wos[0])}/release`, body)).error.code, 'SERIAL_CUSTODY_SOURCE_INVALID'); }
    finally { await h.db.collection('serialCustodyClaims').replaceOne({ _id: authorityClaim._id }, authorityClaim); }
    const receipt = await h.db.collection('warehouseReceipts').findOne({ _id: receipts[0]._id });
    await h.db.collection('warehouseReceipts').updateOne({ _id: receipt._id }, { $set: { hold: { active: false } } });
    try { assert.equal((await post(`${woPath(wos[0])}/release`, body)).error.code, 'STOCK_ENCUMBERED'); assert.equal((await receiptView(receipts[0])).claimableQuantity, '0'); } finally { await h.db.collection('warehouseReceipts').replaceOne({ _id: receipt._id }, receipt); }
    const released = await h.ok(`${woPath(wos[0])}/release`, body); assert.equal(released.status, 'RELEASED');
    assert.deepEqual(released.routing.materials.map(m => m.serialCustody.serials.length), [2, 4]);
    for (const material of released.routing.materials) { const move = await h.db.collection('manufacturingMovements').findOne({ workOrderId: wos[0]._id, receiptId: material.receiptId, kind: 'MATERIAL_RESERVED' }); assert.deepEqual(move.serialCustody, material.serialCustody); }
    const after = await woView(wos[0]); assert.ok(after.claims.every(c => c.status === 'RESERVED'));
    assert.equal((await abandon(wos[0], after.claims[0])).response.error.code, 'SERIAL_CUSTODY_STATE_CONFLICT');
  });
  await t.test('engineering release binds the same claims without rewriting approved engineering content', async () => {
    for (let i = 0; i < receipts.length; i++) { const available = (await receiptView(receipts[i])).units.filter(u => u.status === 'AVAILABLE'); assert.equal((await claim(wos[1], receipts[i], available.slice(0, i ? 2 : 1).map(u => u._id))).response.status, 200); }
    const engineering = await h.ok('/manufacturing/engineering', command({ salesOrderId: data.so._id, salesOrderVersion: data.so.version, lineIndex: 0, uom: 'UN', ...routing }), 201);
    await h.ok(`/manufacturing/engineering/${engineering._id}/release`, command({ revision: 1 }));
    const rev = await h.ok(`/manufacturing/engineering/${engineering._id}/revisions/1`), current = await woView(wos[1]);
    const released = await h.ok(`${woPath(wos[1])}/release-engineering`, command({ expectedVersion: current.workOrderVersion, engineeringId: engineering._id, engineeringVersion: 2, revision: 1, serialClaims: current.claims.map(c => ({ receiptId: c.receiptId, claimId: c._id })) }));
    assert.equal(released.status, 'RELEASED'); assert.deepEqual(released.routing.materials.map(m => m.serialCustody.serials.length), [1, 2]); assert.deepEqual(await h.ok(`/manufacturing/engineering/${engineering._id}/revisions/1`), rev);
  });
  await t.test('claim replay and fresh mutations recheck committing grants; scoped events remain paginated', async () => {
    const reader = await h.setRoles(h.seeded[0], ['custodyReader']);
    try { assert.equal((await post(`${woPath(wos[0])}/serial-claims`, firstClaimBody)).status, 403); assert.equal((await post(`${woPath(wos[0])}/serial-claims`, { ...firstClaimBody, idempotencyKey: key() })).status, 403); assert.equal((await woView(wos[0])).required, true); } finally { await reader(); }
    assert.equal((await post(`${receiptPath(receipts[0])}/serial-custody`, undefined, h.beta)).status, 404); assert.equal((await post(`${woPath(wos[0])}/serial-claims`, undefined, h.beta)).status, 404);
    const member = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId }), foundation = h.runtime.foundation;
    for (const body of [firstClaimBody, { ...firstClaimBody, idempotencyKey: key() }]) {
      const before = await snapshot(); h.runtime.foundation = { ...foundation, authorize: async (...args) => { const allowed = await foundation.authorize(...args); await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role: 'custodyReader', plantIds: member.plantIds }] } }); return allowed; } };
      try { assert.equal((await post(`${woPath(wos[0])}/serial-claims`, body)).status, 403); } finally { h.runtime.foundation = foundation; await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
      assert.deepEqual(await snapshot(), before);
    }
    let cursor, rows = [];
    do { const page = await post(`${receiptPath(receipts[0])}/serial-custody/events?limit=2${cursor ? `&cursor=${cursor}` : ''}`); assert.equal(page.status, 200); rows.push(...page.data); cursor = page.page.nextCursor; } while (cursor);
    assert.equal(new Set(rows.map(r => r._id)).size, rows.length); assert.ok(rows.some(r => r.kind === 'ABANDONED')); assert.ok(rows.some(r => r.kind === 'RESERVED'));
  });
  await t.test('first operation consumes exact claimed identities once, including all-scrap, and later operations do not consume', async () => {
    const beforeWo = await h.ok(woPath(wos[0])), reserveMove = await h.db.collection('manufacturingMovements').findOne({ workOrderId: wos[0]._id, receiptId: receipts[0]._id, kind: 'MATERIAL_RESERVED' });
    await h.db.collection('manufacturingMovements').updateOne({ _id: reserveMove._id }, { $set: { quantityPerUnit: '9' } });
    try { assert.equal((await post(`${woPath(beforeWo)}/record`, command({ expectedVersion: beforeWo.version, operationIndex: 0, inputQuantity: beforeWo.quantity, goodQuantity: beforeWo.quantity, scrapQuantity: '0', uom: 'UN', evidence: 'Reject changed reservation ratio' }))).error.code, 'SERIAL_CUSTODY_SOURCE_INVALID'); }
    finally { await h.db.collection('manufacturingMovements').replaceOne({ _id: reserveMove._id }, reserveMove); }
    const heldReceipt = await h.db.collection('warehouseReceipts').findOne({ _id: receipts[0]._id });
    const hold = await h.send(`${receiptPath(receipts[0])}/holds`, { headers: { 'Idempotency-Key': key() }, body: { expectedReceiptVersion: heldReceipt.version, reasonCode: 'QC_SUSPECT', reasonNote: 'Later source quality hold' } }); assert.equal(hold.status, 201, JSON.stringify(hold));
    const wo = await h.ok(woPath(wos[0])), blocked = command({ expectedVersion: wo.version, operationIndex: 0, inputQuantity: wo.quantity, goodQuantity: wo.quantity, scrapQuantity: '0', uom: 'UN', evidence: 'Held first operation must fail' });
    const beforeHeldAttempt = await snapshot();
    assert.equal((await post(`${woPath(wo)}/record`, blocked)).error.code, 'STOCK_ENCUMBERED'); assert.deepEqual(await snapshot(), beforeHeldAttempt);
    const releasedHold = await h.send(`/warehouse/holds/${hold.data.hold.id}/release`, { headers: { 'Idempotency-Key': key() }, body: { expectedVersion: hold.data.hold.version, reasonCode: 'INSPECTION_PASSED', reasonNote: 'Inspected source released' } }); assert.equal(releasedHold.status, 200);
    const beforeConsumption = await snapshot();
    await h.db.command({ collMod: 'manufacturingOutbox', validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
    try { assert.equal((await post(`${woPath(wo)}/record`, blocked)).status, 500); assert.deepEqual(await snapshot(), beforeConsumption); } finally { await h.db.command({ collMod: 'manufacturingOutbox', validator: {} }); }
    for (let i = 0; i < 2; i++) {
      const wo = await h.ok(woPath(wos[i])), good = i ? '0' : wo.quantity, body = command({ expectedVersion: wo.version, operationIndex: 0, inputQuantity: wo.quantity, goodQuantity: good, scrapQuantity: i ? wo.quantity : '0', uom: 'UN', evidence: 'Supplemental first operation' });
      const first = await h.ok(`${woPath(wo)}/record`, body); assert.deepEqual((await post(`${woPath(wo)}/record`, body)).data, first);
      const current = await woView(wo); assert.ok(current.claims.every(c => c.status === 'CONSUMED'));
      await h.ok(`${woPath(wo)}/record`, command({ expectedVersion: first.version, operationIndex: 1, inputQuantity: good, goodQuantity: good, scrapQuantity: '0', uom: 'UN', evidence: 'Supplemental final operation', outputSerials: Array.from({ length: Number(good) }, (_, j) => `SUPPLEMENTAL_OUTPUT_${i}_${j}`) }));
      assert.equal(await h.db.collection('manufacturingMovements').countDocuments({ workOrderId: wo._id, kind: 'MATERIAL_CONSUMED' }), 2);
    }
    const r = await receiptRows(); assert.deepEqual(r.map(row => row.manufacturingConsumedQuantity).sort(), ['3', '6']);
    assert.equal(await h.db.collection('serialCustodyUnits').countDocuments({ status: 'CONSUMED' }), 9);
    assert.equal((await h.ok(`${woPath(wos[1])}/output-units`)).length, 0);
  });
});

test('K2a adoption versus quantity use and permanent legacy fences are safely ordered', async t => {
  const h = await startOwned(t), data = await setup(h, { quantities: ['1', '1'], ratios: ['1'] }), receipt = data.receipts[0], current = await h.ok(receiptPath(receipt));
  const adopt = command({ expectedVersion: current.version, reason: 'Concurrent adoption' }), reserve = command({ expectedVersion: current.version, salesOrderId: data.so._id, accountId: data.account._id, lineIndex: 0, quantity: '1', uom: 'UN' });
  const raced = await Promise.all([h.req(`${receiptPath(receipt)}/serial-custody/adopt`, adopt, h.alpha), h.req(`${receiptPath(receipt)}/reserve`, reserve, h.alpha)]);
  assert.deepEqual(raced.map(r => r.status).sort(), [200, 409]);
  const view = await h.ok(`${receiptPath(receipt)}/serial-custody`);
  if (view.tracked) {
    assert.equal(await h.db.collection('warehouseReservations').countDocuments({ receiptId: receipt._id }), 0);
    const legacyWo = await h.db.collection('manufacturingWorkOrders').findOne({ _id: data.workOrders[0]._id });
    await h.db.collection('manufacturingWorkOrders').updateOne({ _id: legacyWo._id }, { $unset: { serialCustodyRequired: '' } });
    try { const denied = await h.req(`${woPath(legacyWo)}/release`, command({ expectedVersion: legacyWo.version, ...data.routing }), h.alpha); assert.equal(denied.error.code, 'SERIAL_CUSTODY_REQUIRED'); } finally { await h.db.collection('manufacturingWorkOrders').replaceOne({ _id: legacyWo._id }, legacyWo); }
  } else {
    assert.ok(view.adoptionBlockers.includes('STOCK_USED')); assert.equal(await h.db.collection('serialCustodyUnits').countDocuments({ receiptId: receipt._id }), 0);
  }
});
