import { randomUUID, createHash } from 'node:crypto';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { fixtureVat, fixtureTax, taxAmounts } from './fixture-tax.mjs';
import { requireEligibleReceipt } from './stock-holds.mjs';

const verbs = ['read', 'ship', 'invoice', 'pay'];
export const fulfillmentActions = verbs.map(v => `fulfillment.${v}`);
export const fulfillmentRoles = Object.fromEntries(verbs.map(v => [`fulfillment${v[0].toUpperCase()}${v.slice(1)}`, [...new Set(['fulfillment.read', `fulfillment.${v}`])]]));
export async function initializeFulfillment(db) {
  await db.collection('fulfillmentKeys').createIndex({ tenantId: 1, plantId: 1, key: 1 }, { unique: true });
  await db.collection('fulfillmentTallies').createIndex({ tenantId: 1, plantId: 1, kind: 1, subjectId: 1, lineIndex: 1 }, { unique: true });
}
const scales = { USD: 2, EUR: 2, GBP: 2, IDR: 2, JPY: 0, KWD: 3 };
const units = s => BigInt(s.split('.')[0]) * 1000000n + BigInt((s.split('.')[1] || '').padEnd(6, '0'));
const decimal = n => { const s = n.toString().padStart(7, '0'); return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/0+$/, '').replace(/\.$/, ''); };
const minor = s => BigInt(s.replace('.', ''));
const money = (n, scale) => { const s = n.toString().padStart(scale + 1, '0'); return scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s; };
// Half-up amount in currency minor units for a quantity in millionths at a fixed-scale unit price.
const extend = (quantity, unitPrice) => (quantity * minor(unitPrice) * 2n + 1000000n) / 2000000n;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;

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
    const command = { '/shipments': 'ship', '/invoices': 'invoice', '/payments': 'pay' }[req.path];
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
        const prior = await c('fulfillmentKeys').findOne({ ...req.filter, key }, { session });
        if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT'); return prior.result; }
        const result = await effect(session);
        const event = { ...req.filter, kind, subjectId: result._id, version: result.version, userId: req.scope.userId, occurredAt: new Date() };
        await c('fulfillmentAudit').insertOne({ _id: randomUUID(), ...event }, { session });
        await c('fulfillmentOutbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
        await c('fulfillmentKeys').insertOne({ ...base(req), key, payloadHash, result }, { session });
        return result;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' }); }
      catch (error) { if (error?.code === 11000 && attempt < 4) continue; throw error; }
      finally { await session.endSession(); }
    }
  };
  for (const [path, name] of [['shipments', 'fulfillmentShipments'], ['invoices', 'fulfillmentInvoices'], ['payments', 'fulfillmentPayments']]) {
    app.get(`/api/fulfillment/${path}`, async (req, res) => {
      const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
      const filter = { ...req.filter }; if (req.query.cursor !== undefined) filter._id = { $gt: id(req.query.cursor) };
      const rows = await c(name).find(filter).sort({ _id: 1 }).limit(limit + 1).toArray(), data = rows.slice(0, limit);
      res.json({ data, page: { limit, nextCursor: rows.length > limit ? data.at(-1)._id : null } });
    });
    app.get(`/api/fulfillment/${path}/:id`, async (req, res) => res.json({ data: await find(name, req, req.params.id) }));
  }
  app.get('/api/fulfillment/orders/:id/balances', async (req, res) => {
    const so = await find('salesOrders', req, req.params.id);
    const tallies = await c('fulfillmentTallies').find({ ...req.filter, subjectId: so._id }).toArray();
    const of = (kind, lineIndex) => tallies.find(t => t.kind === kind && t.lineIndex === lineIndex)?.quantity || '0';
    res.json({ data: { salesOrderId: so._id, currency: so.snapshot.currency, lines: so.snapshot.lines.map((line, lineIndex) => ({ lineIndex, uom: line.uom, orderedQuantity: line.quantity, shippedQuantity: of('SO_LINE_SHIPPED', lineIndex), invoicedQuantity: of('SO_LINE_INVOICED', lineIndex) })) } });
  });

  app.get('/api/fulfillment/orders/:id/entitlement', async (req, res) => {
    const session = runtime.client.startSession();
    let data;
    try {
      await session.withTransaction(async () => {
        const so = await find('salesOrders', req, req.params.id, session);
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
    const so = await find('salesOrders', req, req.params.id);
    const session = runtime.client.startSession();
    let tallies, shipments, moves;
    try {
      await session.withTransaction(async () => {
        shipments = await c('fulfillmentShipments').find({ ...req.filter, salesOrderId: so._id }, { session }).toArray();
        moves = await c('warehouseMovements').find({ ...req.filter, salesOrderId: so._id, kind: 'SHIP' }, { session }).toArray();
        tallies = await c('fulfillmentTallies').find({ ...req.filter, subjectId: { $in: [so._id, ...moves.map(m => m.sourceId)] } }, { session }).toArray();
      }, { readConcern: { level: 'snapshot' }, readPreference: 'primary' });
    } finally { await session.endSession(); }
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
    fields(req.body, ['salesOrderId', 'expectedVersion', 'lineIndex', 'uom', 'sources', 'reference', 'idempotencyKey']);
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
          if (wo.serialized) {
            if (!Array.isArray(s.serials)) fail(400, 'INVALID_SERIALS');
            if (BigInt(s.serials.length) * 1000000n !== s.amount) fail(409, 'SERIAL_QUANTITY_CONFLICT');
            if (s.serials.some(serial => !wo.qc.acceptedSerials.includes(serial))) fail(409, 'SERIAL_SOURCE_CONFLICT');
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
          if (receipt.lotNumber !== undefined) s.materialTrace = { receiptId: receipt._id, lotNumber: receipt.lotNumber, heatNumber: receipt.heatNumber };
          // Shipping draws on the receipt: a hold (new or legacy) blocks it; the reservation itself is left intact.
          await requireEligibleReceipt(runtime.db, receipt, session);
          if (units(receipt.reservedQuantity) < s.amount) fail(409, 'INSUFFICIENT_STOCK');
          const moved = await c('warehouseReceipts').updateOne({ ...req.filter, _id: receipt._id, version: receipt.version }, { $set: { reservedQuantity: decimal(units(receipt.reservedQuantity) - s.amount), shippedQuantity: decimal(units(receipt.shippedQuantity || '0') + s.amount), updatedAt: new Date() }, $inc: { version: 1 } }, { session });
          if (!moved.matchedCount) fail(409, 'VERSION_CONFLICT');
        }
        await c('warehouseMovements').insertOne({ ...base(req), shipmentId, salesOrderId: so._id, accountId: so.accountId, lineIndex, sourceType: s.sourceType, sourceId: s.sourceId, ...(receipt ? { receiptId: receipt._id, reservationId: s.sourceId } : { workOrderId: s.sourceId }), ...(s.serials ? { serials: [...s.serials] } : {}), ...(s.materialTrace ? { materialTrace: structuredClone(s.materialTrace) } : {}), uom, quantity: decimal(s.amount), kind: 'SHIP', from: receipt ? 'RESERVED' : 'QC_ACCEPTED_OUTPUT', to: 'SHIPPED' }, { session });
      }
      const total = sources.reduce((a, s) => a + s.amount, 0n);
      await tally(req, 'SO_LINE_SHIPPED', so._id, lineIndex, total, units(line.quantity), session);
      const row = { ...base(req), ...(line.provenance ? { provenance: structuredClone(line.provenance) } : {}), _id: shipmentId, salesOrderId: so._id, accountId: so.accountId, lineIndex, uom, quantity: decimal(total), stockMovementCount: sources.length, sources: sources.map(({ amount: _, ...s }) => s), reference, status: 'SHIPPED', dispatchMode: 'OPERATOR_RECORDED', shippedBy: req.scope.userId, shippedAt: new Date() };
      await c('fulfillmentShipments').insertOne(row, { session });
      return row;
    }); res.status(201).json({ data });
  });

  app.post('/api/fulfillment/invoices', async (req, res) => {
    fields(req.body, ['salesOrderId', 'expectedVersion', 'lines', 'idempotencyKey']);
    const { salesOrderId, expectedVersion } = req.body;
    id(salesOrderId); version(expectedVersion);
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
      await c('fulfillmentInvoices').insertOne(row, { session });
      return row;
    }); res.status(201).json({ data });
  });

  app.post('/api/fulfillment/payments', async (req, res) => {
    fields(req.body, ['accountId', 'amount', 'currency', 'reference', 'allocations', 'idempotencyKey']);
    const { accountId, currency } = req.body;
    id(accountId); const reference = text(req.body.reference), paid = amount(req.body.amount, currency);
    const allocations = list(req.body.allocations, 100).map(a => { fields(a, ['invoiceId', 'expectedVersion', 'amount']); return { invoiceId: id(a.invoiceId), expectedVersion: version(a.expectedVersion), amount: a.amount, value: amount(a.amount, currency) }; });
    if (new Set(allocations.map(a => a.invoiceId)).size !== allocations.length) fail(400, 'DUPLICATE_INVOICE');
    if (allocations.reduce((s, a) => s + a.value, 0n) !== paid) fail(400, 'ALLOCATION_MISMATCH');
    const scale = scales[currency];
    const data = await tx(req, 'payment.recorded', async session => {
      await find('accounts', req, accountId, session);
      const paymentId = randomUUID(), applied = [];
      for (const a of allocations) {
        const invoice = await find('fulfillmentInvoices', req, a.invoiceId, session);
        if (invoice.accountId !== accountId) fail(409, 'ACCOUNT_CONFLICT');
        if (invoice.currency !== currency) fail(409, 'CURRENCY_CONFLICT');
        if (invoice.version !== a.expectedVersion) fail(409, 'VERSION_CONFLICT');
        if (!['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status)) fail(409, 'STATE_CONFLICT');
        const outstanding = minor(invoice.outstandingAmount) - a.value;
        if (outstanding < 0n) fail(409, 'OVERPAYMENT');
        const updated = await c('fulfillmentInvoices').findOneAndUpdate({ ...req.filter, _id: invoice._id, version: invoice.version }, { $set: { paidAmount: money(minor(invoice.paidAmount) + a.value, scale), outstandingAmount: money(outstanding, scale), status: outstanding ? 'PARTIALLY_PAID' : 'PAID', updatedAt: new Date() }, $inc: { version: 1 }, $push: { allocations: { paymentId, amount: a.amount, currency, at: new Date() } } }, { session, returnDocument: 'after' });
        if (!updated) fail(409, 'VERSION_CONFLICT');
        applied.push({ invoiceId: invoice._id, amount: a.amount, currency, invoiceVersion: updated.version, invoiceStatus: updated.status });
      }
      const row = { ...base(req), _id: paymentId, accountId, amount: req.body.amount, currency, reference, allocations: applied, status: 'RECORDED', source: 'OPERATOR_RECORDED' };
      await c('fulfillmentPayments').insertOne(row, { session });
      return row;
    }); res.status(201).json({ data });
  });
}
