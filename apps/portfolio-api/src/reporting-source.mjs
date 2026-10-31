import { randomUUID } from 'node:crypto';
import { boundedTransaction, contentHash } from '../../../packages/tenant-foundation/commands.mjs';
import { appendReportingSnapshot } from '../../../packages/domain-events/snapshot-source.mjs';
import { addDecimals, decimal, uuid } from '../../../packages/domain-events/source-bindings.mjs';
import { validatePurchasedShipment, validatePurchasedPayment, depositState } from './purchased-financial.mjs';
import { stockHash, stockHashless } from './catalog-stock-values.mjs';
import { shipmentSemantic } from './purchased-stock-proof.mjs';
import { validateEvent } from '../../../packages/domain-events/index.mjs';
import { validateRepairReturnShipment, recheckRepairServiceSources } from './repair-return.mjs';
import { readRepairOrders } from './repair-orders.mjs';

const json = value => JSON.parse(JSON.stringify(value));
const scoped = (row, grant) => {
  if (!row || row.tenantId !== grant.tenantId || row.plantId !== grant.plantId || (row.ownerLegalEntityId && row.ownerLegalEntityId !== grant.legalEntityId) || (row.legalEntityId && row.legalEntityId !== grant.legalEntityId)) throw new Error('SOURCE_SCOPE_DENIED');
  return row;
};
export function orderSnapshot(row, grant) {
  scoped(row, grant);
  const s = row.snapshot;
  if (!s || !Array.isArray(s.lines) || !s.lines.length || !Number.isSafeInteger(row.quoteRevision) || row.quoteRevision < 1) throw new Error('APPROVED_SNAPSHOT_MISSING');
  const groups = new Map();
  s.lines.forEach((line, index) => {
    decimal(line.quantity);
    if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(line.uom)) throw new Error('SOURCE_UOM_MISSING');
    const g = groups.get(line.uom) ?? { uom: line.uom, values: [], sourceLineIndexes: [] };
    g.values.push(line.quantity); g.sourceLineIndexes.push(index); groups.set(line.uom, g);
  });
  return { amount: decimal(s.total), currency: s.currency, quantities: [...groups.values()].sort((a, b) => a.uom.localeCompare(b.uom)).map(g => ({ uom: g.uom, quantity: addDecimals(g.values), sourceLineIndexes: g.sourceLineIndexes })), deleted: false };
}

