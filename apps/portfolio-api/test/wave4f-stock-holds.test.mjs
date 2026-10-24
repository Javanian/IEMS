import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned, orderWithStock } from './support/owned-mongo.mjs';

// Wave 4f stock hold lifecycle on a real owned replica set through the mounted HTTP API.
const key = () => randomUUID();
const apply = (receipt, extra = {}) => ({ reasonCode: 'QC_SUSPECT', reasonNote: 'Synthetic inspection finding', expectedReceiptVersion: receipt.version, ...extra });
const release = (hold, extra = {}) => ({ reasonCode: 'INSPECTION_PASSED', reasonNote: 'Synthetic re-inspection passed', expectedVersion: hold.version, ...extra });

test('wave4f stock hold lifecycle, separation of duties and eligibility on owned real Mongo HTTP', { timeout: 900000 }, async t => {
  const h = await startOwned(t), { db, ok, alpha, beta, seeded, send } = h;
  const users = Object.fromEntries(seeded.map(s => [s.username, s]));
  assert.deepEqual(Object.keys(users).sort(), ['alpha.inspector', 'alpha.owner', 'alpha.quality', 'alpha.viewer', 'beta.owner']);
  const inspector = await h.login('alpha.inspector'), quality = await h.login('alpha.quality'), viewer = await h.login('alpha.viewer');
  const post = (path, body, cookie = alpha, k = key()) => send(path, { body, cookie, headers: k === null ? {} : { 'idempotency-key': k } });
  const get = (path, cookie = alpha) => send(path, { cookie });
  const receiptOf = id => db.collection('warehouseReceipts').findOne({ _id: id });
  const names = ['stockHolds', 'stockHoldKeys', 'warehouseReceipts', 'warehouseReservations', 'warehouseMovements', 'warehouseAudit', 'warehouseOutbox', 'manufacturingWorkOrders', 'manufacturingMovements', 'fulfillmentShipments'];
  const snapshot = () => Promise.all(names.map(n => db.collection(n).find().sort({ _id: 1 }).toArray()));
  const authorityMatchesCache = async receiptId => {
    const r = await receiptOf(receiptId);
    const active = (await db.collection('stockHolds').find({ receiptId, status: 'ACTIVE' }).toArray()).map(x => x._id).sort();
    assert.deepEqual([...(r.hold?.activeHoldIds || [])].sort(), active, 'receipt cache must equal stockHolds authority');
    assert.equal(r.hold?.active === true, active.length > 0);
  };
  const reconcile = async receiptId => {
    const rec = await ok(`/warehouse/receipts/${receiptId}/reconciliation`);
    assert.equal(rec.matches, true, JSON.stringify(rec));
    return rec;
  };

  await t.test('seeded synthetic role users sign in with exactly their separated permissions', async () => {
    const perms = async cookie => (await get('/session/me', cookie)).data.permissions;
    assert.deepEqual(await perms(inspector), ['warehouse.hold.apply', 'warehouse.read']);
    assert.deepEqual(await perms(quality), ['warehouse.hold.apply', 'warehouse.hold.release', 'warehouse.read']);
    assert.deepEqual(await perms(viewer), ['warehouse.read']);
    const owner = await perms(alpha);
    for (const action of ['warehouse.hold.apply', 'warehouse.hold.release', 'warehouse.release']) assert.ok(owner.includes(action), action);
    for (const u of ['alpha.inspector', 'alpha.quality', 'alpha.viewer']) assert.deepEqual([users[u].tenantId, users[u].plantId], [users['alpha.owner'].tenantId, users['alpha.owner'].plantId]);
  });

  await t.test('apply, replay, conflict, release and multi-hold lifecycle with audit and outbox', async () => {
    const f = await orderWithStock(h, { reserve: null });
    let receipt = await receiptOf(f.receipt._id);
    const view = await get(`/warehouse/receipts/${receipt._id}/holds`);
    assert.equal(view.status, 200);
    assert.deepEqual([view.data.receipt.hold, view.data.holds, view.data.impacts, view.data.eligible], [{ active: false, activeHoldIds: [], version: 0 }, [], { reservations: [], workOrders: [] }, true]);
    assert.equal(view.data.receipt.materialCode, 'Synthetic shipped item');

    // Validation, partial scope and missing idempotency key are rejected without effects.
    const before = await snapshot();
    assert.equal((await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt, { quantity: '1' }), inspector)).error.code, 'HOLD_PARTIAL_UNSUPPORTED');
    assert.equal((await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt, { quantity: '1' }), inspector)).status, 422);
    assert.equal((await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt, { serials: ['S1'] }), inspector)).status, 422);
    for (const bad of [apply(receipt, { reasonCode: 'NOPE' }), apply(receipt, { reasonNote: 'x' }), apply(receipt, { expectedReceiptVersion: 0 }), apply(receipt, { extra: true })]) {
      const r = await post(`/warehouse/receipts/${receipt._id}/holds`, bad, inspector);
      assert.deepEqual([r.status, r.error.code], [400, 'VALIDATION'], JSON.stringify(r));
    }
    assert.deepEqual([(await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt), inspector, null)).error.code], ['VALIDATION']);
    assert.equal((await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt, { expectedReceiptVersion: receipt.version + 5 }), inspector)).error.currentVersion, receipt.version);
    assert.equal((await post(`/warehouse/receipts/${randomUUID()}/holds`, apply(receipt), inspector)).status, 404);
    assert.deepEqual(await snapshot(), before);

    const k1 = key();
    const first = await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt), inspector, k1);
    assert.equal(first.status, 201, JSON.stringify(first));
    const hold1 = first.data.hold;
    assert.deepEqual([hold1.status, hold1.reasonCode, hold1.reasonNote, hold1.version, hold1.receiptId, hold1.appliedBy], ['ACTIVE', 'QC_SUSPECT', 'Synthetic inspection finding', 1, receipt._id, { userId: users['alpha.inspector'].userId, displayName: 'alpha.inspector' }]);
    assert.deepEqual(first.data.receipt.hold, { active: true, activeHoldIds: [hold1.id], version: 1 });
    assert.equal(first.data.receipt.version, receipt.version + 1);
    const audit = await db.collection('warehouseAudit').find({ subjectId: hold1.id }).toArray(), outbox = await db.collection('warehouseOutbox').find({ subjectId: hold1.id }).toArray();
    assert.deepEqual([audit.length, audit[0].kind, outbox.length, outbox[0].kind, outbox[0].type, outbox[0].state, outbox[0].receiptId], [1, 'stock.hold.applied', 1, 'stock.hold.applied', 'stock.hold.applied.v1', 'PENDING', receipt._id]);
    await authorityMatchesCache(receipt._id);

    // Same key + same request replays the stored response without writes; different request is refused.
    const settled = await snapshot();
    const replay = await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt), inspector, k1);
    assert.deepEqual([replay.status, replay.data], [201, first.data]);
    assert.deepEqual(await snapshot(), settled);
    assert.deepEqual([(await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt, { reasonNote: 'Different note' }), inspector, k1)).error.code], ['IDEMPOTENCY_KEY_REUSED']);
    // Stale receipt version after the hold changed it.
    const stale = await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt), inspector);
    assert.deepEqual([stale.status, stale.error.code, stale.error.currentVersion], [409, 'VERSION_CONFLICT', receipt.version + 1]);
    assert.deepEqual(await snapshot(), settled);

    // Separation of duties: inspector and viewer cannot release; viewer cannot apply; QC release role cannot release holds.
    assert.deepEqual([(await post(`/warehouse/holds/${hold1.id}/release`, release(hold1), inspector)).status, (await post(`/warehouse/holds/${hold1.id}/release`, release(hold1), inspector)).error.code], [403, 'FORBIDDEN']);
    assert.equal((await post(`/warehouse/holds/${hold1.id}/release`, release(hold1), viewer)).status, 403);
    receipt = await receiptOf(receipt._id);
    assert.equal((await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt), viewer)).status, 403);
    const restore = await h.setRoles(users['alpha.owner'], ['warehouseRelease']);
    try { assert.equal((await post(`/warehouse/holds/${hold1.id}/release`, release(hold1), alpha)).status, 403); } finally { await restore(); }
    assert.equal((await get(`/warehouse/receipts/${receipt._id}/holds`, viewer)).status, 200);
    assert.deepEqual(await snapshot(), settled);

    // Second hold by quality; releasing the first leaves the second active and stock blocked.
    const second = await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt, { reasonCode: 'DAMAGED', reasonNote: 'Synthetic crushed carton' }), quality);
    assert.equal(second.status, 201, JSON.stringify(second));
    const hold2 = second.data.hold;
    assert.deepEqual(second.data.receipt.hold, { active: true, activeHoldIds: [hold1.id, hold2.id], version: 2 });
    const rk = key();
    const released = await post(`/warehouse/holds/${hold1.id}/release`, release(hold1), quality, rk);
    assert.equal(released.status, 200, JSON.stringify(released));
    assert.deepEqual([released.data.hold.status, released.data.hold.version, released.data.hold.releaseReasonCode, released.data.hold.releasedBy.displayName], ['RELEASED', 2, 'INSPECTION_PASSED', 'alpha.quality']);
    assert.deepEqual(released.data.receipt.hold, { active: true, activeHoldIds: [hold2.id], version: 3 });
    await authorityMatchesCache(receipt._id);
    const afterRelease = await snapshot();
    assert.deepEqual((await post(`/warehouse/holds/${hold1.id}/release`, release(hold1), quality, rk)).data, released.data);
    assert.deepEqual(await snapshot(), afterRelease);
    assert.deepEqual([(await post(`/warehouse/holds/${hold1.id}/release`, release(hold1), quality)).error.code], ['HOLD_NOT_ACTIVE']);
    assert.deepEqual([(await post(`/warehouse/holds/${hold2.id}/release`, release(hold2, { expectedVersion: 2 }), quality)).error.code, (await post(`/warehouse/holds/${hold2.id}/release`, release(hold2, { expectedVersion: 2 }), quality)).error.currentVersion], ['VERSION_CONFLICT', 1]);
    assert.deepEqual([(await post(`/warehouse/holds/${hold2.id}/release`, release(hold2, { reasonCode: 'BAD' }), quality)).error.code], ['VALIDATION']);
    assert.deepEqual([(await post(`/warehouse/holds/${hold2.id}/release`, release(hold2, { quantity: '1' }), quality)).status], [422]);
    assert.deepEqual(await snapshot(), afterRelease);
    receipt = await receiptOf(receipt._id);
    const bin = await ok('/warehouse/bins', { expectedVersion: 1, idempotencyKey: key(), code: `HOLD-${randomUUID().slice(0, 8)}` }, 201);
    assert.equal((await h.req(`/warehouse/receipts/${receipt._id}/transfer`, { expectedVersion: receipt.version, idempotencyKey: key(), binId: bin._id, uom: 'KG', reason: 'Blocked by remaining hold' }, alpha)).error.code, 'STOCK_ENCUMBERED');
    const done = await post(`/warehouse/holds/${hold2.id}/release`, release(hold2, { reasonCode: 'DISPOSITION_ACCEPTED' }), alpha);
    assert.deepEqual(done.data.receipt.hold, { active: false, activeHoldIds: [], version: 4 });
    receipt = await receiptOf(receipt._id);
    await ok(`/warehouse/receipts/${receipt._id}/transfer`, { expectedVersion: receipt.version, idempotencyKey: key(), binId: bin._id, uom: 'KG', reason: 'Released stock moves again' });
    await reconcile(receipt._id);
    assert.equal(await db.collection('warehouseAudit').countDocuments({ receiptId: receipt._id, kind: { $in: ['stock.hold.applied', 'stock.hold.released'] } }), 4);
    assert.equal(await db.collection('warehouseOutbox').countDocuments({ receiptId: receipt._id, kind: { $in: ['stock.hold.applied', 'stock.hold.released'] } }), 4);

    // List with filters and cursor pagination.
    const all = []; let cursor;
    do { const page = await get(`/warehouse/holds?status=ALL&receiptId=${receipt._id}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, viewer); assert.equal(page.status, 200, JSON.stringify(page)); all.push(...page.data.items); cursor = page.data.nextCursor; } while (cursor);
    assert.deepEqual(all.map(x => x.id).sort(), [hold1.id, hold2.id].sort());
    assert.deepEqual((await get(`/warehouse/holds?status=ACTIVE&receiptId=${receipt._id}`)).data.items, []);
    assert.equal((await get(`/warehouse/holds?status=RELEASED&receiptId=${receipt._id}`)).data.items.length, 2);
    for (const q of ['status=BAD', 'limit=0', 'limit=101', 'cursor=bad', 'other=1', 'receiptId=nope']) assert.deepEqual([(await get(`/warehouse/holds?${q}`)).status], [400], q);
  });

  await t.test('cross-tenant and cross-plant requests are non-disclosing or denied', async () => {
    const f = await orderWithStock(h, { reserve: null });
    const receipt = await receiptOf(f.receipt._id);
    const applied = (await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt), alpha)).data;
    const before = await snapshot();
    assert.equal((await get(`/warehouse/receipts/${receipt._id}/holds`, beta)).status, 404);
    assert.deepEqual((await get('/warehouse/holds?status=ALL', beta)).data.items, []);
    assert.equal((await post(`/warehouse/receipts/${receipt._id}/holds`, apply(await receiptOf(receipt._id)), beta)).status, 404);
    assert.equal((await post(`/warehouse/holds/${applied.hold.id}/release`, release(applied.hold), beta)).status, 404);
    assert.equal((await post(`/warehouse/holds/${applied.hold.id}/release`, release(applied.hold, { tenant_id: users['beta.owner'].tenantId }), alpha)).status, 403);
    assert.equal((await post(`/warehouse/receipts/${receipt._id}/holds`, apply(await receiptOf(receipt._id), { plantId: users['beta.owner'].plantId }), alpha)).status, 403);
    assert.equal((await get(`/warehouse/holds?plant_id=${users['beta.owner'].plantId}`)).status, 403);
    assert.equal((await send('/warehouse/holds', { cookie: null })).status, 401);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('legacy representations stay fail-closed and are refused by hold commands', async () => {
    for (const patch of [{ held: true }, { heldQuantity: '0.5' }, { hold: { active: true } }, { heldQuantity: 3 }]) {
      const f = await orderWithStock(h, { reserve: null });
      await db.collection('warehouseReceipts').updateOne({ _id: f.receipt._id }, { $set: patch });
      const receipt = await receiptOf(f.receipt._id);
      const before = await snapshot();
      const r = await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt), alpha);
      assert.deepEqual([r.status, r.error.code], [409, 'HOLD_LEGACY_REPRESENTATION'], JSON.stringify(patch));
      const reserve = await h.req(`/warehouse/receipts/${receipt._id}/reserve`, { expectedVersion: receipt.version, salesOrderId: f.so._id, accountId: f.account._id, lineIndex: 0, quantity: '0.1', uom: 'KG', idempotencyKey: key() }, alpha);
      assert.equal(reserve.status, 409, JSON.stringify(reserve));
      const view = (await get(`/warehouse/receipts/${receipt._id}/holds`)).data;
      assert.equal(view.eligible, false);
      assert.ok(view.receipt.legacyHoldRepresentation.length > 0);
      assert.deepEqual(await snapshot(), before);
    }
  });

  await t.test('QC receipt release and stock-hold release are independent', async () => {
    const f = await orderWithStock(h, { reserve: null });
    // A fresh quarantined receipt from the same PO line.
    const po = await db.collection('purchaseOrders').findOne({ _id: f.receipt.purchaseOrderId });
    const q = await db.collection('warehouseReceipts').findOne({ _id: f.receipt._id });
    assert.equal(q.status, 'STORED');
    await db.collection('purchaseOrders').updateOne({ _id: po._id }, { $set: { 'snapshot.lines.0.quantity': '10' } });
    const fresh = await ok('/warehouse/receipts', { purchaseOrderId: po._id, expectedVersion: po.version, vendorId: po.vendorId, lineIndex: 0, quantity: '2', uom: 'KG', idempotencyKey: key() }, 201);
    const held = (await post(`/warehouse/receipts/${fresh._id}/holds`, apply(fresh), inspector)).data;
    assert.equal(held.receipt.status, 'QUARANTINED');
    // QC approval does not clear the hold; the hold release does not QC-approve.
    const qc = await ok(`/warehouse/receipts/${fresh._id}/release`, { expectedVersion: held.receipt.version, reason: 'QC passed', idempotencyKey: key() });
    assert.deepEqual([qc.status, qc.hold.active, qc.hold.activeHoldIds], ['RELEASED', true, [held.hold.id]]);
    const stored = await ok(`/warehouse/receipts/${fresh._id}/putaway`, { expectedVersion: qc.version, location: 'QC-BIN', idempotencyKey: key() });
    assert.equal((await h.req(`/warehouse/receipts/${fresh._id}/reserve`, { expectedVersion: stored.version, salesOrderId: f.so._id, accountId: f.account._id, lineIndex: 0, quantity: '0.1', uom: 'KG', idempotencyKey: key() }, alpha)).error.code, 'STOCK_ENCUMBERED');
    const quarantined = await ok('/warehouse/receipts', { purchaseOrderId: po._id, expectedVersion: po.version, vendorId: po.vendorId, lineIndex: 0, quantity: '1', uom: 'KG', idempotencyKey: key() }, 201);
    const h2 = (await post(`/warehouse/receipts/${quarantined._id}/holds`, apply(quarantined), quality)).data;
    const freed = (await post(`/warehouse/holds/${h2.hold.id}/release`, release(h2.hold), quality)).data;
    assert.deepEqual([freed.receipt.status, freed.receipt.hold.active], ['QUARANTINED', false]);
    assert.equal((await h.req(`/warehouse/receipts/${quarantined._id}/release`, { expectedVersion: freed.receipt.version, reason: 'Quality cannot QC', idempotencyKey: key() }, quality)).status, 403);
  });

  await t.test('hold after reservation keeps reservations and WO snapshots, reports impacts and blocks consume and ship', async () => {
    const f = await orderWithStock(h, { orderQuantity: '3', receiptQuantity: '10', reserve: '1' });
    const plan = await ok('/manufacturing/work-orders', { salesOrderId: f.so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', quantities: ['1'], idempotencyKey: key() }, 201);
    const wo = plan.workOrders[0], path = `/manufacturing/work-orders/${wo._id}`;
    const releasedWo = await ok(`${path}/release`, { expectedVersion: 1, operations: [{ code: 'MAKE', instruction: 'Synthetic make' }], materials: [{ receiptId: f.receipt._id, quantityPerUnit: '2', uom: 'KG' }], idempotencyKey: key() });
    assert.deepEqual((await ok(`${path}?include=stockExceptions`)).stockExceptions, []);
    const reservationBefore = await db.collection('warehouseReservations').findOne({ _id: f.reservation._id }), woBefore = await db.collection('manufacturingWorkOrders').findOne({ _id: wo._id });
    const receipt = await receiptOf(f.receipt._id);
    const held = (await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt, { reasonCode: 'CUSTOMER_COMPLAINT', reasonNote: 'Synthetic complaint on lot' }), inspector)).data;
    assert.deepEqual(await db.collection('warehouseReservations').findOne({ _id: f.reservation._id }), reservationBefore);
    assert.deepEqual(await db.collection('manufacturingWorkOrders').findOne({ _id: wo._id }), woBefore);
    assert.deepEqual(await ok(path), releasedWo, 'plain WO read is unchanged and byte-comparable');
    const detail = await ok(`${path}?include=stockExceptions`);
    assert.deepEqual(detail.stockExceptions, [{ holdId: held.hold.id, receiptId: receipt._id, materialCode: 'Synthetic shipped item', reasonCode: 'CUSTOMER_COMPLAINT', since: held.hold.appliedAt }]);
    assert.equal((await get(`${path}?include=other`)).status, 400);
    const view = (await get(`/warehouse/receipts/${receipt._id}/holds`, viewer)).data;
    const mfgMove = await db.collection('manufacturingMovements').findOne({ workOrderId: wo._id, kind: 'MATERIAL_RESERVED' });
    assert.deepEqual(view.impacts, {
      reservations: [{ kind: 'SALES', id: f.reservation._id, quantity: '1', salesOrderId: f.so._id, state: 'BLOCKED_BY_HOLD' }, { kind: 'MANUFACTURING', id: mfgMove._id, quantity: '2', workOrderId: wo._id, salesOrderId: f.so._id, state: 'BLOCKED_BY_HOLD' }],
      workOrders: [{ id: wo._id, number: `WO-${wo._id.replaceAll('-', '').slice(0, 10).toUpperCase()}`, status: 'RELEASED', stockException: 'BLOCKED_BY_HOLD' }],
    });
    const record = { expectedVersion: 2, operationIndex: 0, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', uom: 'KG', evidence: 'Synthetic record', idempotencyKey: key() };
    const ship = { salesOrderId: f.so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', reference: 'SYN-HOLD-DN', sources: [{ sourceType: 'RESERVATION', sourceId: f.reservation._id, quantity: '0.5' }], idempotencyKey: key() };
    const before = await snapshot();
    for (const [p, b] of [[`${path}/record`, record], ['/fulfillment/shipments', ship]]) assert.deepEqual([(await h.req(p, b, alpha)).error?.code], ['STOCK_ENCUMBERED'], p);
    assert.deepEqual(await snapshot(), before);
    await post(`/warehouse/holds/${held.hold.id}/release`, release(held.hold), quality);
    await ok(`${path}/record`, record);
    await ok('/fulfillment/shipments', ship, 201);
    const rec = await reconcile(receipt._id);
    assert.deepEqual([rec.replayed.manufacturingConsumedQuantity, rec.replayed.shippedQuantity, rec.replayed.reservedQuantity, rec.replayed.availableQuantity], ['2', '0.5', '0.5', '7']);
    assert.equal((await ok(`/fulfillment/orders/${f.so._id}/reconciliation`)).matches, true);
  });

  await t.test('audit, outbox, key or hold write failure rolls back the whole hold command', async () => {
    const f = await orderWithStock(h, { reserve: null });
    let receipt = await receiptOf(f.receipt._id);
    for (const collection of ['warehouseAudit', 'warehouseOutbox', 'stockHoldKeys', 'stockHolds']) {
      const before = await snapshot();
      await db.command({ collMod: collection, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
      try {
        const k = key(), r = await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt), alpha, k);
        assert.equal(r.status, 500, `${collection} ${JSON.stringify(r)}`);
        assert.deepEqual(await snapshot(), before);
      } finally { await db.command({ collMod: collection, validator: {} }); }
    }
    const held = (await post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt), alpha)).data;
    for (const collection of ['warehouseAudit', 'warehouseOutbox', 'stockHoldKeys', 'stockHolds', 'warehouseReceipts']) {
      const before = await snapshot();
      await db.command({ collMod: collection, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
      try {
        assert.equal((await post(`/warehouse/holds/${held.hold.id}/release`, release(held.hold), alpha)).status, 500, collection);
        assert.deepEqual(await snapshot(), before);
      } finally { await db.command({ collMod: collection, validator: {} }); }
    }
    await authorityMatchesCache(receipt._id);
    receipt = await receiptOf(receipt._id);
    assert.equal(receipt.hold.active, true);
  });

  await t.test('same-key concurrent applies commit one hold and replay the rest', async () => {
    const f = await orderWithStock(h, { reserve: null });
    const receipt = await receiptOf(f.receipt._id), k = key();
    const results = await Promise.all([1, 2, 3].map(() => post(`/warehouse/receipts/${receipt._id}/holds`, apply(receipt), alpha, k)));
    assert.deepEqual(results.map(r => r.status), [201, 201, 201], JSON.stringify(results));
    assert.deepEqual(results[0].data, results[1].data); assert.deepEqual(results[1].data, results[2].data);
    assert.equal(await db.collection('stockHolds').countDocuments({ receiptId: receipt._id }), 1);
    assert.equal(await db.collection('warehouseOutbox').countDocuments({ receiptId: receipt._id, kind: 'stock.hold.applied' }), 1);
    await authorityMatchesCache(receipt._id);
  });

  // Contended writes on the same real receipt document; each pair runs concurrently over HTTP.
  const mutations = {
    'sales reserve': async () => { const f = await orderWithStock(h, { orderQuantity: '3', receiptQuantity: '10', reserve: null }); return { f, run: async r => h.req(`/warehouse/receipts/${r._id}/reserve`, { expectedVersion: r.version, salesOrderId: f.so._id, accountId: f.account._id, lineIndex: 0, quantity: '1', uom: 'KG', idempotencyKey: key() }, alpha), effect: 'RESERVE' }; },
    'manufacturing reserve': async () => {
      const f = await orderWithStock(h, { orderQuantity: '3', receiptQuantity: '10', reserve: null });
      const wo = (await ok('/manufacturing/work-orders', { salesOrderId: f.so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', quantities: ['1'], idempotencyKey: key() }, 201)).workOrders[0];
      return { f, run: async () => h.req(`/manufacturing/work-orders/${wo._id}/release`, { expectedVersion: 1, operations: [{ code: 'MAKE', instruction: 'Race' }], materials: [{ receiptId: f.receipt._id, quantityPerUnit: '2', uom: 'KG' }], idempotencyKey: key() }, alpha), effect: 'MATERIAL_RESERVED', wo };
    },
    'engineering release reserve': async () => {
      const f = await orderWithStock(h, { orderQuantity: '3', receiptQuantity: '10', reserve: null });
      const command = extra => ({ expectedVersion: 1, idempotencyKey: key(), ...extra });
      let engineering = await ok('/manufacturing/engineering', command({ salesOrderId: f.so._id, salesOrderVersion: f.so.version, lineIndex: 0, uom: 'KG', operations: [{ code: 'MAKE', instruction: 'Engineering hold race' }], materials: [{ receiptId: f.receipt._id, quantityPerUnit: '2', uom: 'KG' }] }), 201);
      engineering = await ok(`/manufacturing/engineering/${engineering._id}/release`, command({ revision: 1 }));
      const wo = (await ok('/manufacturing/work-orders', command({ salesOrderId: f.so._id, lineIndex: 0, uom: 'KG', quantities: ['1'] }), 201)).workOrders[0];
      return { f, run: async () => h.req(`/manufacturing/work-orders/${wo._id}/release-engineering`, command({ engineeringId: engineering._id, engineeringVersion: engineering.version, revision: 1 }), alpha), effect: 'MATERIAL_RESERVED', wo };
    },
    'first consumption': async () => {
      const f = await orderWithStock(h, { orderQuantity: '3', receiptQuantity: '10', reserve: null });
      const wo = (await ok('/manufacturing/work-orders', { salesOrderId: f.so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', quantities: ['1'], idempotencyKey: key() }, 201)).workOrders[0];
      await ok(`/manufacturing/work-orders/${wo._id}/release`, { expectedVersion: 1, operations: [{ code: 'MAKE', instruction: 'Race' }], materials: [{ receiptId: f.receipt._id, quantityPerUnit: '2', uom: 'KG' }], idempotencyKey: key() });
      return { f, run: async () => h.req(`/manufacturing/work-orders/${wo._id}/record`, { expectedVersion: 2, operationIndex: 0, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', uom: 'KG', evidence: 'Race', idempotencyKey: key() }, alpha), effect: 'MATERIAL_CONSUMED', wo };
    },
    'WMS transfer': async () => {
      const f = await orderWithStock(h, { reserve: null });
      const bin = await ok('/warehouse/bins', { expectedVersion: 1, idempotencyKey: key(), code: `RACE-${randomUUID().slice(0, 8)}` }, 201);
      return { f, run: async r => h.req(`/warehouse/receipts/${r._id}/transfer`, { expectedVersion: r.version, idempotencyKey: key(), binId: bin._id, uom: 'KG', reason: 'Race transfer' }, alpha), effect: 'TRANSFER' };
    },
    'count down': async () => { const f = await orderWithStock(h, { reserve: null }); return { f, run: async r => h.req(`/warehouse/receipts/${r._id}/count`, { expectedVersion: r.version, idempotencyKey: key(), countedQuantity: '4', uom: 'KG', reason: 'Race count' }, alpha), effect: 'COUNT' }; },
    'ship from reservation': async () => { const f = await orderWithStock(h, { orderQuantity: '3', receiptQuantity: '10', reserve: '1' }); return { f, run: async () => h.req('/fulfillment/shipments', { salesOrderId: f.so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', reference: 'SYN-RACE', sources: [{ sourceType: 'RESERVATION', sourceId: f.reservation._id, quantity: '0.5' }], idempotencyKey: key() }, alpha), effect: 'SHIP' }; },
  };
  const effectCount = async (receiptId, effect) => effect.startsWith('MATERIAL_') ? db.collection('manufacturingMovements').countDocuments({ receiptId, kind: effect }) : db.collection('warehouseMovements').countDocuments({ receiptId, kind: effect });
  for (const [name, prepare] of Object.entries(mutations)) {
    await t.test(`hold apply races ${name}: exactly one wins and stock reconciles`, async () => {
      const outcomes = [];
      for (let i = 0; i < 3; i++) {
        const m = await prepare();
        const r = await receiptOf(m.f.receipt._id), effectsBefore = await effectCount(r._id, m.effect);
        const [held, mutated] = await Promise.all([post(`/warehouse/receipts/${r._id}/holds`, apply(r), inspector), m.run(r)]);
        outcomes.push(`${held.status}/${mutated.status}${mutated.error ? ':' + mutated.error.code : ''}`);
        assert.ok((held.status === 201) !== ([200, 201].includes(mutated.status)), `${name}: exactly one of hold/mutation commits ${JSON.stringify({ held, mutated })}`);
        if (held.status === 201) {
          assert.ok(['STOCK_ENCUMBERED', 'VERSION_CONFLICT'].includes(mutated.error.code), JSON.stringify(mutated));
          assert.equal(await effectCount(r._id, m.effect), effectsBefore, 'no movement after hold');
          // A fresh retry with the current version is refused by the eligibility guard itself.
          const retry = await m.run(await receiptOf(r._id));
          assert.equal(retry.error?.code, 'STOCK_ENCUMBERED', JSON.stringify(retry));
        } else {
          assert.deepEqual([held.status, held.error.code], [409, 'VERSION_CONFLICT']);
          assert.equal(await effectCount(r._id, m.effect), effectsBefore + 1);
          assert.equal(await db.collection('stockHolds').countDocuments({ receiptId: r._id }), 0);
        }
        await authorityMatchesCache(r._id);
        await reconcile(r._id);
        if (m.effect === 'SHIP') assert.equal((await ok(`/fulfillment/orders/${m.f.so._id}/reconciliation`)).matches, true);
      }
      console.log('HOLD_RACE', name, outcomes.join(' '));
    });
  }

  await t.test('guard plus receipt write conflicts with a hold committed inside the open transaction (deterministic interleaving)', async () => {
    const { requireEligibleReceipt } = await import('../src/stock-holds.mjs');
    const f = await orderWithStock(h, { reserve: null });
    const session = h.client.startSession();
    let attempts = 0, outcome;
    try {
      outcome = await session.withTransaction(async () => {
        attempts++;
        const r = await db.collection('warehouseReceipts').findOne({ _id: f.receipt._id }, { session });
        await requireEligibleReceipt(db, r, session);
        if (attempts === 1) {
          const held = await post(`/warehouse/receipts/${r._id}/holds`, apply(await receiptOf(r._id)), inspector);
          assert.equal(held.status, 201, JSON.stringify(held));
        }
        await db.collection('warehouseReceipts').updateOne({ _id: r._id, version: r.version }, { $set: { availableQuantity: '1' }, $inc: { version: 1 } }, { session });
        return 'COMMITTED';
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    } catch (e) { outcome = e.code; } finally { await session.endSession(); }
    assert.deepEqual([outcome, attempts], ['STOCK_ENCUMBERED', 2]);
    const after = await receiptOf(f.receipt._id);
    assert.deepEqual([after.availableQuantity, after.hold.active], ['5', true]);
    await reconcile(f.receipt._id);
  });

  await t.test('release races manufacturing consumption and a second hold without losing the other hold', async () => {
    const m = await mutations['first consumption']();
    let r = await receiptOf(m.f.receipt._id);
    const a = (await post(`/warehouse/receipts/${r._id}/holds`, apply(r), alpha)).data;
    const [freed, consumed] = await Promise.all([post(`/warehouse/holds/${a.hold.id}/release`, release(a.hold), quality), m.run()]);
    assert.equal(freed.status, 200);
    assert.ok([200, 409].includes(consumed.status), JSON.stringify(consumed));
    if (consumed.status === 409) assert.equal(consumed.error.code, 'STOCK_ENCUMBERED');
    await reconcile(r._id);
    r = await receiptOf(r._id);
    const b = (await post(`/warehouse/receipts/${r._id}/holds`, apply(r), alpha)).data;
    r = await receiptOf(r._id);
    const [releasedB, appliedC] = await Promise.all([post(`/warehouse/holds/${b.hold.id}/release`, release(b.hold), quality), post(`/warehouse/receipts/${r._id}/holds`, apply(r, { reasonCode: 'OTHER', reasonNote: 'Concurrent second hold' }), inspector)]);
    assert.equal(releasedB.status, 200, JSON.stringify(releasedB));
    assert.ok([201, 409].includes(appliedC.status), JSON.stringify(appliedC));
    await authorityMatchesCache(r._id);
    const final = await receiptOf(r._id);
    if (appliedC.status === 201) assert.deepEqual(final.hold.activeHoldIds, [appliedC.data.hold.id]);
    else assert.equal(final.hold.active, false);
  });
});
