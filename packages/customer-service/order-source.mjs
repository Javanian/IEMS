import { createHash } from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const quantity = s => typeof s === 'string' && /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(s);
const invalid = () => { throw new Error('STATUS_UNAVAILABLE'); };
const units = s => { const [w, f = ''] = s.split('.'); return BigInt(w) * 1000000n + BigInt(f.padEnd(6, '0')); };
// Customer projection times are truncated to the second; they are milestone facts, not audit timestamps.
const second = d => (d instanceof Date && Number.isFinite(d.getTime()) ? new Date(Math.floor(d.getTime() / 1000) * 1000) : null);
const earliest = dates => { const v = dates.filter(d => d instanceof Date).map(d => d.getTime()); return v.length ? second(new Date(Math.min(...v))) : null; };
// Milestones before the current one are DONE, the current one is CURRENT (DONE when terminal), later ones PENDING with no time.
const milestonesFrom = (sequence, currentCode, terminal) => {
  const index = sequence.findIndex(m => m.code === currentCode);
  return sequence.map((m, i) => ({ code: m.code, label: m.label, at: i <= index ? m.at ?? null : null, state: i < index || (i === index && terminal) ? 'DONE' : i === index ? 'CURRENT' : 'PENDING' }));
};

async function manufactureOrder(db, scope, customerId, orderNumber, opts) {
  const so = await db.collection('salesOrders').findOne({ ...scope, accountId: customerId, orderNumber }, opts);
  if (!so) return null;
  const workOrders = await db.collection('manufacturingWorkOrders').find({ ...scope, accountId: customerId, salesOrderId: so._id }, opts).sort({ _id: 1 }).limit(501).toArray();
  const shipments = await db.collection('fulfillmentShipments').find({ ...scope, accountId: customerId, salesOrderId: so._id }, opts).sort({ _id: 1 }).limit(501).toArray();
  if (workOrders.length > 500 || shipments.length > 500 || !uuid.test(so._id ?? '') || !Number.isSafeInteger(so.version) || so.version < 1) invalid();
  if (!Array.isArray(so.snapshot?.lines) || !so.snapshot.lines.length || so.snapshot.lines.some(l => !quantity(l.quantity) || units(l.quantity) <= 0n || typeof l.uom !== 'string' || !l.uom)) invalid();
  if (workOrders.some(w => !['PLANNED', 'RELEASED', 'IN_PROGRESS', 'QUARANTINED', 'QC_COMPLETED'].includes(w.status) || !Number.isSafeInteger(w.version) || w.version < 1)) invalid();
  // WO revisions and immutable shipment creation advance this aggregate without changing stock authority.
  const sourceVersion = so.version + workOrders.reduce((n, w) => n + w.version, 0) + shipments.length;
  if (!Number.isSafeInteger(sourceVersion)) invalid();
  for (const s of shipments) {
    const line = so.snapshot.lines[s.lineIndex];
    if (!uuid.test(s._id ?? '') || !(s.shippedAt instanceof Date) || !Number.isFinite(s.shippedAt.getTime()) || !Number.isSafeInteger(s.lineIndex) || s.lineIndex < 0 || !line || s.uom !== line.uom || s.status !== 'SHIPPED' || !quantity(s.quantity) || units(s.quantity) <= 0n) invalid();
  }
  const shipped = shipments.length;
  const full = so.snapshot.lines.every((line, lineIndex) => shipments.filter(s => s.lineIndex === lineIndex).reduce((n, s) => n + units(s.quantity), 0n) >= units(line.quantity));
  let publicStage = 'ACCEPTED';
  if (workOrders.length) {
    const statuses = workOrders.map(w => w.status);
    publicStage = statuses.includes('QUARANTINED') ? 'QUALITY_INSPECTION' : statuses.includes('IN_PROGRESS') ? 'PRODUCTION' : statuses.every(s => s === 'QC_COMPLETED') ? 'READY_TO_SHIP' : 'PLANNING';
  }
  if (shipped > 0n) publicStage = full ? 'SHIPPED' : 'PARTIALLY_SHIPPED';
  const sequence = [
    { code: 'ACCEPTED', label: 'Order accepted', at: second(so.createdAt) },
    { code: 'PLANNING', label: 'Production planned', at: earliest(workOrders.map(w => w.createdAt)) },
    { code: 'PRODUCTION', label: 'In production', at: earliest(workOrders.map(w => w.records?.[0]?.recordedAt)) },
    { code: 'QUALITY_INSPECTION', label: 'Quality inspection', at: earliest(workOrders.filter(w => w.output).map(w => w.records?.at(-1)?.recordedAt)) },
    { code: 'READY_TO_SHIP', label: 'Ready to ship', at: earliest(workOrders.map(w => w.qc?.recordedAt)) },
    { code: 'SHIPPED', label: publicStage === 'PARTIALLY_SHIPPED' ? 'Partially shipped' : 'Shipped', at: earliest(shipments.map(s => s.shippedAt)) },
  ];
  return {
    kind: 'MANUFACTURE', orderNumber, publicStage,
    progress: workOrders.length ? { released: workOrders.filter(w => w.status !== 'PLANNED').length, total: workOrders.length } : null,
    milestones: milestonesFrom(sequence, publicStage === 'PARTIALLY_SHIPPED' ? 'SHIPPED' : publicStage, publicStage === 'SHIPPED'),
    // The sales order stores no promised ship date, so none is confirmed.
    confirmedDates: {},
    sourceId: createHash('sha256').update(`${scope.tenantId}:${scope.plantId}:${so._id}`).digest('hex'),
    sourceVersion,
  };
}

