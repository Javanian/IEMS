import { requireDispatchResources } from './descendant-freeze.mjs';
import { initializeManufacturedDispatch, installManufacturedDispatch, validateManufacturedShipment } from './manufactured-dispatch.mjs';
import { purchasedReadContext, purchasedReconciliation } from './purchased-fulfillment.mjs';
import { preparePurchasedFinancial, recordPurchasedFinancial, purchasedFinancialReplay, validatePurchasedShipment, validatePurchasedInvoice, validatePurchasedPayment, depositState, applyDeposit, saveSettlementEvidence } from './purchased-financial.mjs';
import { validateInvoicePosting, settlementStatus } from './purchased-billing-state.mjs';
import { agingBucket } from '../../../packages/contracts/src/domains/logistics-billing/values.mjs';
import { requireUnboundSalesOrder } from './quote-catalog.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { fixtureVat, fixtureTax, taxAmounts } from './fixture-tax.mjs';
import { requireEligibleReceipt } from './stock-holds.mjs';
import { freezeShipmentGenealogy } from './genealogy.mjs';
import { freezeShipmentInstallation } from './component-installation.mjs';
import { requireQuantityOnlyReceipt } from './serial-custody.mjs';
import { requireLegacyReceipt } from './receipt-origin.mjs';
import { businessNow } from './business-clock.mjs';
import { requireQualityGates } from './quality.mjs';
import { stockHash } from './catalog-stock-values.mjs';
import { appendReportingSnapshot, initializeReportingSnapshots } from '../../../packages/domain-events/snapshot-source.mjs';
import { sourceHash, addDecimals } from '../../../packages/domain-events/source-bindings.mjs';
import { readDeliveryState, deliverySourceHash } from './delivery.mjs';
import { shipmentSemantic } from './purchased-stock-proof.mjs';

const verbs = ['read', 'ship', 'invoice', 'pay'];
export const fulfillmentActions = verbs.map(v => `fulfillment.${v}`);
export const fulfillmentRoles = Object.fromEntries(verbs.map(v => [`fulfillment${v[0].toUpperCase()}${v.slice(1)}`, [...new Set(['fulfillment.read', `fulfillment.${v}`])]]));
export async function initializeFulfillment(db) {
  await initializeReportingSnapshots(db);
  await initializeManufacturedDispatch(db);
  await db.collection('reportingPaymentIdentities').createIndex({ tenantId: 1, plantId: 1, paymentId: 1, orderId: 1 }, { unique: true });
  await db.collection('fulfillmentKeys').createIndex({ tenantId: 1, plantId: 1, key: 1 }, { unique: true });
  await db.collection('fulfillmentTallies').createIndex({ tenantId: 1, plantId: 1, kind: 1, subjectId: 1, lineIndex: 1 }, { unique: true });
  await db.collection('fulfillmentPacking').createIndex({ tenantId: 1, plantId: 1, salesOrderId: 1, _id: 1 });
  for (const [name, keys] of [['fulfillmentInvoicePostings', { tenantId: 1, plantId: 1, invoiceId: 1 }], ['fulfillmentDepositAllocations', { tenantId: 1, plantId: 1, paymentId: 1 }], ['fulfillmentCreditNotes', { tenantId: 1, plantId: 1, paymentId: 1 }]]) await db.collection(name).createIndex(keys, { unique: true });
}
const scales = { USD: 2, EUR: 2, GBP: 2, IDR: 2, JPY: 0, KWD: 3 };
const units = s => BigInt(s.split('.')[0]) * 1000000n + BigInt((s.split('.')[1] || '').padEnd(6, '0'));
const decimal = n => { const s = n.toString().padStart(7, '0'); return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/0+$/, '').replace(/\.$/, ''); };
const minor = s => BigInt(s.replace('.', ''));
const money = (n, scale) => { const s = n.toString().padStart(scale + 1, '0'); return scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s; };
// Half-up amount in currency minor units for a quantity in millionths at a fixed-scale unit price.
const extend = (quantity, unitPrice) => (quantity * minor(unitPrice) * 2n + 1000000n) / 2000000n;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;

export async function appendFulfillmentReporting(runtime, req, kind, row, session, eventId, action = req.fulfillmentAction) {
  // Invoice issuance is reference evidence in the v2 contract; it has no invoice dataset.
  if (!['shipment.recorded', 'payment.recorded'].includes(kind)) return;
  const grant = await runtime.foundation.authorizeInTransaction(req.scope, { ...req.filter, action }, { session });
  const occurredAt = new Date(row.shippedAt || row.createdAt).toISOString();
  const source = { collection: row.schema === 'PURCHASED_SHIPMENT_V1' ? 'fulfillmentShipments' : 'fulfillmentKeys', id: row._id, version: row.version, hash: sourceHash(JSON.parse(JSON.stringify(row))), eventIds: [eventId], sourceOccurredAt: occurredAt, ...(kind === 'payment.recorded' ? { settlementKind: row.settlementKind || 'CASH', cashEffect: row.settlementKind === 'CREDIT' || row.settlementKind === 'DEPOSIT' ? 'NONE' : 'RECEIPT', balanceEffect: 'RECEIVABLE_REDUCTION' } : {}) };
  const targets = [];
  if (kind === 'shipment.recorded') {
    const order = await runtime.db.collection('salesOrders').findOne({ ...req.filter, _id: row.salesOrderId }, { session });
    if (!order || order.accountId !== row.accountId || order.snapshot.lines[row.lineIndex]?.uom !== row.uom) throw new Error('SHIPMENT_REPORTING_SOURCE_CONFLICT');
    targets.push({ resourceType: 'fulfillment', resourceId: row._id, eventKey: row._id, fullSnapshot: { orderId: row.salesOrderId, quantity: row.quantity, uom: row.uom, sourceLineIndex: row.lineIndex } });
  } else {
    const groups = new Map();
    for (const allocation of row.allocations) {
      const invoice = await runtime.db.collection('fulfillmentInvoices').findOne({ ...req.filter, _id: allocation.invoiceId }, { session });
      if (!invoice || invoice.accountId !== row.accountId || invoice.currency !== row.currency || allocation.currency !== row.currency) throw new Error('PAYMENT_REPORTING_SOURCE_CONFLICT');
      const values = groups.get(invoice.salesOrderId) || []; values.push(allocation.amount); groups.set(invoice.salesOrderId, values);
    }
    if (!groups.size || addDecimals(row.allocations.map(value => value.amount)) !== addDecimals([row.amount])) throw new Error('PAYMENT_REPORTING_CONSERVATION_CONFLICT');
    for (const [orderId, amounts] of groups) {
      const identity = { ...req.filter, paymentId: row._id, orderId };
      await runtime.db.collection('reportingPaymentIdentities').updateOne(identity, { $setOnInsert: { resourceId: randomUUID() } }, { session, upsert: true });
      const saved = await runtime.db.collection('reportingPaymentIdentities').findOne(identity, { session });
      targets.push({ resourceType: 'payment', resourceId: saved.resourceId, eventKey: `${row._id}:${orderId}`, fullSnapshot: { orderId, amount: addDecimals(amounts), currency: row.currency } });
    }
  }
  for (const target of targets) await appendReportingSnapshot({ db: runtime.db, session, grant, source, ...target, fullSnapshot: { ...target.fullSnapshot, baseline: false, deleted: false, observedAt: occurredAt }, occurredAt });
}

