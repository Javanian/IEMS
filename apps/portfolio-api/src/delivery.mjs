import { createHash, randomUUID } from 'node:crypto';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { businessNow } from './business-clock.mjs';

export const deliveryActions = ['fulfillment.deliver'];
export const deliveryRoles = { fulfillmentDelivery: ['fulfillment.read', 'fulfillment.deliver'] };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const invalid = () => fail(409, 'DELIVERY_SOURCE_INVALID');
const positive = value => Number.isSafeInteger(value) && value > 0;
const units = value => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(value)) fail(400, 'INVALID_QUANTITY'); return BigInt(value.split('.')[0]) * 1000000n + BigInt((value.split('.')[1] || '').padEnd(6, '0')); };
const storedUnits = value => { try { return units(value); } catch { invalid(); } };
const decimal = value => { const raw = value.toString().padStart(7, '0'); return `${raw.slice(0, -6)}.${raw.slice(-6)}`.replace(/0+$/, '').replace(/\.$/, ''); };
const without = (row, fields) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));
const semantic = row => without(row, ['eventId', 'authorityHash']);
const stamped = row => ({ ...row, contentHash: hash(row) });

export async function initializeDelivery(db) {
  for (const [name, keys] of [['deliveryHeads', { tenantId: 1, plantId: 1, shipmentId: 1 }], ['deliveryConfirmations', { tenantId: 1, plantId: 1, shipmentId: 1, ordinal: 1 }], ['deliveryEvents', { tenantId: 1, plantId: 1, shipmentId: 1, version: 1 }], ['deliveryKeys', { tenantId: 1, plantId: 1, key: 1 }]]) await db.collection(name).createIndex(keys, { unique: true });
  for (const name of ['deliveryKeys', 'deliveryAudit', 'deliveryOutbox']) await db.collection(name).createIndex({ tenantId: 1, plantId: 1, shipmentId: 1 });
}