const REPAIR_STAGE = { INTAKE: ['RECEIVED', 'RECEIVED'], DIAGNOSIS_AUTHORIZED: ['DIAGNOSIS', 'DIAGNOSIS'], TEARDOWN: ['DIAGNOSIS', 'DIAGNOSIS'], SCOPE_QUOTED: ['AWAITING_APPROVAL', 'AWAITING_APPROVAL'], AUTHORIZED: ['REPAIR', 'APPROVED'], IN_PROGRESS: ['REPAIR', 'REPAIR'], TESTING: ['TESTING', 'TESTING'], REWORK: ['TESTING', 'TESTING'], TEST_PASSED: ['TESTING', 'TESTING'], READY_FOR_RETURN: ['READY_TO_RETURN', 'READY_TO_RETURN'], REJECTED: ['READY_TO_RETURN', 'READY_TO_RETURN'], RETURNED: ['RETURNED', 'RETURNED'] };
async function repairOrder(db, scope, customerId, orderNumber, opts) {
  const row = await db.collection('repairCases').findOne({ ...scope, ownerAccountId: customerId, caseNumber: orderNumber }, opts);
  if (!row) return null;
  if (!uuid.test(row._id ?? '') || !Number.isSafeInteger(row.version) || row.version < 1) invalid();
  const mapped = REPAIR_STAGE[row.status];
  if (!mapped) throw new Error('Unknown repair status');
  const [publicStage, current] = mapped;
  const when = action => earliest((row.history || []).filter(h => h.action === action).map(h => h.createdAt));
  const rejected = row.decision?.decision === 'REJECT';
  const sequence = rejected ? [
    { code: 'RECEIVED', label: 'Received for repair', at: second(row.createdAt) },
    { code: 'DIAGNOSIS', label: 'Diagnosis', at: when('diagnostic-authorize') },
    { code: 'AWAITING_APPROVAL', label: 'Awaiting your approval', at: when('scope') },
    { code: 'READY_TO_RETURN', label: 'Repair declined, ready to return', at: when('decide') },
    { code: 'RETURNED', label: 'Returned unrepaired', at: when('return') },
  ] : [
    { code: 'RECEIVED', label: 'Received for repair', at: second(row.createdAt) },
    { code: 'DIAGNOSIS', label: 'Diagnosis', at: when('diagnostic-authorize') },
    { code: 'AWAITING_APPROVAL', label: 'Awaiting your approval', at: when('scope') },
    { code: 'APPROVED', label: 'Repair approved', at: when('decide') },
    { code: 'REPAIR', label: 'Repair in progress', at: when('start') },
    { code: 'TESTING', label: 'Testing', at: when('execute') },
    { code: 'READY_TO_RETURN', label: 'Ready to return', at: when('qc') },
    { code: 'RETURNED', label: 'Returned', at: when('return') },
  ];
  return {
    kind: 'REPAIR', orderNumber, publicStage, progress: null,
    milestones: milestonesFrom(sequence, current, row.status === 'RETURNED'),
    // Repair cases store no estimated return date, so none is confirmed.
    confirmedDates: {},
    sourceId: createHash('sha256').update(`repair:${scope.tenantId}:${scope.plantId}:${row._id}`).digest('hex'),
    sourceVersion: row.version,
  };
}

// The caller's binding and authorization fences share this source snapshot.
export function createServiceOrderReader({ client, db, now = () => new Date() }) {
  return Object.freeze({
    async readCustomerOrder({ tenantId, plantId, customerId, orderNumber }, { session } = {}) {
      if (![tenantId, plantId, customerId].every(v => typeof v === 'string' && uuid.test(v)) || typeof orderNumber !== 'string' || !/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(orderNumber)) throw new TypeError('Invalid order scope');
      const read = async active => {
        const scope = { tenantId, plantId }, opts = { session: active };
        if (!await db.collection('accounts').findOne({ ...scope, _id: customerId }, opts)) return null;
        const found = orderNumber.startsWith('RP-') ? await repairOrder(db, scope, customerId, orderNumber, opts) : await manufactureOrder(db, scope, customerId, orderNumber, opts);
        return found && { ...found, source: 'PORTFOLIO_API_OWNED', asOf: now() };
      };
      if (session) return read(session);
      const own = client.startSession();
      try { return await own.withTransaction(() => read(own), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }); }
      finally { await own.endSession(); }
    },
  });
}
