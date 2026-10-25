import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { legacyFixture, domainSnapshot, afterAuthorization, withReplacement } from '../../wave4map/qa/mapping-fixture.mjs';

const key = () => randomUUID();
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.keys(value).sort().map(name => [name, canonical(value[name])])) : value;
const rehash = row => { const plain = Object.fromEntries(Object.entries(row).filter(([name]) => name !== 'contentHash')); return { ...plain, contentHash: createHash('sha256').update(JSON.stringify(canonical(plain))).digest('hex') }; };

test('independent delivered-versus-shipped evidence, chronology and anchored proof', async t => {
  const h = await startOwned(t), legacy = await legacyFixture(h), serials = ['QA_POD_OUTPUT_A', 'QA_POD_OUTPUT_B'];
  const batch = await h.ok('/manufacturing/work-orders', { salesOrderId: legacy.so._id, expectedVersion: legacy.so.version, lineIndex: 0, quantities: ['2'], uom: 'UN', serialized: true, idempotencyKey: key() }, 201);
  let wo = batch.workOrders[0]; wo = await h.ok(`/manufacturing/work-orders/${wo._id}/release`, { expectedVersion: wo.version, operations: [{ code: 'QA-POD-OP', instruction: 'Synthetic independent delivery source' }], materials: [{ receiptId: legacy.receipt._id, quantityPerUnit: '1', uom: 'UN' }], idempotencyKey: key() });
  wo = await h.ok(`/manufacturing/work-orders/${wo._id}/record`, { expectedVersion: wo.version, operationIndex: 0, inputQuantity: '2', goodQuantity: '2', scrapQuantity: '0', uom: 'UN', outputSerials: serials, evidence: 'Synthetic actual delivery-source production record', idempotencyKey: key() });
  wo = await h.ok(`/manufacturing/work-orders/${wo._id}/qc`, { expectedVersion: wo.version, acceptedQuantity: '2', rejectedQuantity: '0', acceptedSerials: serials, rejectedSerials: [], uom: 'UN', evidence: 'Synthetic actual delivery-source inspection', idempotencyKey: key() });
  const shipment = await h.ok('/fulfillment/shipments', { salesOrderId: legacy.so._id, expectedVersion: legacy.so.version, lineIndex: 0, uom: 'UN', reference: 'QA independent actual serial dispatch', sources: [{ sourceType: 'WORK_ORDER', sourceId: wo._id, quantity: '2', serials }], idempotencyKey: key() }, 201), route = `/deliveries/shipments/${shipment._id}`;
  const sources = async () => Promise.all(['fulfillmentTallies', 'manufacturingOutputUnits', 'warehouseSerials', 'warehouseMovements', 'fulfillmentInvoices', 'fulfillmentPayments'].map(name => h.db.collection(name).find().sort({ _id: 1 }).toArray())), originalSources = await sources();
  const view = () => h.ok(route), body = (version, deliveredSerials) => ({ expectedVersion: version, expectedShipmentVersion: shipment.version, quantity: String(deliveredSerials.length), serials: deliveredSerials, deliveredAt: new Date().toISOString(), receiverName: 'Synthetic QA Receiver', receiverReference: 'QA-RECEIVER-REF', evidenceReference: 'QA-POD-REFERENCE', evidenceNotes: 'Synthetic operator-entered receiving evidence, no independent signature verification', idempotencyKey: key() });
  async function deny(payload, status, code) { const before = await domainSnapshot(h), response = await h.req(`${route}/confirmations`, payload, h.alpha); assert.equal(response.status, status, JSON.stringify(response)); assert.equal(response.error.code, code); assert.deepEqual(await domainSnapshot(h), before); }
  let first, winnerBody;

  await t.test('dispatch never implies delivery and pre-dispatch, foreign or invented identity confirmations have no effects', async () => {
    const current = await view(); assert.equal(current.shipmentStatus, 'SHIPPED'); assert.equal(current.status, 'NOT_DELIVERED'); assert.equal(current.deliveredQuantity, '0'); assert.equal(current.remainingQuantity, '2');
    await deny({ ...body(1, [serials[0]]), deliveredAt: new Date(new Date(shipment.shippedAt).getTime() - 1).toISOString() }, 400, 'INVALID_DELIVERY_DATE');
    await deny(body(1, ['QA_POD_INVENTED']), 400, 'INVALID_DELIVERY_SERIALS');
    const before = await domainSnapshot(h); assert.equal((await h.req(route, undefined, h.beta)).status, 404); assert.deepEqual(await domainSnapshot(h), before);
  });

  await t.test('outbox failure atomically rolls back delivery head, immutable confirmation, source fence and key', async () => {
    const payload = body(1, [serials[0]]), before = await domainSnapshot(h);
    await h.db.command({ collMod: 'deliveryOutbox', validator: { $jsonSchema: { required: ['QA_REQUIRED_FAILURE'] } }, validationLevel: 'strict', validationAction: 'error' });
    try { const response = await h.req(`${route}/confirmations`, payload, h.alpha); assert.equal(response.status, 500); assert.deepEqual(await domainSnapshot(h), before); }
    finally { await h.db.command({ collMod: 'deliveryOutbox', validator: {} }); }
    first = await h.ok(`${route}/confirmations`, payload, 201); assert.equal(first.status, 'PARTIALLY_DELIVERED'); assert.equal(first.deliveredQuantity, '1'); assert.equal(first.remainingQuantity, '1');
    const committed = await domainSnapshot(h); assert.deepEqual(await h.ok(`${route}/confirmations`, payload, 201), first); assert.deepEqual(await domainSnapshot(h), committed);
  });

  await t.test('self-rehashed receiver, evidence and date tampering fails against anchored confirmation refs', async () => {
    const original = await h.db.collection('deliveryConfirmations').findOne({ shipmentId: shipment._id, ordinal: 1 });
    for (const change of [{ receiverName: 'Forged receiver' }, { evidenceReference: 'Forged evidence' }, { deliveredAt: new Date(0).toISOString() }]) await withReplacement(h, 'deliveryConfirmations', original, rehash({ ...original, ...change }), async () => { const before = await domainSnapshot(h), response = await h.req(route, undefined, h.alpha); assert.equal(response.status, 409); assert.equal(response.error.code, 'DELIVERY_SOURCE_INVALID'); assert.deepEqual(await domainSnapshot(h), before); });
  });

  await t.test('malformed persisted quantity and altered event references are source corruption rather than accepted evidence', async () => {
    const stored = await h.db.collection('fulfillmentShipments').findOne({ _id: shipment._id }), event = await h.db.collection('deliveryEvents').findOne({ shipmentId: shipment._id });
    async function rejectsCorruption() {
      const before = await domainSnapshot(h);
      for (const [path, payload] of [[route, undefined], [`${route}/confirmations`, body(first.version, [serials[1]])]]) {
        const response = await h.req(path, payload, h.alpha); assert.equal(response.status, 409, JSON.stringify(response)); assert.equal(response.error.code, 'DELIVERY_SOURCE_INVALID'); assert.deepEqual(await domainSnapshot(h), before);
      }
    }
    for (const quantity of [2, 'not-a-quantity']) await withReplacement(h, 'fulfillmentShipments', stored, { ...stored, quantity }, rejectsCorruption);
    for (const change of [{ confirmationId: randomUUID() }, { kind: 'FORGED_EVENT_KIND' }]) await withReplacement(h, 'deliveryEvents', event, { ...event, ...change }, rejectsCorruption);
  });

  await t.test('later source hold does not erase dispatched history; competing final confirmation commits one remaining serial once', async () => {
    const raw = await h.db.collection('warehouseReceipts').findOne({ _id: legacy.receipt._id }), hold = await h.send(`/warehouse/receipts/${raw._id}/holds`, { body: { expectedReceiptVersion: raw.version, reasonCode: 'QC_SUSPECT', reasonNote: 'Synthetic source hold after actual dispatch' }, headers: { 'Idempotency-Key': key() } }); assert.equal(hold.status, 201, JSON.stringify(hold));
    try {
      const payloads = [body(first.version, [serials[1]]), body(first.version, [serials[1]])], responses = await Promise.all(payloads.map(payload => h.req(`${route}/confirmations`, payload, h.alpha))); assert.deepEqual(responses.map(row => row.status).sort(), [201,409]);
      const index = responses.findIndex(row => row.status === 201); winnerBody = payloads[index]; assert.equal(responses[index].data.status, 'DELIVERED'); assert.equal(responses[index].data.deliveredQuantity, '2'); assert.equal(responses[1-index].error.code, 'VERSION_CONFLICT');
      assert.equal(await h.db.collection('deliveryConfirmations').countDocuments({ shipmentId: shipment._id }), 2); assert.equal(await h.db.collection('deliveryKeys').countDocuments({ shipmentId: shipment._id }), 2); assert.equal(await h.db.collection('deliveryKeys').countDocuments({ key: payloads[1-index].idempotencyKey }), 0);
      assert.deepEqual(await sources(), originalSources);
    } finally { const released = await h.send(`/warehouse/holds/${hold.data.hold.id}/release`, { body: { expectedVersion: hold.data.hold.version, reasonCode: 'INSPECTION_PASSED', reasonNote: 'Synthetic source hold released after historical POD' }, headers: { 'Idempotency-Key': key() } }); assert.equal(released.status, 200, JSON.stringify(released)); }
  });

  await t.test('orphan evidence cannot reset delivered status, and committing revocation precedes acknowledged replay', async () => {
    const head = await h.db.collection('deliveryHeads').findOne({ _id: shipment._id });
    await h.db.collection('deliveryHeads').deleteOne({ _id: head._id });
    try { const before = await domainSnapshot(h), response = await h.req(route, undefined, h.alpha); assert.equal(response.status, 409); assert.equal(response.error.code, 'DELIVERY_SOURCE_INVALID'); assert.deepEqual(await domainSnapshot(h), before); }
    finally { await h.db.collection('deliveryHeads').insertOne(head); }
    const member = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId }), before = await domainSnapshot(h);
    try { const response = await afterAuthorization(h, 'fulfillment.deliver', () => h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [] } }), () => h.req(`${route}/confirmations`, winnerBody, h.alpha)); assert.equal(response.status, 403); assert.deepEqual(await domainSnapshot(h), before); }
    finally { await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    assert.equal((await h.ok(`${route}/confirmations`, winnerBody, 201)).status, 'DELIVERED'); assert.deepEqual(await domainSnapshot(h), before); assert.deepEqual(await sources(), originalSources);
  });

  await t.test('mixed actual warehouse and serialized output dispatch conserves its independent untracked delivery budget', async () => {
    const serial = 'QA_POD_MIXED_OUTPUT';
    const planned = await h.ok('/manufacturing/work-orders', { salesOrderId: legacy.so._id, expectedVersion: legacy.so.version, lineIndex: 0, quantities: ['1'], uom: 'UN', serialized: true, idempotencyKey: key() }, 201);
    let mixedWo = planned.workOrders[0];
    mixedWo = await h.ok(`/manufacturing/work-orders/${mixedWo._id}/release`, { expectedVersion: mixedWo.version, operations: [{ code: 'QA-POD-MIXED', instruction: 'Synthetic mixed delivery actual output' }], materials: [{ receiptId: legacy.receipt._id, quantityPerUnit: '1', uom: 'UN' }], idempotencyKey: key() });
    mixedWo = await h.ok(`/manufacturing/work-orders/${mixedWo._id}/record`, { expectedVersion: mixedWo.version, operationIndex: 0, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', uom: 'UN', outputSerials: [serial], evidence: 'Synthetic actual mixed delivery production', idempotencyKey: key() });
    mixedWo = await h.ok(`/manufacturing/work-orders/${mixedWo._id}/qc`, { expectedVersion: mixedWo.version, acceptedQuantity: '1', rejectedQuantity: '0', acceptedSerials: [serial], rejectedSerials: [], uom: 'UN', evidence: 'Synthetic actual mixed delivery QC', idempotencyKey: key() });
    const mixed = await h.ok('/fulfillment/shipments', { salesOrderId: legacy.so._id, expectedVersion: legacy.so.version, lineIndex: 0, uom: 'UN', reference: 'QA actual mixed tracked and untracked dispatch', sources: [{ sourceType: 'WORK_ORDER', sourceId: mixedWo._id, quantity: '1', serials: [serial] }, { sourceType: 'RESERVATION', sourceId: legacy.reservation._id, quantity: '1' }], idempotencyKey: key() }, 201);
    const mixedRoute = `/deliveries/shipments/${mixed._id}`, dispatchedSources = await sources();
    let current = await h.ok(mixedRoute);
    assert.equal(current.shippedQuantity, '2'); assert.equal(current.unserializedQuantity, '1'); assert.equal(current.remainingUnserializedQuantity, '1'); assert.deepEqual(current.remainingSerials, [serial]);
    const payload = (version, serials) => ({ ...body(version, serials), expectedShipmentVersion: mixed.version, quantity: '1' });
    const rawMixed = await h.db.collection('fulfillmentShipments').findOne({ _id: mixed._id }), rawMovement = await h.db.collection('warehouseMovements').findOne({ shipmentId: mixed._id, sourceType: 'RESERVATION' });
    const zeroSource = { ...rawMixed, quantity: '1', sources: rawMixed.sources.map(source => source.sourceType === 'RESERVATION' ? { ...source, quantity: '0' } : source) };
    await withReplacement(h, 'fulfillmentShipments', rawMixed, zeroSource, () => withReplacement(h, 'warehouseMovements', rawMovement, { ...rawMovement, quantity: '0' }, async () => {
      const before = await domainSnapshot(h);
      for (const [path, value] of [[mixedRoute, undefined], [`${mixedRoute}/confirmations`, payload(1, [serial])]]) { const response = await h.req(path, value, h.alpha); assert.equal(response.status, 409, JSON.stringify(response)); assert.equal(response.error.code, 'DELIVERY_SOURCE_INVALID'); assert.deepEqual(await domainSnapshot(h), before); }
    }));
    current = await h.ok(`${mixedRoute}/confirmations`, payload(current.version, []), 201);
    assert.equal(current.status, 'PARTIALLY_DELIVERED'); assert.equal(current.remainingQuantity, '1'); assert.equal(current.remainingUnserializedQuantity, '0'); assert.deepEqual(current.remainingSerials, [serial]);
    const before = await domainSnapshot(h), overflow = await h.req(`${mixedRoute}/confirmations`, payload(current.version, []), h.alpha);
    assert.equal(overflow.status, 400, JSON.stringify(overflow)); assert.equal(overflow.error.code, 'INVALID_DELIVERY_SERIALS'); assert.deepEqual(await domainSnapshot(h), before);
    current = await h.ok(`${mixedRoute}/confirmations`, payload(current.version, [serial]), 201);
    assert.equal(current.status, 'DELIVERED'); assert.equal(current.deliveredQuantity, '2'); assert.equal(current.remainingUnserializedQuantity, '0'); assert.deepEqual(current.deliveredSerials, [serial]);
    assert.equal(await h.db.collection('deliveryConfirmations').countDocuments({ shipmentId: mixed._id }), 2); assert.deepEqual(await sources(), dispatchedSources);
  });
});