export function createReportingSource({ db, client, foundation, authorizeResource }) {
  if (typeof authorizeResource !== 'function') throw new Error('EXPLICIT_SOURCE_RESOURCE_AUTHORIZER_REQUIRED');
  async function authorized(scope, session, collection, row) {
    const action = collection === 'salesOrders' ? 'quote.read' : collection.startsWith('repair') ? 'repair.read' : 'fulfillment.read';
    const grant = await foundation.authorizeInTransaction(scope, { tenantId: scope.tenantId, plantId: scope.selectedPlantId ?? scope.plantId, action }, { session });
    scoped(row, grant);
    if (row.revoked === true || row.active === false || row.deleted === true || (Object.hasOwn(row, 'allowedUserIds') && (!Array.isArray(row.allowedUserIds) || !row.allowedUserIds.includes(grant.userId)))) throw new Error('SOURCE_RESOURCE_REVOKED');
    if (await authorizeResource({ scope, grant, collection, resource: row, session }) === false) throw new Error('SOURCE_RESOURCE_DENIED');
    return grant;
  }
  const repairShipment = row => row.sourceKind === 'CUSTOMER_ASSET_RETURN' || row.schema === 'REPAIR_RETURN_SHIPMENT_V1';
  async function unsupportedRepair(scope, shipment, session) {
    const grant = await authorized(scope, session, 'fulfillmentShipments', shipment);
    const filter = { tenantId: grant.tenantId, plantId: grant.plantId };
    if (!uuid.test(shipment._id) || !uuid.test(shipment.caseId) || !uuid.test(shipment.authorityId)) throw new Error('REPAIR_RETURN_SOURCE_INVALID');
    const row = await db.collection('repairCases').findOne({ ...filter, _id: shipment.caseId }, { session });
    await authorized(scope, session, 'repairCases', row);
    const authority = await db.collection('repairReturnAuthorities').findOne({ ...filter, _id: shipment.authorityId }, { session });
    await authorized(scope, session, 'repairReturnAuthorities', authority);
    const original = await validateRepairReturnShipment(db, filter, shipment, session);
    const { so, wo } = await readRepairOrders(db, filter, row, session);
    await authorized(scope, session, 'repairSalesOrders', so);
    await authorized(scope, session, 'repairWorkOrders', wo);
    const receipts = await db.collection('repairKeys').find({ ...filter, 'result._id': row._id, 'result.version': authority.binding.caseVersion, 'result.returnDispatch.shipmentId': shipment._id }, { session }).limit(2).toArray();
    const receipt = receipts[0];
    if (receipts.length !== 1 || !uuid.test(receipt._id) || !/^[a-f0-9]{64}$/.test(receipt.payloadHash) || receipt.result.serviceProfile !== 'REPAIR_SERVICE_V1' || receipt.result.status !== 'RETURNED' || contentHash(json(receipt.result.returnDispatch)) !== contentHash(json(row.returnDispatch))) throw new Error('REPAIR_RETURN_RECEIPT_MISSING_OR_CONFLICT');
    await authorized(scope, session, 'repairKeys', receipt);
    await authorized(scope, session, 'repairCases', receipt.result);
    const audit = await db.collection('repairAudit').find({ ...filter, kind: 'repair.return', subjectId: row._id, subjectVersion: receipt.result.version }, { session }).limit(2).toArray();
    if (audit.length !== 1) throw new Error('REPAIR_RETURN_RECEIPT_MISSING_OR_CONFLICT');
    await authorized(scope, session, 'repairAudit', audit[0]);
    const delivery = await db.collection('deliveryHeads').findOne({ ...filter, _id: shipment._id }, { session });
    if (delivery) await authorized(scope, session, 'deliveryHeads', delivery);
    const confirmations = await db.collection('deliveryConfirmations').find({ ...filter, shipmentId: shipment._id }, { session }).limit(101).toArray();
    for (const confirmation of confirmations) await authorized(scope, session, 'deliveryConfirmations', confirmation);
    if (row.warranty) {
      const invoice = await db.collection('repairInvoices').findOne({ ...filter, _id: row.warranty.invoiceId }, { session });
      await authorized(scope, session, 'repairInvoices', invoice);
    }
    await recheckRepairServiceSources(db, filter, row, session);
    return { collection: 'fulfillmentShipments', id: shipment._id, kind: shipment.sourceKind, schema: shipment.schema, version: shipment.version, hash: original.sourceHash,
      receiptCollection: 'repairKeys', receiptId: receipt._id, receiptHash: contentHash(json(receipt)), eventIds: [audit[0]._id],
      authorityId: authority._id, authorityHash: authority.contentHash, caseId: row._id, repairSalesOrderId: so._id, repairWorkOrderId: wo._id,
      sourceOccurredAt: new Date(shipment.shippedAt).toISOString(), reason: 'VALIDATED_REPAIR_RETURN_NO_REGISTERED_REPORTING_V2_TARGET' };
  }
  async function order(scope, row, session, observedAt) {
    const grant = await authorized(scope, session, 'salesOrders', row);
    const s = json({ snapshot: row.snapshot, accountId: row.accountId, quoteId: row.quoteId, quoteRevision: row.quoteRevision });
    return appendReportingSnapshot({ db, session, grant, resourceType: 'order', resourceId: row._id, eventKey: row._id, mappingVersion: 1, occurredAt: observedAt,
      source: { collection: 'salesOrders', id: row._id, version: row.quoteRevision, hash: contentHash(s), eventIds: [], sourceOccurredAt: row.createdAt ? new Date(row.createdAt).toISOString() : null },
      fullSnapshot: { ...orderSnapshot(row, grant), baseline: true, observedAt } });
  }
  async function requiredOrder(scope, orderId, session, observedAt) {
    if (!uuid.test(orderId)) throw new Error('ORDER_REFERENCE_MISSING');
    const row = await db.collection('salesOrders').findOne({ tenantId: scope.tenantId, plantId: scope.selectedPlantId ?? scope.plantId, _id: orderId }, { session });
    if (!row) throw new Error('ORDER_AUTHORITY_MISSING');
    await order(scope, row, session, observedAt);
    return row;
  }
  async function fulfillment(scope, receipt, session, observedAt, unsupported = [], purchased = false) {
    const grant = await authorized(scope, session, purchased ? 'fulfillmentShipments' : 'fulfillmentKeys', receipt);
    const r = purchased ? shipmentSemantic(receipt) : receipt.result;
    if (!r || !uuid.test(r._id) || !Number.isSafeInteger(r.version) || r.version < 1) throw new Error('IMMUTABLE_RESULT_MISSING');
    scoped(r, grant);
    const filter = { tenantId: grant.tenantId, plantId: grant.plantId, subjectId: r._id };
    const purchaseKeys = purchased ? await db.collection('purchasedFulfillmentKeys').find({ tenantId: grant.tenantId, plantId: grant.plantId, kind: 'SHIPMENT_POSTED', 'result.shipmentId': r._id }, { session }).limit(2).toArray() : [];
    if (purchased && (purchaseKeys.length !== 1 || purchaseKeys[0].result.shipmentHash !== stockHash(r) || purchaseKeys[0].result.salesOrderId !== r.salesOrderId)) throw new Error('PURCHASED_SHIPMENT_RECEIPT_MISSING');
    const audit = purchased
      ? await db.collection('purchasedFulfillmentEvents').find({ tenantId: grant.tenantId, plantId: grant.plantId, kind: 'SHIPMENT_POSTED', salesOrderId: r.salesOrderId, 'snapshot.commandProof.key': purchaseKeys[0].key, 'snapshot.commandProof.resultHash': stockHash(purchaseKeys[0].result) }, { session }).limit(2).toArray()
      : await db.collection('fulfillmentAudit').find(filter, { session }).limit(2).toArray();
    if (audit.length !== 1) throw new Error('REGISTERED_SOURCE_KIND_EVIDENCE_MISSING');
    const kind = purchased ? 'shipment.recorded' : audit[0].kind;
    if (kind === 'invoice.issued') return []; // Reference evidence, never an order/payment snapshot.
    if (kind === 'deposit.recorded') {
      await depositState(db, { tenantId: grant.tenantId, plantId: grant.plantId }, r._id, session);
      unsupported.push({ collection: 'fulfillmentKeys', id: receipt._id, kind, reason: 'ACCOUNT_UNALLOCATED_SEPARATE_DATASET' });
      return [];
    }
    if (['packing.picked', 'packing.packed'].includes(kind)) {
      unsupported.push({ collection: 'fulfillmentKeys', id: receipt._id, kind, reason: 'NON_FINANCIAL_SOURCE_NO_SNAPSHOT_MAPPING' });
      return [];
    }
    if (!['shipment.recorded', 'payment.recorded'].includes(kind)) throw new Error('UNREGISTERED_SOURCE_KIND');
    const source = { collection: purchased ? 'fulfillmentShipments' : 'fulfillmentKeys', id: r._id, version: r.version, hash: contentHash(json(r)), eventIds: [audit[0]._id], receiptId: purchased ? purchaseKeys[0]._id : receipt._id, sourceOccurredAt: new Date(r.shippedAt || r.createdAt).toISOString() };
    const targets = [];
    if (kind === 'shipment.recorded') {
      const shipment = await db.collection('fulfillmentShipments').findOne({ tenantId: grant.tenantId, plantId: grant.plantId, _id: r._id }, { session });
      if (!shipment || contentHash(json(shipmentSemantic(shipment))) !== source.hash) throw new Error('SHIPMENT_IMMUTABLE_RECEIPT_CONFLICT');
      await authorized(scope, session, 'fulfillmentShipments', shipment);
      const parent = await requiredOrder(scope, r.salesOrderId, session, observedAt);
      const line = parent.snapshot.lines[r.lineIndex];
      if (!line || line.uom !== r.uom || parent.accountId !== r.accountId || r.status !== 'SHIPPED') throw new Error('SHIPMENT_SOURCE_CONFLICT');
      const typed = ['PURCHASED_SHIPMENT_V1', 'MANUFACTURED_SHIPMENT_V1'].includes(r.schema);
      if (purchased !== (r.schema === 'PURCHASED_SHIPMENT_V1') || r.schema && !typed) throw new Error('UNREGISTERED_SHIPMENT_SCHEMA');
      if (typed && !await validatePurchasedShipment(db, { tenantId: grant.tenantId, plantId: grant.plantId }, r._id, session)) throw new Error('TYPED_SHIPMENT_AUTHORITY_MISSING');
      const sourceType = r.schema === 'PURCHASED_SHIPMENT_V1' ? ['CATALOG_RESERVATION'] : r.schema === 'MANUFACTURED_SHIPMENT_V1' ? ['COMPANY_OUTPUT'] : ['WORK_ORDER', 'RESERVATION'];
      if (!Array.isArray(r.sources) || !r.sources.length || r.sources.length>100 || r.sources.some(s => !sourceType.includes(s.sourceType) || !uuid.test(s.sourceId)) || addDecimals(r.sources.map(s => s.quantity))!==addDecimals([r.quantity])) throw new Error('SHIPMENT_QUANTITY_PROOF_MISSING');
      targets.push({ resourceType: 'fulfillment', resourceId: r._id, eventKey: r._id, data: { orderId: parent._id, quantity: decimal(r.quantity), uom: r.uom, sourceLineIndex: r.lineIndex, deleted: false } });
    } else {
      const payment = await db.collection('fulfillmentPayments').findOne({ tenantId: grant.tenantId, plantId: grant.plantId, _id: r._id }, { session });
      if (!payment || contentHash(json(payment)) !== source.hash) throw new Error('PAYMENT_IMMUTABLE_RECEIPT_CONFLICT');
      await authorized(scope, session, 'fulfillmentPayments', payment);
      await validatePurchasedPayment(db, { tenantId: grant.tenantId, plantId: grant.plantId }, r._id, session);
      const settlementKind = r.settlementKind ?? 'CASH';
      if (!['CASH', 'DEPOSIT', 'CREDIT'].includes(settlementKind)) throw new Error('UNREGISTERED_SETTLEMENT_KIND');
      Object.assign(source, { settlementKind, cashEffect: settlementKind === 'CASH' ? 'RECEIPT' : 'NONE', balanceEffect: 'RECEIVABLE_REDUCTION' });
      if (settlementKind !== 'CASH') {
        const evidence = await db.collection(settlementKind === 'DEPOSIT' ? 'fulfillmentDepositAllocations' : 'fulfillmentCreditNotes').find({ tenantId: grant.tenantId, plantId: grant.plantId, paymentId: r._id }, { session }).limit(2).toArray();
        const e = evidence[0];
        if (evidence.length !== 1 || stockHash(stockHashless(e)) !== e.contentHash || e.accountId !== r.accountId || e.currency !== r.currency || e.amount !== r.amount || stockHash(e.allocations) !== stockHash(r.allocations) || (settlementKind === 'DEPOSIT' ? e.depositId !== r.depositId : e.reason !== r.creditReason || e.kind !== 'CREDIT_ADJUSTMENT')) throw new Error('SETTLEMENT_AUTHORITY_MISSING');
        await authorized(scope, session, settlementKind === 'DEPOSIT' ? 'fulfillmentDepositAllocations' : 'fulfillmentCreditNotes', e);
        if (settlementKind === 'DEPOSIT') await depositState(db, { tenantId: grant.tenantId, plantId: grant.plantId }, r.depositId, session);
      }
      if (!Array.isArray(r.allocations) || r.allocations.length > 100 || r.status !== 'RECORDED') throw new Error('PAYMENT_ALLOCATION_EVIDENCE_MISSING');
      const groups = new Map(), seen = new Set();
      for (const a of r.allocations) {
        if (!uuid.test(a.invoiceId) || seen.has(a.invoiceId) || a.currency !== r.currency) throw new Error('INVALID_ALLOCATION');
        seen.add(a.invoiceId);
        const invoice = await db.collection('fulfillmentInvoices').findOne({ tenantId: grant.tenantId, plantId: grant.plantId, _id: a.invoiceId }, { session });
        if (!invoice) throw new Error('INVOICE_REFERENCE_MISSING');
        await authorized(scope, session, 'fulfillmentInvoices', invoice);
        if (invoice.currency !== r.currency || invoice.accountId !== r.accountId) throw new Error('PAYMENT_SCOPE_OR_CURRENCY_CONFLICT');
        const parent = await requiredOrder(scope, invoice.salesOrderId, session, observedAt);
        if (parent.accountId !== r.accountId || parent.snapshot.currency !== r.currency) throw new Error('PAYMENT_ORDER_CONFLICT');
        const group = groups.get(parent._id) ?? [];
        group.push(decimal(a.amount)); groups.set(parent._id, group);
      }
      if (addDecimals(r.allocations.map(a => a.amount)) !== addDecimals([r.amount])) throw new Error('PAYMENT_ALLOCATION_CONSERVATION_FAILURE');
      if (!groups.size) throw new Error('UNALLOCATED_PAYMENT_REQUIRES_SEPARATE_DATASET');
      for (const [orderId, amounts] of groups) {
        const identity = { tenantId: grant.tenantId, plantId: grant.plantId, paymentId: r._id, orderId };
        await db.collection('reportingPaymentIdentities').updateOne(identity, { $setOnInsert: { resourceId: randomUUID() } }, { session, upsert: true });
        const saved = await db.collection('reportingPaymentIdentities').findOne(identity, { session });
        targets.push({ resourceType: 'payment', resourceId: saved.resourceId, eventKey: `${r._id}:${orderId}`, data: { orderId, amount: addDecimals(amounts), currency: r.currency, deleted: false } });
      }
    }
    const envelopes = [];
    for (const t of targets) envelopes.push(await appendReportingSnapshot({ db, session, grant, source, ...t, fullSnapshot: { ...t.data, baseline: true, observedAt }, occurredAt: observedAt }));
    return envelopes;
  }
  async function authorizeSnapshot(scope, input, session) {
    const e = validateEvent(input), s = e.payload.source;
    if (e.schemaVersion !== 2 || e.tenantId !== scope.tenantId || e.plantId !== (scope.selectedPlantId ?? scope.plantId)) throw new Error('SOURCE_SCOPE_DENIED');
    const filter = { tenantId: e.tenantId, plantId: e.plantId };
    const stored = await db.collection('reportingSnapshotOutbox').findOne({ ...filter, _id: e.eventId }, { session });
    if (!stored || contentHash(stored.envelope) !== contentHash(e)) throw new Error('IMMUTABLE_REPORTING_EVIDENCE_MISSING');
    if (stored.envelopeHash !== contentHash(e)) throw new Error('IMMUTABLE_REPORTING_EVIDENCE_CORRUPT_OR_UNSEALED');
    let mapped;
    if (s.collection === 'salesOrders') {
      const row = await db.collection('salesOrders').findOne({ ...filter, _id: s.id }, { session });
      mapped = [await order(scope, row, session, e.occurredAt)];
    } else if (s.collection === 'fulfillmentKeys') {
      const rows = await db.collection('fulfillmentKeys').find({ ...filter, 'result._id': s.id }, { session }).limit(2).toArray();
      if (rows.length !== 1) throw new Error('IMMUTABLE_RESULT_MISSING');
      mapped = await fulfillment(scope, rows[0], session, e.occurredAt);
    } else if (s.collection === 'fulfillmentShipments') {
      const row = await db.collection('fulfillmentShipments').findOne({ ...filter, _id: s.id }, { session });
      if (!row || row.schema !== 'PURCHASED_SHIPMENT_V1') throw new Error('UNREGISTERED_SHIPMENT_SCHEMA');
      mapped = await fulfillment(scope, row, session, e.occurredAt, [], true);
    } else throw new Error('UNREGISTERED_DELIVERY_SOURCE');
    if (!mapped.some(value => contentHash(value) === contentHash(e))) throw new Error('SOURCE_SNAPSHOT_REPLAY_CONFLICT');
    return e;
  }
  return {
    authorizeSnapshot: ({ scope, event, session }) => session ? authorizeSnapshot(scope, event, session) : boundedTransaction(client, activeSession => authorizeSnapshot(scope, event, activeSession)),
    async extractCoverage({ scope, runId, limit = 1000 }) {
      if (!uuid.test(runId) || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('BOUNDED_COVERAGE_EXPORT_REQUIRED');
      return boundedTransaction(client, async session => {
        const grant = await foundation.authorizeInTransaction(scope, { tenantId: scope.tenantId, plantId: scope.selectedPlantId ?? scope.plantId, action: 'fulfillment.read' }, { session });
        await foundation.authorizeInTransaction(scope, { tenantId: grant.tenantId, plantId: grant.plantId, action: 'quote.read' }, { session });
        const filter = { tenantId: grant.tenantId, plantId: grant.plantId };
        const manifest = await db.collection('reportingSourceCoverage').findOne({ ...filter, legalEntityId: grant.legalEntityId, runId }, { session });
        if (!manifest || manifest.coverage !== 'INCOMPLETE' || manifest.trustedZero !== false || !Array.isArray(manifest.snapshotHeads)) throw new Error('SUPPORTED_IMMUTABLE_COVERAGE_REQUIRED');
        const { hash, ...body } = manifest;
        if (hash !== contentHash(body) || manifest.snapshotHeads.length > limit) throw new Error('COVERAGE_HASH_OR_BOUND_CONFLICT');
        if (manifest.unsupported.length > limit) throw new Error('COVERAGE_HASH_OR_BOUND_CONFLICT');
        for (const entry of manifest.unsupported.filter(entry => entry.kind === 'CUSTOMER_ASSET_RETURN')) {
          const shipment = await db.collection('fulfillmentShipments').findOne({ ...filter, _id: entry.id }, { session });
          if (!shipment || contentHash(await unsupportedRepair(scope, shipment, session)) !== contentHash(entry)) throw new Error('UNSUPPORTED_SOURCE_AUTHORITY_CHANGED');
        }
        const events = [];
        for (const head of manifest.snapshotHeads) {
          const rows = await db.collection('reportingSnapshotOutbox').find({ ...filter, aggregateId: head.aggregateId, aggregateVersion: { $lte: head.aggregateVersion } }, { session }).sort({ aggregateVersion: 1 }).limit(limit + 1).toArray();
          if (rows.length !== head.aggregateVersion || events.length + rows.length > limit) throw new Error('COVERAGE_REPLAY_GAP_OR_BOUND');
          for (const row of rows) events.push(await authorizeSnapshot(scope, row.envelope, session));
          const last = rows.at(-1)?.envelope;
          if (!last || last.eventId !== head.eventId || contentHash(last) !== head.hash) throw new Error('COVERAGE_HEAD_CONFLICT');
        }
        events.sort((a, b) => Number(a.payload.resourceType !== 'order') - Number(b.payload.resourceType !== 'order') || a.aggregateId.localeCompare(b.aggregateId) || a.aggregateVersion - b.aggregateVersion);
        const ids = new Set(events.map(e => e.aggregateId));
        if (events.some(e => e.payload.resourceType !== 'order' && !ids.has(e.payload.orderId))) throw new Error('COVERAGE_PARENT_MISSING');
        return { manifest, events };
      });
    },
    async initialize() {
      await db.collection('reportingPaymentIdentities').createIndex({ tenantId: 1, plantId: 1, paymentId: 1, orderId: 1 }, { unique: true });
      await db.collection('reportingSourceCoverage').createIndex({ tenantId: 1, plantId: 1, runId: 1 }, { unique: true });
    },
    async reconcileScope({ scope, limit = 1000 }) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('BOUNDED_SOURCE_SCAN_REQUIRED');
      return boundedTransaction(client, async session => {
        const grant = await foundation.authorizeInTransaction(scope, { tenantId: scope.tenantId, plantId: scope.selectedPlantId ?? scope.plantId, action: 'fulfillment.read' }, { session });
        await foundation.authorizeInTransaction(scope, { tenantId: grant.tenantId, plantId: grant.plantId, action: 'quote.read' }, { session });
        const filter = { tenantId: grant.tenantId, plantId: grant.plantId };
        const orders = await db.collection('salesOrders').find(filter, { session }).sort({ _id: 1 }).limit(limit + 1).toArray();
        const receipts = await db.collection('fulfillmentKeys').find(filter, { session }).sort({ _id: 1 }).limit(limit + 1).toArray();
        const authority = {};
        for (const collection of ['fulfillmentShipments', 'fulfillmentPayments', 'fulfillmentInvoices']) authority[collection] = await db.collection(collection).find(filter, { session }).sort({ _id: 1 }).limit(limit + 1).toArray();
        if (orders.length + receipts.length + Object.values(authority).reduce((sum, rows) => sum + rows.length, 0) > limit) throw new Error('SCOPE_EXCEEDS_BOUNDED_COMPLETE_SCAN');
        const observedAt = new Date().toISOString(), envelopes = [], unsupported = [];
        for (const [collection, rows] of Object.entries(authority)) for (const row of rows) {
          await authorized(scope, session, collection, row);
          if (collection === 'fulfillmentShipments' && repairShipment(row)) { unsupported.push(await unsupportedRepair(scope, row, session)); continue; }
          if (collection === 'fulfillmentShipments' && row.schema === 'PURCHASED_SHIPMENT_V1') continue;
          if (receipts.filter(receipt => receipt.result?._id === row._id).length !== 1) throw new Error('SOURCE_AUTHORITY_RECEIPT_MISSING');
        }
        for (const row of orders) envelopes.push(await order(scope, row, session, observedAt));
        for (const row of receipts) envelopes.push(...await fulfillment(scope, row, session, observedAt, unsupported));
        for (const row of authority.fulfillmentShipments.filter(row => row.schema === 'PURCHASED_SHIPMENT_V1')) envelopes.push(...await fulfillment(scope, row, session, observedAt, unsupported, true));
        if (envelopes.length>1000) throw new Error('REPORTING_SCOPE_RESOURCE_BOUND_EXCEEDED');
        const resources = [...new Set(envelopes.map(e => e.aggregateId))];
        if (await db.collection('reportingSnapshotHeads').findOne({ ...filter, resourceId: { $nin: resources } }, { session })) throw new Error('MISSING_SOURCE_AUTHORITY_NO_INFERRED_DELETE');
        const sources = { salesOrders: orders, fulfillmentKeys: receipts, ...authority };
        // These scans reconcile registered cohorts, not every possible source authority dataset.
        const manifest = { _id: randomUUID(), ...filter, legalEntityId: grant.legalEntityId, runId: randomUUID(), observedAt, coverage: 'INCOMPLETE', trustedZero: false, baseline: true, sourceHighWater: Object.fromEntries(Object.entries(sources).map(([name, rows]) => [name, rows.at(-1)?._id ?? null])), sourceHashes: Object.fromEntries(Object.entries(sources).map(([name, rows]) => [name, contentHash(json(rows))])), counts: Object.fromEntries(Object.entries(sources).map(([name, rows]) => [name, rows.length])), quarantine: [], unsupported, coverageReason: 'WHOLE_AUTHORITY_COVERAGE_NOT_PROVEN', fence: 'single-snapshot-transaction', validity: 'as-of-observedAt-only' };
        manifest.snapshotHeads = [...new Map(envelopes.map(e => [e.aggregateId, { aggregateId: e.aggregateId, aggregateVersion: e.aggregateVersion, eventId: e.eventId, hash: contentHash(e) }])).values()];
        manifest.hash = contentHash(manifest);
        await db.collection('reportingSourceCoverage').insertOne(manifest, { session });
        return { manifest, envelopes };
      }).catch(async error => {
        if (error.code === 'COMMIT_OUTCOME_UNKNOWN' || error.code === 11000 || error.hasErrorLabel?.('TransientTransactionError')) throw error;
        await boundedTransaction(client, async session => {
          const grant = await foundation.authorizeInTransaction(scope, { tenantId: scope.tenantId, plantId: scope.selectedPlantId ?? scope.plantId, action: 'fulfillment.read' }, { session });
          await db.collection('reportingSourceQuarantine').insertOne({ _id: randomUUID(), tenantId: grant.tenantId, plantId: grant.plantId, legalEntityId: grant.legalEntityId, collection: 'scope', reason: error.message, observedAt: new Date().toISOString(), cursorAdvanced: false }, { session });
        });
        throw error;
      });
    },
    async reconcile({ scope, collection, after = null, limit = 100 }) {
      if (!['salesOrders', 'fulfillmentKeys', 'fulfillmentShipments'].includes(collection) || !Number.isInteger(limit) || limit < 1 || limit > 1000 || (after && !uuid.test(after))) throw new Error('BOUNDED_SOURCE_SCAN_REQUIRED');
      try { return await boundedTransaction(client, async session => {
        const grant = await foundation.authorizeInTransaction(scope, { tenantId: scope.tenantId, plantId: scope.selectedPlantId ?? scope.plantId, action: collection === 'salesOrders' ? 'quote.read' : 'fulfillment.read' }, { session });
        const filter = { tenantId: grant.tenantId, plantId: grant.plantId };
        const rows = await db.collection(collection).find({ ...filter, ...(after ? { _id: { $gt: after } } : {}) }, { session }).sort({ _id: 1 }).limit(limit + 1).toArray();
        const observedAt = new Date().toISOString(), envelopes = [], unsupported = [];
        // Any mapping error aborts the page, including its cursor and all parent appends.
        for (const row of rows.slice(0, limit)) {
          if (collection === 'salesOrders') envelopes.push(await order(scope, row, session, observedAt));
          else if (collection === 'fulfillmentShipments') {
            if (repairShipment(row)) unsupported.push(await unsupportedRepair(scope, row, session));
            else if (row.schema === 'PURCHASED_SHIPMENT_V1') envelopes.push(...await fulfillment(scope, row, session, observedAt, unsupported, true));
            else {
              await authorized(scope, session, collection, row);
              const keys = await db.collection('fulfillmentKeys').find({ ...filter, 'result._id': row._id }, { session }).limit(2).toArray();
              if (keys.length !== 1) throw new Error('SOURCE_AUTHORITY_RECEIPT_MISSING');
              envelopes.push(...await fulfillment(scope, keys[0], session, observedAt, unsupported));
            }
          } else envelopes.push(...await fulfillment(scope, row, session, observedAt, unsupported));
        }
        const manifest = { _id: randomUUID(), ...filter, legalEntityId: grant.legalEntityId, runId: randomUUID(), collection, observedAt, after, highWater: rows.slice(0, limit).at(-1)?._id ?? after, nextCursor: rows.length > limit ? rows[limit - 1]._id : null, scanned: Math.min(rows.length, limit), emitted: envelopes.length, coverage: 'INCOMPLETE', trustedZero: false, baseline: true, quarantine: [], unsupported: [], fence: 'snapshot-transaction-page' };
        manifest.unsupported = unsupported;
        manifest.hash = contentHash(manifest);
        await db.collection('reportingSourceCoverage').insertOne(manifest, { session });
        return { manifest, envelopes };
      }); } catch (error) {
        if (error.code === 'COMMIT_OUTCOME_UNKNOWN' || error.code === 11000 || error.hasErrorLabel?.('TransientTransactionError')) throw error;
        await boundedTransaction(client, async session => {
          const grant = await foundation.authorizeInTransaction(scope, { tenantId: scope.tenantId, plantId: scope.selectedPlantId ?? scope.plantId, action: collection === 'salesOrders' ? 'quote.read' : 'fulfillment.read' }, { session });
          await db.collection('reportingSourceQuarantine').insertOne({ _id: randomUUID(), tenantId: grant.tenantId, plantId: grant.plantId, legalEntityId: grant.legalEntityId, collection, after, limit, reason: error.message, observedAt: new Date().toISOString(), cursorAdvanced: false }, { session });
        });
        throw error;
      }
    }
  };
}