export function installDelivery(app, runtime, { guard, fields, id }) {
  const db = runtime.db, c = name => db.collection(name), root = '/api/deliveries/shipments/:id';
  app.use('/api/deliveries', async (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    req.deliveryAction = req.method === 'GET' ? 'fulfillment.read' : req.method === 'POST' && /^\/shipments\/[^/]+\/confirmations$/.test(req.path) ? 'fulfillment.deliver' : null;
    if (!req.deliveryAction) fail(404, 'NOT_FOUND');
    await runtime.foundation.authorize(req.scope, { ...req.filter, action: req.deliveryAction }); next();
  });
  async function source(req, session) {
    const shipment = await c('fulfillmentShipments').findOne({ ...req.filter, _id: id(req.params.id) }, { session });
    if (!shipment) fail(404, 'NOT_FOUND');
    if (shipment.status !== 'SHIPPED' || !positive(shipment.version) || !Array.isArray(shipment.sources) || !shipment.sources.length || shipment.stockMovementCount !== shipment.sources.length || new Set(shipment.sources.map(row => row.sourceId)).size !== shipment.sources.length) invalid();
    const order = await c('salesOrders').findOne({ ...req.filter, _id: shipment.salesOrderId }, { session }), line = order?.snapshot?.lines?.[shipment.lineIndex];
    if (!line || order.accountId !== shipment.accountId || line.uom !== shipment.uom || storedUnits(shipment.quantity) <= 0n) invalid();
    const movements = await c('warehouseMovements').find({ ...req.filter, shipmentId: shipment._id, kind: 'SHIP' }, { session }).limit(101).toArray();
    if (movements.length !== shipment.sources.length) invalid();
    let amount = 0n; const serials = [];
    for (const part of shipment.sources) {
      const matches = movements.filter(row => row.sourceId === part.sourceId && row.sourceType === part.sourceType);
      if (matches.length !== 1) invalid();
      const movement = matches[0], partQuantity = storedUnits(part.quantity); if (partQuantity <= 0n) invalid(); amount += partQuantity;
      if (movement.salesOrderId !== shipment.salesOrderId || movement.accountId !== shipment.accountId || movement.lineIndex !== shipment.lineIndex || movement.uom !== shipment.uom || storedUnits(movement.quantity) !== partQuantity || movement.to !== 'SHIPPED' || hash(movement.serials || []) !== hash(part.serials || [])) invalid();
      if (Object.hasOwn(part, 'serials')) {
        if (!Array.isArray(part.serials) || units(part.quantity) !== BigInt(part.serials.length) * 1000000n || part.sourceType !== 'WORK_ORDER') invalid();
        const actual = await c('manufacturingOutputUnits').find({ ...req.filter, workOrderId: part.sourceId, shipmentId: shipment._id, serial: { $in: part.serials }, status: 'SHIPPED' }, { session }).limit(1001).toArray();
        if (actual.length !== part.serials.length || new Set(actual.map(row => row.serial)).size !== actual.length) invalid();
        serials.push(...part.serials);
      }
    }
    if (amount !== units(shipment.quantity) || new Set(serials).size !== serials.length || BigInt(serials.length) * 1000000n > amount) invalid();
    return { shipment, serials: serials.sort(), sourceHash: hash(without(shipment, ['deliveryUseFence'])) };
  }
  async function state(req, original, session) {
    const filter = { ...req.filter, shipmentId: original.shipment._id }, options = { session };
    const head = await c('deliveryHeads').findOne({ ...req.filter, _id: original.shipment._id }, options), confirmations = await c('deliveryConfirmations').find(filter, options).sort({ ordinal: 1 }).limit(101).toArray(), events = await c('deliveryEvents').find(filter, options).limit(101).toArray();
    if (!head) {
      if (confirmations.length || events.length || await c('deliveryHeads').findOne(filter, options)) invalid();
      for (const name of ['deliveryKeys', 'deliveryAudit', 'deliveryOutbox']) if (await c(name).findOne(filter, options)) invalid();
      return { head: null, confirmations: [] };
    }
    if (head.shipmentId !== original.shipment._id || head.sourceHash !== original.sourceHash || !positive(head.version) || head.version !== confirmations.length + 1 || confirmations.length > 100 || !confirmations.length || events.length !== confirmations.length || !Array.isArray(head.confirmationIds) || head.confirmationIds.length !== confirmations.length || !Array.isArray(head.confirmationRefs) || head.confirmationRefs.length !== confirmations.length) invalid();
    const current = events.find(row => row._id === head.eventId);
    if (!current || current.version !== head.version || current.contentHash !== head.authorityHash || hash(current.snapshot) !== head.authorityHash || hash(semantic(head)) !== head.authorityHash) invalid();
    let delivered = 0n; const serials = [];
    for (let index = 0; index < confirmations.length; index++) {
      const confirmation = confirmations[index], event = events.find(row => row.version === index + 2);
      if (head.confirmationRefs[index]?.id !== confirmation._id || head.confirmationRefs[index]?.contentHash !== confirmation.contentHash || event?.confirmationHash !== confirmation.contentHash || event?.confirmationId !== confirmation._id || event?.kind !== 'DELIVERY_CONFIRMED' || hash(event?.snapshot?.confirmationRefs) !== hash(head.confirmationRefs.slice(0, index + 1))) invalid();
      if (confirmation.ordinal !== index + 1 || confirmation._id !== head.confirmationIds[index] || confirmation.sourceHash !== original.sourceHash || hash(without(confirmation, ['contentHash'])) !== confirmation.contentHash || storedUnits(confirmation.quantity) <= 0n || !event || hash(event.snapshot) !== event.contentHash || event.snapshot.sourceHash !== original.sourceHash || event.snapshot.shipmentId !== original.shipment._id || event.snapshot.version !== event.version) invalid();
      if (original.serials.length ? !Array.isArray(confirmation.serials) || BigInt(confirmation.serials.length) * 1000000n > units(confirmation.quantity) || confirmation.serials.some(serial => !original.serials.includes(serial)) : Object.hasOwn(confirmation, 'serials')) invalid();
      delivered += units(confirmation.quantity); serials.push(...(confirmation.serials || []));
      if (delivered - BigInt(serials.length) * 1000000n > units(original.shipment.quantity) - BigInt(original.serials.length) * 1000000n) invalid();
      if (event.snapshot.deliveredQuantity !== decimal(delivered) || hash(event.snapshot.confirmationIds) !== hash(head.confirmationIds.slice(0, index + 1)) || hash(event.snapshot.serials) !== hash([...serials].sort())) invalid();
    }
    if (delivered > units(original.shipment.quantity) || new Set(serials).size !== serials.length || head.deliveredQuantity !== decimal(delivered) || hash(head.serials) !== hash(serials.sort()) || head.status !== (delivered === units(original.shipment.quantity) ? 'DELIVERED' : 'PARTIALLY_DELIVERED')) invalid();
    return { head, confirmations };
  }
  const view = (original, current) => ({ shipmentId: original.shipment._id, shipmentVersion: original.shipment.version, shipmentReference: original.shipment.reference, salesOrderId: original.shipment.salesOrderId, accountId: original.shipment.accountId, shipmentStatus: original.shipment.status, sourceHash: original.sourceHash, version: current.head?.version || 1, status: current.head?.status || 'NOT_DELIVERED', shippedQuantity: decimal(units(original.shipment.quantity)), deliveredQuantity: current.head?.deliveredQuantity || '0', remainingQuantity: decimal(units(original.shipment.quantity) - units(current.head?.deliveredQuantity || '0')), uom: original.shipment.uom, unserializedQuantity: decimal(units(original.shipment.quantity) - BigInt(original.serials.length) * 1000000n), remainingUnserializedQuantity: decimal(units(original.shipment.quantity) - units(current.head?.deliveredQuantity || '0') - BigInt(original.serials.length - (current.head?.serials?.length || 0)) * 1000000n), serials: original.serials, deliveredSerials: current.head?.serials || [], remainingSerials: original.serials.filter(serial => !current.head?.serials.includes(serial)), confirmationCount: current.confirmations.length, canConfirm: current.head?.status !== 'DELIVERED' && current.confirmations.length < 100, confirmations: current.confirmations.map(row => without(row, ['tenantId', 'plantId'])), authorityHash: current.head?.authorityHash || null, evidenceMode: 'OPERATOR_RECORDED' });
  const read = async effect => { const session = runtime.client.startSession(); try { return await session.withTransaction(() => effect(session), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }); } finally { await session.endSession(); } };
  app.get(root, async (req, res) => res.json({ data: await read(async session => { const original = await source(req, session); return view(original, await state(req, original, session)); }) }));
  app.get(`${root}/confirmations`, async (req, res) => res.json(await read(async session => {
    const original = await source(req, session); await state(req, original, session);
    const limit = req.query.limit === undefined ? 25 : Number(req.query.limit); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
    const rows = await c('deliveryConfirmations').find({ ...req.filter, shipmentId: original.shipment._id, ...(req.query.cursor === undefined ? {} : { _id: { $gt: id(req.query.cursor) } }) }, { session }).sort({ _id: 1 }).limit(limit + 1).toArray();
    return { data: rows.slice(0, limit), page: { limit, nextCursor: rows.length > limit ? rows[limit - 1]._id : null } };
  })));
  app.post(`${root}/confirmations`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'expectedShipmentVersion', 'quantity', 'serials', 'deliveredAt', 'receiverName', 'receiverReference', 'evidenceReference', 'evidenceNotes', 'idempotencyKey']);
    const body = req.body;
    if (!positive(body.expectedVersion) || !positive(body.expectedShipmentVersion)) fail(400, 'INVALID_VERSION');
    if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.idempotencyKey)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
    const bounded = (value, max) => { if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > max) fail(400, 'INVALID_DELIVERY_EVIDENCE'); return value.trim(); };
    const evidence = { receiverName: bounded(body.receiverName, 100), receiverReference: bounded(body.receiverReference, 100), evidenceReference: bounded(body.evidenceReference, 200), evidenceNotes: bounded(body.evidenceNotes, 1000) };
    if (typeof body.deliveredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(body.deliveredAt) || !Number.isFinite(Date.parse(body.deliveredAt)) || Date.parse(body.deliveredAt) > Date.now() + 300000 || new Date(body.deliveredAt).toISOString().replace('.000Z', 'Z') !== body.deliveredAt.replace('.000Z', 'Z')) fail(400, 'INVALID_DELIVERY_DATE');
    const quantity = units(body.quantity); if (quantity <= 0n) fail(400, 'INVALID_QUANTITY');
    const payloadHash = hash({ path: req.params.id, body });
    let data;
    for (let attempt = 0; ; attempt++) {
      const session = runtime.client.startSession();
      try {
        data = await session.withTransaction(async () => {
          await guard(runtime, req, session, 'fulfillment.deliver');
          const prior = await c('deliveryKeys').findOne({ ...req.filter, key: body.idempotencyKey }, { session }); if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT'); return prior.result; }
          const original = await source(req, session), current = await state(req, original, session), before = view(original, current);
          if (before.version !== body.expectedVersion || original.shipment.version !== body.expectedShipmentVersion) fail(409, 'VERSION_CONFLICT');
          if (!before.canConfirm) fail(409, 'DELIVERY_STATE_CONFLICT');
          if (!Number.isFinite(new Date(original.shipment.shippedAt).getTime()) || Date.parse(body.deliveredAt) < new Date(original.shipment.shippedAt).getTime() || Date.parse(body.deliveredAt) > businessNow(runtime).getTime() + 300000) fail(400, 'INVALID_DELIVERY_DATE');
          if (quantity > units(before.remainingQuantity)) fail(409, 'DELIVERY_QUANTITY_EXCEEDED');
          const serials = body.serials;
          if (original.serials.length) {
            if (!Array.isArray(serials) || serials.length > 1000 || new Set(serials).size !== serials.length || BigInt(serials.length) * 1000000n > quantity || serials.some(serial => !before.remainingSerials.includes(serial)) || quantity - BigInt(serials.length) * 1000000n > units(before.remainingQuantity) - BigInt(before.remainingSerials.length) * 1000000n) fail(400, 'INVALID_DELIVERY_SERIALS');
          } else if (Object.hasOwn(body, 'serials')) fail(400, 'INVALID_DELIVERY_SERIALS');
          const fence = await c('fulfillmentShipments').updateOne({ ...req.filter, _id: original.shipment._id, version: original.shipment.version }, { $inc: { deliveryUseFence: 1 } }, { session }); if (fence.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
          const confirmation = stamped({ _id: randomUUID(), ...req.filter, shipmentId: original.shipment._id, sourceHash: original.sourceHash, ordinal: current.confirmations.length + 1, quantity: decimal(quantity), ...(original.serials.length ? { serials: [...serials].sort() } : {}), deliveredAt: new Date(body.deliveredAt).toISOString(), ...evidence, recordedBy: req.scope.userId, recordedAt: new Date(), evidenceMode: 'OPERATOR_RECORDED' });
          await c('deliveryConfirmations').insertOne(confirmation, { session });
          const delivered = units(before.deliveredQuantity) + quantity, snapshot = { _id: original.shipment._id, ...req.filter, shipmentId: original.shipment._id, sourceHash: original.sourceHash, version: before.version + 1, deliveredQuantity: decimal(delivered), status: delivered === units(before.shippedQuantity) ? 'DELIVERED' : 'PARTIALLY_DELIVERED', serials: [...before.deliveredSerials, ...(serials || [])].sort(), confirmationIds: [...(current.head?.confirmationIds || []), confirmation._id], confirmationRefs: [...(current.head?.confirmationRefs || []), { id: confirmation._id, contentHash: confirmation.contentHash }] }, eventId = randomUUID(), head = { ...snapshot, eventId, authorityHash: hash(snapshot) };
          await c('deliveryEvents').insertOne({ _id: eventId, ...req.filter, shipmentId: original.shipment._id, version: head.version, kind: 'DELIVERY_CONFIRMED', snapshot, contentHash: head.authorityHash, confirmationId: confirmation._id, confirmationHash: confirmation.contentHash }, { session });
          if (current.head) { const changed = await c('deliveryHeads').replaceOne({ ...req.filter, _id: head._id, version: before.version }, head, { session }); if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); } else await c('deliveryHeads').insertOne(head, { session });
          const result = view(original, await state(req, original, session)), event = { ...req.filter, shipmentId: original.shipment._id, confirmationId: confirmation._id, kind: 'delivery.confirmed', version: head.version, recordedBy: req.scope.userId, recordedAt: new Date() };
          await c('deliveryAudit').insertOne({ _id: randomUUID(), ...event }, { session }); await c('deliveryOutbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session }); await c('deliveryKeys').insertOne({ _id: randomUUID(), ...req.filter, shipmentId: original.shipment._id, key: body.idempotencyKey, payloadHash, result }, { session }); return result;
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' }); break;
      } catch (error) { if (error.code === 11000 && attempt < 3) continue; if (error.code === 11000) fail(409, 'DELIVERY_STATE_CONFLICT'); throw error; }
      finally { await session.endSession(); }
    }
    res.status(201).json({ data });
  });
}