export function installFulfillment(app, runtime, { fail, guard, id, fields }) {
  const c = n => runtime.db.collection(n);
  const qty = s => { if (typeof s !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(s) || !/[1-9]/.test(s)) fail(400, 'INVALID_QUANTITY'); return units(s); };
  const amount = (s, currency) => {
    const scale = Object.hasOwn(scales, currency) ? scales[currency] : undefined;
    if (scale === undefined) fail(400, 'INVALID_CURRENCY');
    if (typeof s !== 'string' || !new RegExp(`^(0|[1-9][0-9]{0,27})${scale ? `\\.[0-9]{${scale}}` : ''}$`).test(s) || !/[1-9]/.test(s)) fail(400, 'INVALID_MONEY');
    return minor(s);
  };
  const text = s => { if (typeof s !== 'string' || !s.trim() || s.length > 200) fail(400, 'INVALID_TEXT'); return s.trim(); };
  const version = v => { if (!Number.isSafeInteger(v) || v < 1) fail(400, 'INVALID_VERSION'); return v; };
  const list = (v, max) => { if (!Array.isArray(v) || !v.length || v.length > max || v.some(x => !x || typeof x !== 'object' || Array.isArray(x))) fail(400, 'INVALID_LINES'); return v; };
  const find = async (name, req, key, session) => { const row = await c(name).findOne({ ...req.filter, _id: id(key) }, { session }); if (!row) fail(404, 'NOT_FOUND'); return row; };
  const base = req => ({ _id: randomUUID(), ...req.filter, version: 1, createdBy: req.scope.userId, createdAt: new Date() });
  const tally = async (req, kind, subjectId, lineIndex, delta, maximum, session) => {
    const filter = { ...req.filter, kind, subjectId, lineIndex }, row = await c('fulfillmentTallies').findOne(filter, { session });
    const before = units(row?.quantity || '0'), after = before + delta;
    if (after > maximum) fail(409, 'QUANTITY_EXCEEDED');
    if (row) await c('fulfillmentTallies').updateOne({ _id: row._id }, { $set: { quantity: decimal(after) } }, { session });
    else await c('fulfillmentTallies').insertOne({ _id: randomUUID(), ...filter, quantity: decimal(after) }, { session });
    return { before, after };
  };
  app.use('/api/fulfillment', async (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    const command = { '/shipments': 'ship', '/manufactured-shipments': 'ship', '/invoices': 'invoice', '/payments': 'pay', '/deposits': 'pay', '/packing': 'ship' }[req.path] || (/^\/packing\/[^/]+\/pack$/.test(req.path) ? 'ship' : null);
    req.fulfillmentAction = req.method === 'GET' ? 'fulfillment.read' : req.method === 'POST' && command ? `fulfillment.${command}` : null;
    if (!req.fulfillmentAction) fail(404, 'NOT_FOUND');
    await runtime.foundation.authorize(req.scope, { ...req.filter, action: req.fulfillmentAction }); next();
  });
  const tx = async (req, kind, effect) => {
    const { idempotencyKey: key, ...payload } = req.body;
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
    const payloadHash = createHash('sha256').update(JSON.stringify(canonical({ kind, payload }))).digest('hex');
    for (let attempt = 1; ; attempt++) {
      const session = runtime.client.startSession();
      try { return await session.withTransaction(async () => {
        await guard(runtime, req, session, req.fulfillmentAction);
        if (req.manufacturedDispatch) for (const action of ['company.stock.read', 'company.stock.reserve', 'company.stock.issue']) await guard(runtime, req, session, action);
        if (kind === 'payment.recorded' && req.body.settlementKind === 'CREDIT') await guard(runtime, req, session, 'fulfillment.invoice');
        const prior = await c('fulfillmentKeys').findOne({ ...req.filter, key }, { session });
        if (prior && prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT');
        const purchased = await preparePurchasedFinancial(runtime.db, req.filter, kind, req.body, session, Boolean(prior));
        if (!purchased && !req.manufacturedDispatch) {
          if (req.body.salesOrderId) await requireUnboundSalesOrder(runtime.db, req.filter, await find('salesOrders', req, req.body.salesOrderId, session), session);
          if (kind === 'payment.recorded') for (const allocation of req.body.allocations) {
            const invoice = await c('fulfillmentInvoices').findOne({ ...req.filter, _id: allocation.invoiceId }, { session });
            if (invoice) await requireUnboundSalesOrder(runtime.db, req.filter, await find('salesOrders', req, invoice.salesOrderId, session), session);
          }
        }
        if (prior) {
          await purchasedFinancialReplay(runtime.db, req.filter, kind, prior, session, Boolean(purchased));
          if (req.manufacturedDispatch && !await validateManufacturedShipment(runtime.db, req.filter, prior.result._id, session)) fail(409, 'FULFILLMENT_STOCK_AUTHORITY_INVALID');
          if (kind === 'deposit.recorded' || req.body.settlementKind === 'DEPOSIT') await depositState(runtime.db, req.filter, req.body.depositId || prior.result._id, session);
          if (kind === 'payment.recorded') for (const allocation of req.body.allocations) await validateInvoicePosting(runtime.db, req.filter, await find('fulfillmentInvoices', req, allocation.invoiceId, session), session);
          return prior.result;
        }
        if (await c('purchasedFulfillmentKeys').findOne({ ...req.filter, key }, { session })) fail(409, 'IDEMPOTENCY_CONFLICT');
        const result = await effect(session);
        const purchasedProofHash = await recordPurchasedFinancial(runtime.db, req.filter, kind, req.body, result, purchased, req.scope.userId, session);
        if (kind === 'invoice.issued') await c('fulfillmentInvoicePostings').insertOne({ _id: randomUUID(), ...req.filter, invoiceId: result._id, snapshot: structuredClone(result), contentHash: stockHash(result) }, { session });
        if (kind === 'payment.recorded') await saveSettlementEvidence(runtime.db, req.filter, req.body, result, req.scope.userId, session);
        const event = { ...req.filter, kind, subjectId: result._id, version: result.version, userId: req.scope.userId, occurredAt: new Date() };
        const eventId = randomUUID();
        await c('fulfillmentAudit').insertOne({ _id: eventId, ...event }, { session });
        await c('fulfillmentOutbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
        await c('fulfillmentKeys').insertOne({ ...base(req), key, payloadHash, result, ...(purchasedProofHash ? { purchasedProofHash } : {}), ...(result.sourceReceiptIds ? { sourceReceiptIds: result.sourceReceiptIds, salesOrderId: result.salesOrderId } : {}) }, { session });
        await appendFulfillmentReporting(runtime, req, kind, result, session, eventId);
        return result;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' }); }
      catch (error) { if (error?.code === 11000 && attempt < 4) continue; throw error; }
      finally { await session.endSession(); }
    }
  };
  const read = async effect => { const session = runtime.client.startSession(); try { return await session.withTransaction(() => effect(session), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }); } finally { await session.endSession(); } };
  const verifyRead = async (name, req, row, session) => {
    if (name === 'fulfillmentPacking') return row;
    if (name === 'fulfillmentShipments') await validatePurchasedShipment(runtime.db, req.filter, row._id, session);
    else if (name === 'fulfillmentInvoices') { await validatePurchasedInvoice(runtime.db, req.filter, row._id, session); await validateInvoicePosting(runtime.db, req.filter, row, session); }
    else await validatePurchasedPayment(runtime.db, req.filter, row._id, session);
    return row;
  };
  for (const [path, name] of [['shipments', 'fulfillmentShipments'], ['invoices', 'fulfillmentInvoices'], ['payments', 'fulfillmentPayments'], ['packing', 'fulfillmentPacking']]) {
    app.get(`/api/fulfillment/${path}`, async (req, res) => {
      const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
      const filter = { ...req.filter }; if (req.query.cursor !== undefined) filter._id = { $gt: id(req.query.cursor) };
      if (req.query.salesOrderId !== undefined) filter.salesOrderId = id(req.query.salesOrderId);
      res.json(await read(async session => {
        const rows = await c(name).find(filter, { session }).sort({ _id: 1 }).limit(limit + 1).toArray(), data = [];
        for (const row of rows.slice(0, limit)) data.push(await verifyRead(name, req, row, session));
        return { data, page: { limit, nextCursor: rows.length > limit ? data.at(-1)._id : null } };
      }));
    });
    app.get(`/api/fulfillment/${path}/:id`, async (req, res) => res.json({ data: await read(async session => verifyRead(name, req, await find(name, req, req.params.id, session), session)) }));
  }
  app.get('/api/fulfillment/accounts/:id/ledger', async (req, res) => res.json({ data: await read(async session => {
    const account = await find('accounts', req, req.params.id, session), options = { session };
    const invoices = await c('fulfillmentInvoices').find({ ...req.filter, accountId: account._id }, options).sort({ _id: 1 }).limit(101).toArray();
    const deposits = await c('fulfillmentDeposits').find({ ...req.filter, accountId: account._id }, options).sort({ _id: 1 }).limit(101).toArray();
    const complete = invoices.length <= 100 && deposits.length <= 100, at = businessNow(runtime), rows = [], credits = [];
    for (const invoice of invoices.slice(0, 100)) { await verifyRead('fulfillmentInvoices', req, invoice, session); rows.push({ ...invoice, agingBucket: agingBucket(invoice.dueAt, at) }); }
    for (const receipt of deposits.slice(0, 100)) credits.push(await depositState(runtime.db, req.filter, receipt._id, session));
    const buckets = {};
    if (complete) for (const invoice of rows) {
      const currency = invoice.currency, bucket = invoice.agingBucket;
      buckets[currency] ||= { CURRENT: money(0n, scales[currency]), DAYS_1_30: money(0n, scales[currency]), DAYS_31_60: money(0n, scales[currency]), DAYS_61_90: money(0n, scales[currency]), DAYS_91_PLUS: money(0n, scales[currency]), UNDATED: money(0n, scales[currency]) };
      buckets[currency][bucket] = money(minor(buckets[currency][bucket]) + minor(invoice.outstandingAmount), scales[currency]);
    }
    return { accountId: account._id, invoices: rows, deposits: credits, aging: complete ? buckets : null, complete, limit: 100, asOf: at, taxCompliance: 'FIXTURE_ONLY_NOT_STATUTORY' };
  }) }));
  app.post('/api/fulfillment/deposits', async (req, res) => {
    fields(req.body, ['accountId', 'amount', 'currency', 'reference', 'idempotencyKey']);
    id(req.body.accountId); amount(req.body.amount, req.body.currency); const reference = text(req.body.reference);
    const data = await tx(req, 'deposit.recorded', async session => {
      await find('accounts', req, req.body.accountId, session);
      const row = { ...base(req), accountId: req.body.accountId, amount: req.body.amount, currency: req.body.currency, reference, status: 'RECORDED', source: 'OPERATOR_RECORDED', binding: 'ACCOUNT_UNALLOCATED' };
      await c('fulfillmentDeposits').insertOne(row, { session });
      await c('fulfillmentDepositHeads').insertOne({ _id: row._id, ...req.filter, version: 1, allocatedAmount: money(0n, scales[row.currency]), availableAmount: row.amount }, { session }); return row;
    }); res.status(201).json({ data });
  });
  const packingSources = sources => sources.map(source => ({ sourceType: source.sourceType, sourceId: source.sourceId, quantity: decimal(units(source.quantity)), ...(source.serials ? { serials: [...source.serials].sort() } : {}) })).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  app.post('/api/fulfillment/packing', async (req, res) => {
    fields(req.body, ['salesOrderId', 'expectedVersion', 'lineIndex', 'uom', 'sources', 'reference', 'idempotencyKey']);
    const b = req.body; id(b.salesOrderId); version(b.expectedVersion); text(b.reference);
    if (!Number.isSafeInteger(b.lineIndex) || b.lineIndex < 0) fail(400, 'INVALID_LINE');
    const selected = list(b.sources, 100).map(source => {
      fields(source, ['sourceType', 'sourceId', 'quantity', 'serials']); id(source.sourceId); qty(source.quantity);
      if (!['WORK_ORDER', 'RESERVATION'].includes(source.sourceType)) fail(400, 'INVALID_SOURCE');
      if (source.serials !== undefined && (!Array.isArray(source.serials) || source.serials.length > 1000 || new Set(source.serials).size !== source.serials.length || source.serials.some(serial => typeof serial !== 'string'))) fail(400, 'INVALID_SERIALS');
      return source;
    });
    if (new Set(selected.map(source => source.sourceId)).size !== selected.length) fail(400, 'DUPLICATE_SOURCE');
    const data = await tx(req, 'packing.picked', async session => {
      const order = await find('salesOrders', req, b.salesOrderId, session), line = order.snapshot.lines[b.lineIndex];
      if (order.version !== b.expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (order.status !== 'OPEN' || !line || line.uom !== b.uom) fail(409, 'SOURCE_CONFLICT');
      const total = selected.reduce((sum, source) => sum + units(source.quantity), 0n);
      const tally = await c('fulfillmentTallies').findOne({ ...req.filter, kind: 'SO_LINE_SHIPPED', subjectId: order._id, lineIndex: b.lineIndex }, { session });
      if (total + units(tally?.quantity || '0') > units(line.quantity)) fail(409, 'QUANTITY_EXCEEDED');
      for (const part of selected) {
        const source = await find(part.sourceType === 'WORK_ORDER' ? 'manufacturingWorkOrders' : 'warehouseReservations', req, part.sourceId, session);
        if (source.salesOrderId !== order._id || source.lineIndex !== b.lineIndex || source.uom !== b.uom || source.accountId !== order.accountId) fail(409, 'SOURCE_CONFLICT');
        if (part.sourceType === 'WORK_ORDER') {
          if (source.status !== 'QC_COMPLETED' || units(part.quantity) > units(source.qc.acceptedQuantity)) fail(409, 'STATE_CONFLICT');
          if (source.serialized && (!part.serials || BigInt(part.serials.length) * 1000000n !== units(part.quantity) || part.serials.some(serial => !source.qc.acceptedSerials.includes(serial)))) fail(409, 'SERIAL_SOURCE_CONFLICT');
          if (!source.serialized && part.serials !== undefined) fail(400, 'INVALID_SERIALS');
          await requireQualityGates(runtime.db, req.filter, [{ resourceType: 'WORK_ORDER', resourceId: source._id }], session);
        } else if (!['RESERVED', 'PARTIALLY_SHIPPED'].includes(source.status) || units(part.quantity) > units(source.remainingQuantity ?? source.quantity) || part.serials !== undefined) fail(409, 'STATE_CONFLICT');
      }
      const row = { ...base(req), salesOrderId: order._id, accountId: order.accountId, lineIndex: b.lineIndex, uom: b.uom, quantity: decimal(total), sources: packingSources(selected), reference: b.reference.trim(), status: 'PICKED', stockEffect: 'NONE', pickedBy: req.scope.userId, pickedAt: businessNow(runtime) };
      await c('fulfillmentPacking').insertOne(row, { session }); return row;
    }); res.status(201).json({ data });
  });
  app.post('/api/fulfillment/packing/:id/pack', async (req, res) => {
    fields(req.body, ['expectedVersion', 'packageReference', 'idempotencyKey']); version(req.body.expectedVersion); const packageReference = text(req.body.packageReference);
    const data = await tx(req, 'packing.packed', async session => {
      const row = await find('fulfillmentPacking', req, req.params.id, session);
      const order = await find('salesOrders', req, row.salesOrderId, session); await requireUnboundSalesOrder(runtime.db, req.filter, order, session);
      if (row.version !== req.body.expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (row.status !== 'PICKED' || order.status !== 'OPEN') fail(409, 'STATE_CONFLICT');
      const after = await c('fulfillmentPacking').findOneAndUpdate({ ...req.filter, _id: row._id, version: row.version }, { $set: { status: 'PACKED', packageReference, packedBy: req.scope.userId, packedAt: businessNow(runtime) }, $inc: { version: 1 } }, { session, returnDocument: 'after' });
      if (!after) fail(409, 'VERSION_CONFLICT'); return after;
    }); res.json({ data });
  });
  app.get('/api/fulfillment/orders/:id/balances', async (req, res) => {
    res.json({ data: await read(async session => {
    const so = await find('salesOrders', req, req.params.id, session);
    await purchasedReadContext(runtime.db, req.filter, so, session);
    const tallies = await c('fulfillmentTallies').find({ ...req.filter, subjectId: so._id }, { session }).toArray();
    const of = (kind, lineIndex) => tallies.find(t => t.kind === kind && t.lineIndex === lineIndex)?.quantity || '0';
    return { salesOrderId: so._id, currency: so.snapshot.currency, lines: so.snapshot.lines.map((line, lineIndex) => ({ lineIndex, uom: line.uom, orderedQuantity: line.quantity, shippedQuantity: of('SO_LINE_SHIPPED', lineIndex), invoicedQuantity: of('SO_LINE_INVOICED', lineIndex) })) };
    }) });
  });

  app.get('/api/fulfillment/orders/:id/closure', async (req, res) => res.json({ data: await read(async session => {
    const order = await find('salesOrders', req, req.params.id, session);
    await purchasedReadContext(runtime.db, req.filter, order, session);
    const shipments = await c('fulfillmentShipments').find({ ...req.filter, salesOrderId: order._id }, { session }).limit(101).toArray();
    const invoices = await c('fulfillmentInvoices').find({ ...req.filter, salesOrderId: order._id }, { session }).limit(101).toArray();
    if (shipments.length > 100 || invoices.length > 100) return { salesOrderId: order._id, complete: false, status: 'INCOMPLETE', reasons: ['HISTORY_LIMIT'], asOf: businessNow(runtime) };
    const reasons = new Set(), deliveries = [];
    for (const shipment of shipments) {
      const typed = await validatePurchasedShipment(runtime.db, req.filter, shipment._id, session);
      if (!typed) {
        const key = await c('fulfillmentKeys').findOne({ ...req.filter, 'result._id': shipment._id }, { session });
        if (!key || stockHash(shipmentSemantic(key.result)) !== stockHash(shipmentSemantic(shipment))) fail(409, 'DELIVERY_SOURCE_INVALID');
      }
      const original = { shipment, serials: typed?.serials || shipment.sources.flatMap(source => source.serials || []).sort(), sourceHash: await deliverySourceHash(runtime.db, req.filter, shipment, session) };
      const delivered = await readDeliveryState(runtime.db, req.filter, original, session);
      deliveries.push({ shipmentId: shipment._id, status: delivered.head?.status || 'NOT_DELIVERED', deliveredQuantity: delivered.head?.deliveredQuantity || '0', uom: shipment.uom });
      if (delivered.head?.status !== 'DELIVERED') reasons.add('DELIVERY_NOT_CONFIRMED');
      if (await c('fulfillmentReturns').findOne({ ...req.filter, shipmentId: shipment._id }, { session })) reasons.add('QUARANTINED_RETURNS');
    }
    for (const invoice of invoices) {
      await verifyRead('fulfillmentInvoices', req, invoice, session);
      if (minor(invoice.outstandingAmount) !== 0n) reasons.add('OPEN_RECEIVABLE');
      if (invoice.settlementPolicy !== 'IMMUTABLE_POSTING_V1') reasons.add('LEGACY_POSTING_REVIEW');
    }
    const lines = order.snapshot.lines.map((line, lineIndex) => {
      const shipped = shipments.filter(row => row.lineIndex === lineIndex).reduce((sum, row) => sum + units(row.quantity), 0n);
      const invoiced = invoices.flatMap(row => row.lines).filter(row => row.lineIndex === lineIndex).reduce((sum, row) => sum + units(row.quantity), 0n);
      if (shipped > units(line.quantity) || invoiced > units(line.quantity)) fail(409, 'FULFILLMENT_QUANTITY_INVALID');
      if (shipped !== units(line.quantity)) reasons.add('UNSHIPPED_QUANTITY');
      if (invoiced !== units(line.quantity)) reasons.add('UNINVOICED_QUANTITY');
      return { lineIndex, orderedQuantity: line.quantity, shippedQuantity: decimal(shipped), invoicedQuantity: decimal(invoiced), uom: line.uom };
    });
    if (!lines.length) reasons.add('ORDER_LINE_EVIDENCE_REQUIRED');
    return { salesOrderId: order._id, complete: true, status: reasons.size ? 'OPEN_OBLIGATIONS' : 'FULFILLED_EVIDENCED', reasons: [...reasons], lines, deliveries, invoiceCount: invoices.length, asOf: businessNow(runtime), basis: 'SHIPMENT_POD_INVOICE_SETTLEMENT_RETURN_EVIDENCE' };
  }) }));

  app.get('/api/fulfillment/orders/:id/entitlement', async (req, res) => {
    const session = runtime.client.startSession();
    let data;
    try {
      await session.withTransaction(async () => {
        const so = await find('salesOrders', req, req.params.id, session);
        await purchasedReadContext(runtime.db, req.filter, so, session);
        const tallies = await c('fulfillmentTallies').find({ ...req.filter, kind: 'SO_LINE_INVOICED', subjectId: so._id }, { session }).toArray();
        const scale = scales[so.snapshot.currency], vat = fixtureVat(so.snapshot.taxPolicy);
        let authorizedNet = 0n, authorizedTax = 0n, billedNet = 0n, billedTax = 0n;
        const lines = so.snapshot.lines.map((line, lineIndex) => {
          const billedQuantity = tallies.find(t => t.lineIndex === lineIndex)?.quantity || '0';
          const net = extend(units(line.quantity), line.unitPrice), billed = extend(units(billedQuantity), line.unitPrice);
          const tax = vat ? fixtureTax(net) : 0n, usedTax = vat ? fixtureTax(billed) : 0n;
          authorizedNet += net; authorizedTax += tax; billedNet += billed; billedTax += usedTax;
          return { lineIndex, uom: line.uom, orderedQuantity: line.quantity, billedQuantity, authorized: taxAmounts(net, tax, scale), billed: taxAmounts(billed, usedTax, scale), remaining: taxAmounts(net - billed, tax - usedTax, scale) };
        });
        data = { salesOrderId: so._id, sourceVersion: so.version, quoteRevision: so.quoteRevision, currency: so.snapshot.currency, taxPolicy: so.snapshot.taxPolicy, ...(vat ? { taxPolicyVersion: 1 } : {}), lines, authorized: taxAmounts(authorizedNet, authorizedTax, scale), billed: taxAmounts(billedNet, billedTax, scale), remaining: taxAmounts(authorizedNet - billedNet, authorizedTax - billedTax, scale) };
      }, { readConcern: { level: 'snapshot' }, readPreference: 'primary' });
    } finally { await session.endSession(); }
    res.json({ data });
  });

  app.get('/api/fulfillment/orders/:id/reconciliation', async (req, res) => {
    const session = runtime.client.startSession();
    let so, tallies, shipments, moves, purchased;
    try {
      await session.withTransaction(async () => {
        so = await find('salesOrders', req, req.params.id, session);
        const current = await purchasedReadContext(runtime.db, req.filter, so, session);
        if (current) { purchased = await purchasedReconciliation(runtime.db, req.filter, current, session); return; }
        shipments = await c('fulfillmentShipments').find({ ...req.filter, salesOrderId: so._id }, { session }).toArray();
        moves = await c('warehouseMovements').find({ ...req.filter, salesOrderId: so._id, kind: 'SHIP' }, { session }).toArray();
        tallies = await c('fulfillmentTallies').find({ ...req.filter, subjectId: { $in: [so._id, ...moves.map(m => m.sourceId)] } }, { session }).toArray();
      }, { readConcern: { level: 'snapshot' }, readPreference: 'primary' });
    } finally { await session.endSession(); }
    if (purchased) return res.json({ data: purchased });
    const sum = rows => rows.reduce((a, r) => a + units(r.quantity), 0n);
    const lines = so.snapshot.lines.map((line, lineIndex) => {
      const tallied = units(tallies.find(t => t.kind === 'SO_LINE_SHIPPED' && t.subjectId === so._id && t.lineIndex === lineIndex)?.quantity || '0');
      const shipped = sum(shipments.filter(s => s.lineIndex === lineIndex)), moved = sum(moves.filter(m => m.lineIndex === lineIndex));
      return { lineIndex, uom: line.uom, talliedQuantity: decimal(tallied), shipmentQuantity: decimal(shipped), movementQuantity: decimal(moved), matches: tallied === shipped && shipped === moved };
    });
    const sourceIds = [...new Set(moves.map(m => m.sourceId))];
    const sources = sourceIds.map(sourceId => {
      const own = moves.filter(m => m.sourceId === sourceId), tallied = units(tallies.find(t => t.kind === 'SOURCE_SHIPPED' && t.subjectId === sourceId)?.quantity || '0'), moved = sum(own);
      return { sourceType: own[0].sourceType, sourceId, talliedQuantity: decimal(tallied), movementQuantity: decimal(moved), matches: tallied === moved };
    });
    const shipmentsMatch = shipments.every(s => s.stockMovementCount === moves.filter(m => m.shipmentId === s._id).length);
    res.json({ data: { salesOrderId: so._id, lines, sources, shipmentCount: shipments.length, movementCount: moves.length, matches: shipmentsMatch && lines.every(l => l.matches) && sources.every(s => s.matches) } });
  });

  app.post('/api/fulfillment/shipments', async (req, res) => {
    fields(req.body, ['salesOrderId', 'expectedVersion', 'lineIndex', 'uom', 'sources', 'reference', 'packingId', 'expectedPackingVersion', 'handling', 'idempotencyKey']);
    const { salesOrderId, expectedVersion, lineIndex, uom } = req.body;
    id(salesOrderId); version(expectedVersion); const reference = text(req.body.reference);
    if (!Number.isSafeInteger(lineIndex) || lineIndex < 0) fail(400, 'INVALID_LINE');
    const sources = list(req.body.sources, 100).map(s => {
      fields(s, ['sourceType', 'sourceId', 'quantity', 'serials']);
      if (!['WORK_ORDER', 'RESERVATION'].includes(s.sourceType)) fail(400, 'INVALID_SOURCE');
      if (Object.hasOwn(s, 'serials') && (s.sourceType !== 'WORK_ORDER' || !Array.isArray(s.serials) || s.serials.length > 1000 || s.serials.some(v => typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(v)) || new Set(s.serials).size !== s.serials.length)) fail(400, 'INVALID_SERIALS');
      return { sourceType: s.sourceType, sourceId: id(s.sourceId), quantity: s.quantity, amount: qty(s.quantity), ...(Object.hasOwn(s, 'serials') ? { serials: [...s.serials] } : {}) };
    });
    if (new Set(sources.map(s => s.sourceId)).size !== sources.length) fail(400, 'DUPLICATE_SOURCE');
    const data = await tx(req, 'shipment.recorded', async session => {
      const so = await find('salesOrders', req, salesOrderId, session);
      if (so.version !== expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (so.status !== 'OPEN') fail(409, 'STATE_CONFLICT');
      const line = so.snapshot.lines[lineIndex]; if (!line) fail(400, 'INVALID_LINE');
      if (line.uom !== uom) fail(409, 'UOM_CONFLICT');
      let packing;
      if (req.body.packingId !== undefined) {
        packing = await find('fulfillmentPacking', req, req.body.packingId, session);
        if (packing.version !== version(req.body.expectedPackingVersion)) fail(409, 'VERSION_CONFLICT');
        if (packing.status !== 'PACKED' || packing.salesOrderId !== so._id || packing.lineIndex !== lineIndex || packing.uom !== uom || JSON.stringify(packing.sources) !== JSON.stringify(packingSources(sources))) fail(409, 'PACKING_SOURCE_CONFLICT');
      } else if (req.body.expectedPackingVersion !== undefined) fail(400, 'INVALID_PACKING');
      const handling = await requireDispatchResources(runtime.db, req.filter, req.scope.userId, req.body.handling, session, businessNow(runtime));
      const shipmentId = randomUUID();
      for (const s of sources) {
        let receipt;
        if (s.sourceType === 'WORK_ORDER') {
          const wo = await find('manufacturingWorkOrders', req, s.sourceId, session);
          if (wo.salesOrderId !== so._id || wo.lineIndex !== lineIndex) fail(409, 'SOURCE_CONFLICT');
          if (wo.accountId !== so.accountId) fail(409, 'ACCOUNT_CONFLICT');
          await find('accounts', req, so.accountId, session);
          if (wo.status !== 'QC_COMPLETED') fail(409, 'STATE_CONFLICT');
          if (wo.uom !== uom) fail(409, 'UOM_CONFLICT');
          await requireQualityGates(runtime.db, req.filter, [{ resourceType: 'WORK_ORDER', resourceId: wo._id }], session);
          if (wo.serialized) {
            if (!Array.isArray(s.serials)) fail(400, 'INVALID_SERIALS');
            if (BigInt(s.serials.length) * 1000000n !== s.amount) fail(409, 'SERIAL_QUANTITY_CONFLICT');
            if (s.serials.some(serial => !wo.qc.acceptedSerials.includes(serial))) fail(409, 'SERIAL_SOURCE_CONFLICT');
            if (wo.genealogyRequired) s.genealogy = await freezeShipmentGenealogy(runtime.db, wo, s.serials, shipmentId, session);
            if (wo.installationRequired) {
              const currentWo = await find('manufacturingWorkOrders', req, wo._id, session);
              s.installation = await freezeShipmentInstallation(runtime.db, currentWo, s.serials, shipmentId, session);
            }
            const shipped = await c('manufacturingOutputUnits').updateMany({ ...req.filter, workOrderId: wo._id, serial: { $in: s.serials }, status: 'ACCEPTED' }, { $set: { status: 'SHIPPED', shipmentId, shippedBy: req.scope.userId, shippedAt: new Date() }, $inc: { version: 1 } }, { session });
            if (shipped.matchedCount !== s.serials.length) fail(409, 'SERIAL_STATE_CONFLICT');
          } else if (Object.hasOwn(s, 'serials')) fail(400, 'INVALID_SERIALS');
          if (wo.output.materialTrace) s.materialTrace = structuredClone(wo.output.materialTrace);
          await tally(req, 'SOURCE_SHIPPED', wo._id, 0, s.amount, units(wo.qc.acceptedQuantity), session);
        } else {
          const reservation = await find('warehouseReservations', req, s.sourceId, session);
          if (reservation.salesOrderId !== so._id || reservation.lineIndex !== lineIndex) fail(409, 'SOURCE_CONFLICT');
          if (reservation.accountId !== so.accountId) fail(409, 'ACCOUNT_CONFLICT');
          if (!['RESERVED', 'PARTIALLY_SHIPPED'].includes(reservation.status)) fail(409, 'STATE_CONFLICT');
          if (reservation.uom !== uom) fail(409, 'UOM_CONFLICT');
          const consumed = await tally(req, 'SOURCE_SHIPPED', reservation._id, 0, s.amount, units(reservation.quantity), session);
          await c('warehouseReservations').updateOne({ ...req.filter, _id: reservation._id }, { $set: { shippedQuantity: decimal(consumed.after), remainingQuantity: decimal(units(reservation.quantity) - consumed.after), status: consumed.after === units(reservation.quantity) ? 'CONSUMED' : 'PARTIALLY_SHIPPED', updatedAt: new Date() }, $inc: { version: 1 } }, { session });
          receipt = await find('warehouseReceipts', req, reservation.receiptId, session);
          await requireQualityGates(runtime.db, req.filter, [{ resourceType: 'RECEIPT', resourceId: receipt._id }], session);
          await requireLegacyReceipt(runtime.db, receipt, session);
          requireQuantityOnlyReceipt(receipt);
          if (receipt.lotNumber !== undefined) s.materialTrace = { receiptId: receipt._id, lotNumber: receipt.lotNumber, heatNumber: receipt.heatNumber };
          // Shipping draws on the receipt: a hold (new or legacy) blocks it; the reservation itself is left intact.
          await requireEligibleReceipt(runtime.db, receipt, session);
          if (units(receipt.reservedQuantity) < s.amount) fail(409, 'INSUFFICIENT_STOCK');
          const moved = await c('warehouseReceipts').updateOne({ ...req.filter, _id: receipt._id, version: receipt.version }, { $set: { reservedQuantity: decimal(units(receipt.reservedQuantity) - s.amount), shippedQuantity: decimal(units(receipt.shippedQuantity || '0') + s.amount), updatedAt: new Date() }, $inc: { version: 1 } }, { session });
          if (!moved.matchedCount) fail(409, 'VERSION_CONFLICT');
        }
        await c('warehouseMovements').insertOne({ ...base(req), shipmentId, salesOrderId: so._id, accountId: so.accountId, lineIndex, sourceType: s.sourceType, sourceId: s.sourceId, ...(receipt ? { receiptId: receipt._id, reservationId: s.sourceId } : { workOrderId: s.sourceId }), ...(s.serials ? { serials: [...s.serials] } : {}), ...(s.materialTrace ? { materialTrace: structuredClone(s.materialTrace) } : {}), ...(s.genealogy ? { genealogy: structuredClone(s.genealogy) } : {}), ...(s.installation ? { installation: structuredClone(s.installation) } : {}), uom, quantity: decimal(s.amount), kind: 'SHIP', from: receipt ? 'RESERVED' : 'QC_ACCEPTED_OUTPUT', to: 'SHIPPED' }, { session });
      }
      const total = sources.reduce((a, s) => a + s.amount, 0n);
      await tally(req, 'SO_LINE_SHIPPED', so._id, lineIndex, total, units(line.quantity), session);
      const row = { ...base(req), ...(line.provenance ? { provenance: structuredClone(line.provenance) } : {}), _id: shipmentId, salesOrderId: so._id, accountId: so.accountId, lineIndex, uom, quantity: decimal(total), stockMovementCount: sources.length, sources: sources.map(({ amount: _, ...s }) => s), reference, status: 'SHIPPED', dispatchMode: 'OPERATOR_RECORDED', shippedBy: req.scope.userId, shippedAt: businessNow(runtime), ...(runtime.businessClock ? { recordedAt: new Date(), businessClockMode: runtime.businessClockMode } : {}) };
      if (handling) row.handling = handling;
      if (packing) {
        row.packing = { packingId: packing._id, packageReference: packing.packageReference, packedBy: packing.packedBy, packedAt: packing.packedAt };
        const changed = await c('fulfillmentPacking').updateOne({ ...req.filter, _id: packing._id, version: packing.version, status: 'PACKED' }, { $set: { status: 'DISPATCHED', shipmentId }, $inc: { version: 1 } }, { session });
        if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
      }
      await c('fulfillmentShipments').insertOne(row, { session });
      return row;
    }); res.status(201).json({ data });
  });

  app.post('/api/fulfillment/invoices', async (req, res) => {
    fields(req.body, ['salesOrderId', 'expectedVersion', 'lines', 'dueAt', 'idempotencyKey']);
    const { salesOrderId, expectedVersion } = req.body;
    id(salesOrderId); version(expectedVersion);
    if (req.body.dueAt !== undefined && (typeof req.body.dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(req.body.dueAt) || !Number.isFinite(Date.parse(req.body.dueAt)) || new Date(req.body.dueAt).toISOString() !== req.body.dueAt)) fail(400, 'INVALID_DUE_DATE');
    const lines = list(req.body.lines, 100).map(l => { fields(l, ['shipmentId', 'quantity']); return { shipmentId: id(l.shipmentId), quantity: l.quantity, amount: qty(l.quantity) }; });
    if (new Set(lines.map(l => l.shipmentId)).size !== lines.length) fail(400, 'DUPLICATE_SHIPMENT');
    const data = await tx(req, 'invoice.issued', async session => {
      const so = await find('salesOrders', req, salesOrderId, session);
      if (so.version !== expectedVersion) fail(409, 'VERSION_CONFLICT');
      const { currency } = so.snapshot, scale = scales[currency];
      let total = 0n, taxTotal = 0n;
      const vat = fixtureVat(so.snapshot.taxPolicy);
      const invoiceLines = [];
      for (const l of lines) {
        const shipment = await find('fulfillmentShipments', req, l.shipmentId, session);
        if (shipment.salesOrderId !== so._id) fail(409, 'SOURCE_CONFLICT');
        const source = so.snapshot.lines[shipment.lineIndex];
        await tally(req, 'SHIPMENT_INVOICED', shipment._id, 0, l.amount, units(shipment.quantity), session);
        const { before, after } = await tally(req, 'SO_LINE_INVOICED', so._id, shipment.lineIndex, l.amount, units(source.quantity), session);
        // Cumulative rounding keeps the sum of partial invoices equal to the SO line's half-up total.
        const lineAmount = extend(after, source.unitPrice) - extend(before, source.unitPrice);
        const beforeNet = extend(before, source.unitPrice), afterNet = extend(after, source.unitPrice);
        const tax = vat ? fixtureTax(afterNet) - fixtureTax(beforeNet) : 0n;
        total += lineAmount; taxTotal += tax;
        invoiceLines.push({ ...(source.provenance ? { provenance: structuredClone(source.provenance) } : {}), ...(vat ? taxAmounts(lineAmount, tax, scale) : {}), shipmentId: shipment._id, lineIndex: shipment.lineIndex, description: source.description, quantity: l.quantity, uom: shipment.uom, unitPrice: source.unitPrice, currency, amount: money(lineAmount, scale), rounding: { ...(vat ? { sourceVersion: so.version, quoteRevision: so.quoteRevision, taxPolicyVersion: 1, beforeTaxAmount: money(fixtureTax(beforeNet), scale), afterTaxAmount: money(fixtureTax(afterNet), scale), beforeGrossAmount: money(beforeNet + fixtureTax(beforeNet), scale), afterGrossAmount: money(afterNet + fixtureTax(afterNet), scale) } : {}), sourceId: so._id, lineIndex: shipment.lineIndex, beforeQuantity: decimal(before), afterQuantity: decimal(after), beforeAmount: money(extend(before, source.unitPrice), scale), afterAmount: money(extend(after, source.unitPrice), scale) } });
      }
      const financial = vat ? { ...taxAmounts(total, taxTotal, scale), sourceVersion: so.version, quoteRevision: so.quoteRevision, taxRate: '0.11', taxPolicyVersion: 1 } : {};
      total += taxTotal;
      const row = { ...base(req), ...financial, salesOrderId: so._id, accountId: so.accountId, currency, taxPolicy: so.snapshot.taxPolicy, roundingPolicy: so.snapshot.roundingPolicy, lines: invoiceLines, total: money(total, scale), paidAmount: money(0n, scale), outstandingAmount: money(total, scale), allocations: [], status: total ? 'ISSUED' : 'PAID' };
      row.settlementPolicy = 'IMMUTABLE_POSTING_V1'; row.creditedAmount = money(0n, scale);
      if (req.body.dueAt !== undefined) row.dueAt = req.body.dueAt;
      await c('fulfillmentInvoices').insertOne(row, { session });
      return row;
    }); res.status(201).json({ data });
  });

  app.post('/api/fulfillment/payments', async (req, res) => {
    fields(req.body, ['accountId', 'amount', 'currency', 'reference', 'allocations', 'settlementKind', 'depositId', 'expectedDepositVersion', 'creditReason', 'idempotencyKey']);
    const { accountId, currency } = req.body;
    id(accountId); const reference = text(req.body.reference), paid = amount(req.body.amount, currency);
    const settlementKind = req.body.settlementKind || 'CASH';
    if (!['CASH', 'DEPOSIT', 'CREDIT'].includes(settlementKind)) fail(400, 'INVALID_SETTLEMENT_KIND');
    if (settlementKind === 'DEPOSIT') { id(req.body.depositId); version(req.body.expectedDepositVersion); }
    else if (req.body.depositId !== undefined || req.body.expectedDepositVersion !== undefined) fail(400, 'INVALID_DEPOSIT');
    if (settlementKind === 'CREDIT') text(req.body.creditReason);
    else if (req.body.creditReason !== undefined) fail(400, 'INVALID_CREDIT');
    const allocations = list(req.body.allocations, 100).map(a => { fields(a, ['invoiceId', 'expectedVersion', 'amount']); return { invoiceId: id(a.invoiceId), expectedVersion: version(a.expectedVersion), amount: a.amount, value: amount(a.amount, currency) }; });
    if (new Set(allocations.map(a => a.invoiceId)).size !== allocations.length) fail(400, 'DUPLICATE_INVOICE');
    if (allocations.reduce((s, a) => s + a.value, 0n) !== paid) fail(400, 'ALLOCATION_MISMATCH');
    const scale = scales[currency];
    const data = await tx(req, 'payment.recorded', async session => {
      await find('accounts', req, accountId, session);
      if (settlementKind === 'DEPOSIT') await applyDeposit(runtime.db, req.filter, req.body, req.scope.userId, session);
      const paymentId = randomUUID(), applied = [];
      for (const a of allocations) {
        const invoice = await find('fulfillmentInvoices', req, a.invoiceId, session);
        await validateInvoicePosting(runtime.db, req.filter, invoice, session);
        if (invoice.allocations.length >= 100) fail(409, 'FINANCIAL_HISTORY_LIMIT');
        if (settlementKind === 'CREDIT' && invoice.settlementPolicy !== 'IMMUTABLE_POSTING_V1') fail(409, 'IMMUTABLE_INVOICE_POSTING_REQUIRED');
        if (invoice.accountId !== accountId) fail(409, 'ACCOUNT_CONFLICT');
        if (invoice.currency !== currency) fail(409, 'CURRENCY_CONFLICT');
        if (invoice.version !== a.expectedVersion) fail(409, 'VERSION_CONFLICT');
        if (!['ISSUED', 'PARTIALLY_PAID', 'PARTIALLY_SETTLED'].includes(invoice.status)) fail(409, 'STATE_CONFLICT');
        const outstanding = minor(invoice.outstandingAmount) - a.value;
        if (outstanding < 0n) fail(409, 'OVERPAYMENT');
        const credited = minor(invoice.creditedAmount || money(0n, scale)) + (settlementKind === 'CREDIT' ? a.value : 0n);
        const updated = await c('fulfillmentInvoices').findOneAndUpdate({ ...req.filter, _id: invoice._id, version: invoice.version }, { $set: { paidAmount: money(minor(invoice.paidAmount) + (settlementKind === 'CREDIT' ? 0n : a.value), scale), ...(invoice.creditedAmount !== undefined || settlementKind === 'CREDIT' ? { creditedAmount: money(credited, scale) } : {}), outstandingAmount: money(outstanding, scale), status: settlementStatus(outstanding, credited), updatedAt: new Date() }, $inc: { version: 1 }, $push: { allocations: { paymentId, amount: a.amount, currency, at: new Date() } } }, { session, returnDocument: 'after' });
        if (!updated) fail(409, 'VERSION_CONFLICT');
        applied.push({ invoiceId: invoice._id, amount: a.amount, currency, invoiceVersion: updated.version, invoiceStatus: updated.status });
      }
      const row = { ...base(req), _id: paymentId, accountId, amount: req.body.amount, currency, reference, allocations: applied, status: 'RECORDED', source: 'OPERATOR_RECORDED' };
      row.settlementKind = settlementKind;
      if (settlementKind === 'DEPOSIT') row.depositId = req.body.depositId;
      if (settlementKind === 'CREDIT') row.creditReason = req.body.creditReason;
      await c('fulfillmentPayments').insertOne(row, { session });
      return row;
    }); res.status(201).json({ data });
  });
  installManufacturedDispatch(app, runtime, { guard, id, fields, tx, find, tally, base, read });
}
