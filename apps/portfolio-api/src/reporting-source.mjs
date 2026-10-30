import { randomUUID } from 'node:crypto';
import { boundedTransaction, contentHash } from '../../../packages/tenant-foundation/commands.mjs';
import { appendReportingSnapshot } from '../../../packages/domain-events/snapshot-source.mjs';
import { addDecimals, decimal, uuid } from '../../../packages/domain-events/source-bindings.mjs';

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
    const action = collection === 'salesOrders' ? 'quote.read' : 'fulfillment.read';
    const grant = await foundation.authorizeInTransaction(scope, { tenantId: scope.tenantId, plantId: scope.selectedPlantId ?? scope.plantId, action }, { session });
    scoped(row, grant);
    await authorizeResource({ scope, grant, collection, resource: row, session });
    return grant;
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
  async function fulfillment(scope, receipt, session, observedAt) {
    const grant = await authorized(scope, session, 'fulfillmentKeys', receipt), r = receipt.result;
    if (!r || !uuid.test(r._id) || !Number.isSafeInteger(r.version) || r.version < 1) throw new Error('IMMUTABLE_RESULT_MISSING');
    scoped(r, grant);
    const filter = { tenantId: grant.tenantId, plantId: grant.plantId, subjectId: r._id };
    const audit = await db.collection('fulfillmentAudit').find(filter, { session }).limit(2).toArray();
    if (audit.length !== 1) throw new Error('REGISTERED_SOURCE_KIND_EVIDENCE_MISSING');
    const kind = audit[0].kind;
    if (kind === 'invoice.issued') return []; // Reference evidence, never an order/payment snapshot.
    if (!['shipment.recorded', 'payment.recorded'].includes(kind)) throw new Error('UNREGISTERED_SOURCE_KIND');
    const source = { collection: 'fulfillmentKeys', id: r._id, version: r.version, hash: contentHash(json(r)), eventIds: [], receiptId: receipt._id, sourceOccurredAt: audit[0].occurredAt ? new Date(audit[0].occurredAt).toISOString() : null };
    const targets = [];
    if (kind === 'shipment.recorded') {
      const parent = await requiredOrder(scope, r.salesOrderId, session, observedAt);
      const line = parent.snapshot.lines[r.lineIndex];
      if (!line || line.uom !== r.uom || parent.accountId !== r.accountId || r.status !== 'SHIPPED') throw new Error('SHIPMENT_SOURCE_CONFLICT');
      targets.push({ resourceType: 'fulfillment', resourceId: r._id, eventKey: r._id, data: { orderId: parent._id, quantity: decimal(r.quantity), uom: r.uom, sourceLineIndex: r.lineIndex, deleted: false } });
    } else {
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
  return {
    async initialize() {
      await db.collection('reportingPaymentIdentities').createIndex({ tenantId: 1, plantId: 1, paymentId: 1, orderId: 1 }, { unique: true });
      await db.collection('reportingSourceCoverage').createIndex({ tenantId: 1, plantId: 1, runId: 1 }, { unique: true });
    },
    async reconcileScope({ scope, limit = 1000 }) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('BOUNDED_SOURCE_SCAN_REQUIRED');
      return boundedTransaction(client, async session => {
        const grant = await foundation.authorizeInTransaction(scope, { tenantId: scope.tenantId, plantId: scope.selectedPlantId ?? scope.plantId, action: 'fulfillment.read' }, { session });
        const filter = { tenantId: grant.tenantId, plantId: grant.plantId };
        const orders = await db.collection('salesOrders').find(filter, { session }).sort({ _id: 1 }).limit(limit + 1).toArray();
        const receipts = await db.collection('fulfillmentKeys').find(filter, { session }).sort({ _id: 1 }).limit(limit + 1).toArray();
        if (orders.length + receipts.length > limit) throw new Error('SCOPE_EXCEEDS_BOUNDED_COMPLETE_SCAN');
        const observedAt = new Date().toISOString(), envelopes = [];
        for (const row of orders) envelopes.push(await order(scope, row, session, observedAt));
        for (const row of receipts) envelopes.push(...await fulfillment(scope, row, session, observedAt));
        const resources = [...new Set(envelopes.map(e => e.aggregateId))];
        if (await db.collection('reportingSnapshotHeads').findOne({ ...filter, resourceId: { $nin: resources } }, { session })) throw new Error('MISSING_SOURCE_AUTHORITY_NO_INFERRED_DELETE');
        const manifest = { _id: randomUUID(), ...filter, legalEntityId: grant.legalEntityId, runId: randomUUID(), observedAt, coverage: 'COMPLETE', trustedZero: true, baseline: true, sourceHighWater: { salesOrders: orders.at(-1)?._id ?? null, fulfillmentKeys: receipts.at(-1)?._id ?? null }, sourceHashes: { salesOrders: contentHash(json(orders)), fulfillmentKeys: contentHash(json(receipts)) }, counts: { salesOrders: orders.length, fulfillmentKeys: receipts.length }, quarantine: [], unsupported: [], fence: 'single-snapshot-transaction', validity: 'as-of-observedAt-only' };
        manifest.snapshotHeads = [...new Map(envelopes.map(e => [e.aggregateId, { aggregateId: e.aggregateId, aggregateVersion: e.aggregateVersion, eventId: e.eventId, hash: contentHash(e) }])).values()];
        manifest.hash = contentHash(manifest);
        await db.collection('reportingSourceCoverage').insertOne(manifest, { session });
        return { manifest, envelopes };
      });
    },
    async reconcile({ scope, collection, after = null, limit = 100 }) {
      if (!['salesOrders', 'fulfillmentKeys'].includes(collection) || !Number.isInteger(limit) || limit < 1 || limit > 1000 || (after && !uuid.test(after))) throw new Error('BOUNDED_SOURCE_SCAN_REQUIRED');
      try { return await boundedTransaction(client, async session => {
        const grant = await foundation.authorizeInTransaction(scope, { tenantId: scope.tenantId, plantId: scope.selectedPlantId ?? scope.plantId, action: collection === 'salesOrders' ? 'quote.read' : 'fulfillment.read' }, { session });
        const filter = { tenantId: grant.tenantId, plantId: grant.plantId };
        const rows = await db.collection(collection).find({ ...filter, ...(after ? { _id: { $gt: after } } : {}) }, { session }).sort({ _id: 1 }).limit(limit + 1).toArray();
        const observedAt = new Date().toISOString(), envelopes = [];
        // Any mapping error aborts the page, including its cursor and all parent appends.
        for (const row of rows.slice(0, limit)) {
          if (collection === 'salesOrders') envelopes.push(await order(scope, row, session, observedAt));
          else envelopes.push(...await fulfillment(scope, row, session, observedAt));
        }
        const manifest = { _id: randomUUID(), ...filter, legalEntityId: grant.legalEntityId, runId: randomUUID(), collection, observedAt, after, highWater: rows.slice(0, limit).at(-1)?._id ?? after, nextCursor: rows.length > limit ? rows[limit - 1]._id : null, scanned: Math.min(rows.length, limit), emitted: envelopes.length, coverage: 'INCOMPLETE', trustedZero: false, baseline: true, quarantine: [], unsupported: [], fence: 'snapshot-transaction-page' };
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
