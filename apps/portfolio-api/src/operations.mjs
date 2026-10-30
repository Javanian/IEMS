import { randomUUID } from 'node:crypto';
import { businessNow } from './business-clock.mjs';
import { scopedModule } from './quality.mjs';
import { maintenanceCapacity } from './maintenance.mjs';
import { boundedTransaction, contentHash } from '../../../packages/tenant-foundation/commands.mjs';
import { addDecimals, decimal, uuid } from '../../../packages/domain-events/source-bindings.mjs';
import { minorUnits, formatMinor } from '../../../packages/contracts/src/domains/logistics-billing/values.mjs';
import { validateInvoicePosting } from './purchased-billing-state.mjs';

export const operationsActions = ['operations.read', 'operations.sample'];
export const operationsRoles = { operationsRead: ['operations.read'], operationsTelemetry: operationsActions };
export const reject = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const sources = Object.freeze({
  orders: { collection: 'salesOrders', action: 'quote.read', route: 'sales-orders' },
  production: { collection: 'manufacturingWorkOrders', action: 'manufacturing.read', route: 'manufacturing/work-orders' },
  shipments: { collection: 'fulfillmentShipments', action: 'fulfillment.read', route: 'fulfillment/shipments' },
  invoices: { collection: 'fulfillmentInvoices', action: 'fulfillment.read', route: 'fulfillment/invoices' },
  receipts: { collection: 'warehouseReceipts', action: 'warehouse.read', route: 'warehouse/receipts' },
});
const legacyKinds = ['NFC', 'TIMESHEET', 'HMI', 'SOW', 'SPC'];
export function sampleDecimal(value) {
  if (typeof value!=='string' || !/^-?(0|[1-9]\d{0,25})(\.\d{1,12})?$/.test(value)) reject(400,'EXACT_SAMPLE_DECIMAL_REQUIRED');
  return value;
}
export function exactUtc(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) reject(400, 'UTC_TIMESTAMP_REQUIRED');
  return value;
}
export function freshness(at, now, staleAfterMs = 300000) {
  if (!at) return { status: 'NO_DATA', observedAt: null, ageSeconds: null };
  const time = new Date(at).getTime(), age = now.getTime() - time;
  if (!Number.isFinite(time) || age < 0) return { status: 'INCOMPLETE', observedAt: null, ageSeconds: null };
  return { status: age > staleAfterMs ? 'STALE' : 'CURRENT', observedAt: new Date(time).toISOString(), ageSeconds: Math.floor(age / 1000) };
}
export function quantityBuckets(rows, select) {
  const groups = new Map(); let missing = 0;
  for (const row of rows) for (const q of select(row)) {
    try {
      decimal(q.quantity);
      if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(q.uom)) throw new Error('UOM');
      const g = groups.get(q.uom) || []; g.push(q.quantity); groups.set(q.uom, g);
    } catch { missing++; }
  }
  return { status: missing ? 'INCOMPLETE' : rows.length ? 'AVAILABLE' : 'NO_DATA', missing, buckets: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([uom, values]) => ({ uom, quantity: addDecimals(values) })) };
}
function summary(row, kind, now) {
  const candidate = row.updatedAt || row.createdAt, at = candidate && Number.isFinite(new Date(candidate).getTime()) ? candidate : null;
  const age = at && Number.isFinite(new Date(at).getTime()) && new Date(at) <= now ? Math.floor((now - new Date(at)) / 86400000) : null;
  const stageAt = kind === 'production' ? ({ PLANNED: row.createdAt, RELEASED: row.routing?.releasedAt, IN_PROGRESS: row.records?.[0]?.recordedAt, QUARANTINED: row.records?.at(-1)?.recordedAt, QC_COMPLETED: row.qc?.recordedAt })[row.status] : null;
  const stageAgeDays = stageAt && Number.isFinite(new Date(stageAt).getTime()) && new Date(stageAt) <= now ? Math.floor((now - new Date(stageAt)) / 86400000) : null;
  return { id: row._id, version: row.version ?? null, status: row.status ?? 'UNKNOWN', updatedAt: at ? new Date(at).toISOString() : null,
    ageDays: age, agingBasis: 'LAST_RECORDED_UPDATE', stageEnteredAt: stageAt ? new Date(stageAt).toISOString() : null, stageAgeDays,
    quantity: row.quantity ?? null, uom: row.uom ?? null,
    ...(kind === 'orders' ? { currency: row.snapshot?.currency ?? null, orderAmount: row.snapshot?.total ?? null } : {}),
    ...(kind === 'invoices' ? { currency: row.currency ?? null, outstandingAmount: row.outstandingAmount ?? null, dueAt: row.dueAt ?? null } : {}) };
}
async function grant(runtime, req, action, session) {
  return runtime.foundation.authorizeInTransaction(req.scope, { ...req.filter, action }, { session });
}
export function invoiceBalance(order, invoices, complete = true) {
  const base = { orderId: order.id, currency: order.currency, orderAmount: order.orderAmount, invoiceCount: invoices.length, basis: 'ISSUED_INVOICES_ONLY_EXCLUDES_UNALLOCATED_DEPOSITS' };
  if (!invoices.length || !complete) return { ...base, status: invoices.length ? 'INCOMPLETE' : 'NO_DATA', invoicedAmount: null, paidAmount: null, creditedAmount: null, outstandingAmount: null };
  const sum = field => { try { if (invoices.some(i=>i.currency!==order.currency || i.proofMode!=='IMMUTABLE_POSTING_V1')) return null; return formatMinor(invoices.reduce((n,i)=>n+minorUnits(i[field],order.currency,{zero:true}),0n),order.currency); } catch { return null; } };
  const values = { invoicedAmount: sum('total'), paidAmount: sum('paidAmount'), creditedAmount: sum('creditedAmount'), outstandingAmount: sum('outstandingAmount') };
  return { ...base, ...values, status: Object.values(values).some(v=>v===null) ? 'INCOMPLETE' : 'AVAILABLE' };
}
async function readSource(runtime, req, kind, session, now, after) {
  const spec = sources[kind];
  try { await grant(runtime, req, spec.action, session); }
  catch (e) { if (e.status === 403) return { status: 'ACCESS_DENIED', records: [], total: null, completeness: 'UNKNOWN' }; throw e; }
  const filter = { ...req.filter, ...(after ? { _id: { $gt: after } } : {}) };
  const rows = await runtime.db.collection(spec.collection).find(filter, { session }).sort({ _id: 1 }).limit(101).toArray();
  const more = rows.length > 100, page = rows.slice(0, 100);
  const latest = page.map(r => r.updatedAt || r.createdAt).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
  const quantities = quantityBuckets(page, r => kind === 'orders' ? (r.snapshot?.lines || [{ quantity: null }]).map(l => ({ quantity: l.quantity, uom: l.uom })) : kind === 'invoices' ? [] : [{ quantity: r.quantity, uom: r.uom }]);
  const stageGroups = new Map();
  for (const r of page) {
    const s = summary(r, kind, now), key = s.status;
    const g = stageGroups.get(key) || { stage: key, count: 0, oldestDaysSinceUpdate: null, oldestDaysInStage: null, missingStageTimes: 0 }; g.count++;
    if (s.ageDays !== null) g.oldestDaysSinceUpdate = Math.max(g.oldestDaysSinceUpdate ?? 0, s.ageDays);
    if (s.stageAgeDays !== null) g.oldestDaysInStage = Math.max(g.oldestDaysInStage ?? 0, s.stageAgeDays); else g.missingStageTimes++;
    stageGroups.set(key, g);
  }
  return { status: page.length ? 'AVAILABLE' : 'NO_DATA', source: spec.collection, completeness: more || after ? 'INCOMPLETE' : 'COMPLETE_QUERY', baseline: 'CURRENT_DOMAIN_SNAPSHOT',
    total: await runtime.db.collection(spec.collection).countDocuments(req.filter, { session }), freshness: freshness(latest, now), quantities,
    stages: [...stageGroups.values()], records: page.map(r => summary(r, kind, now)), nextCursor: more ? page.at(-1)._id : null };
}
export async function initializeOperations(db) {
  for (const [name, keys] of [['operationsSamples', { tenantId: 1, plantId: 1, resourceId: 1 }], ['operationsSampleRevisions', { tenantId: 1, plantId: 1, resourceId: 1, version: 1 }], ['operationsKeys', { tenantId: 1, plantId: 1, key: 1 }]]) await db.collection(name).createIndex(keys, { unique: true });
  await db.collection('operationsTelemetryOutbox').createIndex({ publishedAt: 1, tenantId: 1, plantId: 1, resourceId: 1, businessRevision: 1 });
}
// Each adapter is a private, registered read contract. Raw legacy rows never cross this boundary.
export async function legacySnapshot(adapter, { filter, now, session, scope, clock }) {
  if (!adapter || typeof adapter.read !== 'function' || typeof adapter.authorize !== 'function' || !legacyKinds.includes(adapter.kind)) return { status: 'NO_DATA', reason: 'ADAPTER_NOT_CONFIGURED', samples: [] };
  await adapter.authorize({ ...filter, scope, session });
  const result = await adapter.read({ ...filter, scope, session, limit: 100, until: now.toISOString() });
  const checkedAt = clock ? clock() : now;
  if (!result || !Array.isArray(result.samples) || result.samples.length > 100 || !['COMPLETE', 'INCOMPLETE'].includes(result.completeness)) reject(502, 'LEGACY_CONTRACT_INVALID');
  exactUtc(result.observedAt);
  const samples = result.samples.map(s => {
    if (!uuid.test(s.resourceId) || typeof s.sourceRevision !== 'string' || s.sourceRevision.length > 128 || !s.sourceRevision.length) reject(502, 'LEGACY_PROVENANCE_REQUIRED');
    sampleDecimal(s.value); exactUtc(s.sampleAt); exactUtc(s.windowFrom); exactUtc(s.windowUntil);
    if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(s.uom) || s.windowFrom > s.sampleAt || s.sampleAt > s.windowUntil || s.windowUntil > result.observedAt || result.observedAt > checkedAt.toISOString()) reject(502, 'LEGACY_SAMPLE_INVALID');
    return { resourceId: s.resourceId, sourceRevision: s.sourceRevision, value: s.value, uom: s.uom, sampleAt: s.sampleAt, windowFrom: s.windowFrom, windowUntil: s.windowUntil, freshness:freshness(s.sampleAt,checkedAt) };
  });
  const latest=samples.map(s=>s.sampleAt).sort().at(-1);
  return { status: samples.length ? 'AVAILABLE' : 'NO_DATA', completeness: result.completeness, observationFreshness:freshness(result.observedAt,checkedAt), freshness: freshness(latest, checkedAt), samples };
}
export function installOperations(app, runtime, helpers, { legacyAdapters = [], telemetryMappings = {} } = {}) {
  const root = '/api/operations', { id, fields, transaction } = scopedModule(app, runtime, root, 'operations', { ...helpers, guard: async (rt, req, session, action) => {
    await helpers.guard(rt, req, session, action);
    if (action === 'operations.sample') {
      const mapping = telemetryMappings[req.body.mapping];
      if (!mapping || typeof mapping.authorize !== 'function' || typeof mapping.readSample !== 'function') reject(400, 'UNREGISTERED_TELEMETRY_MAPPING');
      await mapping.authorize({ scope: req.scope, filter: req.filter, resourceId: req.params.id, session });
      const sample = await mapping.readSample({ scope: req.scope, filter: req.filter, resourceId: req.params.id, sourceRevision: req.body.sourceRevision, session });
      if (!sample || ['value','uom','sampleAt','windowFrom','windowUntil','sourceRevision'].some(k=>sample[k]!==req.body[k])) reject(409, 'TELEMETRY_SOURCE_MISMATCH');
    }
  } });
  app.get(`${root}/dashboard`, async (req, res) => {
    const data = await boundedTransaction(runtime.client, async session => {
      await grant(runtime, req, 'operations.read', session);
      const now = businessNow(runtime), metrics = {};
      for (const kind of Object.keys(sources)) metrics[kind] = await readSource(runtime, req, kind, session, now);
      const legacy = {};
      for (const kind of legacyKinds) {
        try { legacy[kind] = await legacySnapshot(legacyAdapters.find(a => a.kind === kind), { filter: req.filter, scope: req.scope, now, session, clock:()=>businessNow(runtime) }); }
        catch (e) { if (![403,502].includes(e.status)) throw e; legacy[kind] = { status: e.status === 403 ? 'ACCESS_DENIED' : 'ERROR', reason: e.status === 403 ? 'SOURCE_ACCESS_DENIED' : 'ADAPTER_CONTRACT_INVALID', samples: [] }; }
      }
      const samples = await runtime.db.collection('operationsSamples').find(req.filter, { session }).sort({ sampleAt: -1, resourceId: 1 }).limit(100).toArray();
      const coverage = await runtime.db.collection('reportingSourceCoverage').findOne({ ...req.filter, coverage: 'COMPLETE', fence: 'single-snapshot-transaction' }, { session, sort: { observedAt: -1 } });
      let balances = { status: 'ACCESS_DENIED', rows: [] };
      if (metrics.orders.records.length && metrics.invoices.status !== 'ACCESS_DENIED') {
        await grant(runtime, req, 'fulfillment.read', session);
        const invoices = await runtime.db.collection('fulfillmentInvoices').find({ ...req.filter, salesOrderId: { $in: metrics.orders.records.map(o=>o.id) } }, { session }).limit(101).toArray(), verified = [];
        for (const i of invoices.slice(0,100)) { try { const proof = await validateInvoicePosting(runtime.db,req.filter,i,session); verified.push({ ...i, proofMode: proof.proofMode }); } catch(e) { if(e.status!==409)throw e; verified.push({ ...i,proofMode:'INCOMPLETE' }); } }
        balances = { status: 'AVAILABLE', completeness: invoices.length>100?'INCOMPLETE':'COMPLETE_OBSERVED_INVOICE_SET', rows: metrics.orders.records.map(o=>invoiceBalance(o,verified.filter(i=>i.salesOrderId===o.id),invoices.length<=100)) };
      } else if (!metrics.orders.records.length && metrics.orders.status!=='ACCESS_DENIED') balances={status:'NO_DATA',rows:[]};
      return { schema: 'OPERATIONS_DASHBOARD_V1', observedAt: now.toISOString(), metrics, legacy, balances, telemetry: { status: samples.length ? 'AVAILABLE' : 'NO_DATA', completeness: 'BOUNDED_LATEST_100', samples: samples.map(s=>({ resourceId:s.resourceId,version:s.version,mapping:s.mapping,value:s.value,uom:s.uom,sampleAt:s.sampleAt,windowFrom:s.windowFrom,windowUntil:s.windowUntil,sourceRevision:s.sourceRevision,freshness:freshness(s.sampleAt,now) })) },
        reportingCoverage: coverage ? { status: 'AVAILABLE', observedAt: coverage.observedAt ?? null, manifestId: coverage._id, freshness: freshness(coverage.observedAt, now) } : { status: 'NO_DATA', reason: 'RECONCILED_MANIFEST_NOT_AVAILABLE' },
        warnings: Object.entries(metrics).flatMap(([source, m]) => m.stages?.filter(s => s.oldestDaysSinceUpdate >= 7 && !['COMPLETED', 'CANCELLED', 'CLOSED', 'SHIPPED', 'PAID'].includes(s.stage)).map(s => ({ id: `${source}:${s.stage}`, source, stage: s.stage, reason: 'NO_RECORDED_UPDATE_FOR_7_DAYS', days: s.oldestDaysSinceUpdate })) || []) };
    }); res.json({ data });
  });
  app.get(`${root}/drilldown/:source`, async (req, res) => {
    if (!sources[req.params.source]) reject(404, 'UNKNOWN_METRIC_SOURCE');
    const after = req.query.after ? id(req.query.after) : undefined;
    const data = await boundedTransaction(runtime.client, session => readSource(runtime, req, req.params.source, session, businessNow(runtime), after)); res.json({ data });
  });
  app.get(`${root}/capacity/:id`, async (req, res) => {
    exactUtc(req.query.from); exactUtc(req.query.until);
    const data = await boundedTransaction(runtime.client, async session => {
      await grant(runtime, req, 'operations.read', session); await grant(runtime, req, 'maintenance.read', session); await grant(runtime, req, 'quality.read', session);
      return maintenanceCapacity(runtime.db, req.filter, id(req.params.id), { from: req.query.from, until: req.query.until }, session);
    }); res.json({ data });
  });
  app.get(`${root}/capacity`, async (req, res) => {
    exactUtc(req.query.from); exactUtc(req.query.until);
    const data = await boundedTransaction(runtime.client, async session => {
      await grant(runtime, req, 'operations.read', session); await grant(runtime, req, 'maintenance.read', session); await grant(runtime, req, 'quality.read', session);
      const equipment = await runtime.db.collection('qualityResources').find({ ...req.filter, resourceType: 'EQUIPMENT' }, { session }).sort({ resourceId: 1 }).limit(101).toArray(), rows = [];
      for (const e of equipment.slice(0, 100)) rows.push({ label: e.label || e.resourceId, ...await maintenanceCapacity(runtime.db, req.filter, e.resourceId, { from: req.query.from, until: req.query.until }, session) });
      return { rows, completeness: equipment.length > 100 ? 'INCOMPLETE' : 'COMPLETE_QUERY', from: req.query.from, until: req.query.until };
    }); res.json({ data });
  });
  app.post(`${root}/samples/:id/sample`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'idempotencyKey', 'mapping', 'value', 'uom', 'sampleAt', 'windowFrom', 'windowUntil', 'sourceRevision']);
    const resourceId = id(req.params.id), b = req.body, mapping = telemetryMappings[b.mapping];
    if (!mapping || typeof mapping.authorize !== 'function' || mapping.uom !== b.uom || !/^[A-Z][A-Z0-9_]{0,31}$/.test(b.uom)) reject(400, 'UNREGISTERED_TELEMETRY_MAPPING');
    sampleDecimal(b.value); exactUtc(b.sampleAt); exactUtc(b.windowFrom); exactUtc(b.windowUntil);
    if (b.windowFrom > b.sampleAt || b.sampleAt > b.windowUntil || b.windowUntil > businessNow(runtime).toISOString() || typeof b.sourceRevision !== 'string' || !b.sourceRevision.length || b.sourceRevision.length > 128) reject(400, 'INVALID_SAMPLE');
    const data = await transaction(req, async session => {
      await mapping.authorize({ scope: req.scope, filter: req.filter, resourceId, session });
      const key = { ...req.filter, resourceId }, prior = await runtime.db.collection('operationsSamples').findOne(key, { session });
      if ((prior?.version ?? 0) !== b.expectedVersion) reject(409, 'VERSION_CONFLICT');
      if (prior && ['mapping', 'uom', 'sampleAt', 'windowFrom', 'windowUntil'].some(k => prior[k] !== b[k])) reject(409, 'IMMUTABLE_SAMPLE_IDENTITY');
      if (prior && prior.sourceRevision === b.sourceRevision) reject(409, 'NEW_SOURCE_REVISION_REQUIRED');
      const row = { _id: prior?._id || randomUUID(), ...key, schema: 'OPERATIONS_SAMPLE_V1', version: b.expectedVersion + 1, mapping: b.mapping, value: b.value, uom: b.uom, sampleAt: b.sampleAt, windowFrom: b.windowFrom, windowUntil: b.windowUntil, sourceRevision: b.sourceRevision, updatedAt: businessNow(runtime).toISOString() };
      if (prior) { const r = await runtime.db.collection('operationsSamples').replaceOne({ ...key, version: b.expectedVersion }, row, { session }); if (r.matchedCount !== 1) reject(409, 'VERSION_CONFLICT'); }
      else await runtime.db.collection('operationsSamples').insertOne(row, { session });
      await runtime.db.collection('operationsSampleRevisions').insertOne({ ...row, _id: randomUUID() }, { session });
      // This owner-only outbox is deliberately separate from the financial snapshot transport.
      await runtime.db.collection('operationsTelemetryOutbox').insertOne({ _id: randomUUID(), ...req.filter, type: 'operations.sample.snapshot.v1', resourceId, businessRevision: row.version, occurredAt: row.updatedAt, snapshot: row, publishedAt: null }, { session });
      return row;
    }); res.json({ data });
  });
}

export async function relayOperationsTelemetry({ db, producer, authorize, limit = 100 }) {
  if (typeof authorize !== 'function' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('EXPLICIT_TELEMETRY_PUBLISHER_CONTRACT_REQUIRED');
  const rows = await db.collection('operationsTelemetryOutbox').find({ publishedAt: null }).sort({ tenantId: 1, plantId: 1, resourceId: 1, businessRevision: 1 }).limit(limit).toArray();
  for (const row of rows) {
    await authorize({ tenantId: row.tenantId, plantId: row.plantId, resourceId: row.resourceId, mapping: row.snapshot.mapping });
    if (row.type !== 'operations.sample.snapshot.v1' || row.snapshot.schema !== 'OPERATIONS_SAMPLE_V1') throw new Error('UNREGISTERED_TELEMETRY_EVENT');
    const s = row.snapshot;
    const envelope = { eventId: row._id, schemaVersion: 1, tenantId: row.tenantId, plantId: row.plantId, resourceId: row.resourceId, businessRevision: row.businessRevision, occurredAt: row.occurredAt, type: row.type,
      snapshot: { mapping: s.mapping, value: sampleDecimal(s.value), uom: s.uom, sampleAt: exactUtc(s.sampleAt), windowFrom: exactUtc(s.windowFrom), windowUntil: exactUtc(s.windowUntil), sourceRevision: s.sourceRevision } };
    await producer.send({ topic: 'iems.operations.samples.v1', acks: -1, messages: [{ key: `${row.tenantId}:${row.plantId}:${row.resourceId}`, value: JSON.stringify(envelope) }] });
    await db.collection('operationsTelemetryOutbox').updateOne({ _id: row._id, publishedAt: null }, { $set: { publishedAt: new Date() } });
  }
  return rows.length;
}

const legacyQueries = Object.freeze({
  NFC: { uom:'COUNT', sql:'SELECT COUNT(*)::text AS value FROM public.usernfc WHERE machineid::text = $1' },
  TIMESHEET: { uom:'HOUR', sql:'SELECT SUM(duration)::text AS value, MAX(longdate_checkout) AS sample_at FROM public.timesheet_transaction WHERE workcentercode = $1 AND longdate_checkin >= $2::timestamptz AND longdate_checkout <= $3::timestamptz AND longdate_checkout IS NOT NULL' },
  HMI: { uom:'MS', sql:'SELECT avg_latency_ms::text AS value, checked_at AS sample_at FROM public.mch_machine_ping_log WHERE machineid::text = $1 AND checked_at >= $2::timestamptz AND checked_at <= $3::timestamptz ORDER BY checked_at DESC LIMIT 1' },
  SOW: { uom:'HOUR', sql:'SELECT SUM(planhours)::text AS value, MAX(updated_at) AS sample_at FROM public.sow WHERE workcenter = $1 AND updated_at >= $2::timestamptz AND updated_at <= $3::timestamptz' },
  SPC: { sql:"SELECT replace(trim(pci.value), ',', '.') AS value, pcd.createddate AS sample_at, pp.uom FROM public.processcontroldata_item pci JOIN public.processcontroldata pcd ON pcd.id_processcontroldata = pci.id_processcontroldata JOIN public.process_parameter pp ON pp.id_parameter = pci.id_parameter WHERE pcd.machineid::text = $1 AND pcd.createddate >= $2::timestamptz AND pcd.createddate <= $3::timestamptz AND pci.id_parameter = $4 ORDER BY pcd.createddate DESC, pci.id_processcontroldata_item DESC LIMIT 1" },
});
export function createLegacyReadAdapters({ pool, authorize, resolveBindings, windowMs = 86400000 }) {
  if (typeof pool?.connect !== 'function' || typeof authorize !== 'function' || typeof resolveBindings !== 'function' || !Number.isSafeInteger(windowMs) || windowMs < 60000 || windowMs > 31*86400000) throw new Error('EXPLICIT_LEGACY_SCOPE_BINDINGS_REQUIRED');
  return legacyKinds.map(kind=>({ kind, authorize: context=>authorize({ ...context,kind }), read: async context=>{
    const bindings=await resolveBindings({ ...context,kind });
    if (!Array.isArray(bindings) || bindings.length>100) reject(502,'LEGACY_BINDING_LIMIT');
    if (!bindings.length) return { observedAt:context.until,completeness:'COMPLETE',samples:[] };
    const connection=await pool.connect();
    try {
      await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await connection.query('SET LOCAL statement_timeout = 2000');
      const observed = await connection.query('SELECT transaction_timestamp() AS observed_at');
      const observedAt=new Date(observed.rows[0].observed_at).toISOString(), until=new Date(Math.min(Date.parse(context.until),Date.parse(observedAt))).toISOString(), from=new Date(Date.parse(until)-windowMs).toISOString(), samples=[];
      for (const b of bindings.slice(0,20)) {
        if (!uuid.test(b.resourceId) || typeof b.sourceKey!=='string' || !b.sourceKey.length || b.sourceKey.length>128 || (kind==='SPC' && (!Number.isSafeInteger(b.parameterId)||b.parameterId<1))) reject(502,'INVALID_LEGACY_BINDING');
        const spec=legacyQueries[kind], values=kind==='NFC'?[b.sourceKey]:[b.sourceKey,from,until,...(kind==='SPC'?[b.parameterId]:[])];
        const result=await connection.query(spec.sql,values), row=result.rows[0];
        if (!row || row.value===null || row.value===undefined) continue;
        sampleDecimal(row.value);
        const sampleAt=kind==='NFC'?observedAt:new Date(row.sample_at).toISOString(), uom=spec.uom || b.uom;
        if (kind==='SPC' && (typeof b.sourceUom!=='string' || b.sourceUom!==row.uom || !/^[A-Z][A-Z0-9_]{0,31}$/.test(b.uom))) reject(502,'SPC_UNIT_MAPPING_REQUIRED');
        const full={resourceId:b.resourceId,value:row.value,uom,sampleAt,windowFrom:kind==='NFC'?observedAt:from,windowUntil:kind==='NFC'?observedAt:until};
        samples.push({ ...full, sourceRevision:contentHash({ kind,sourceKey:b.sourceKey,parameterId:b.parameterId??null,...full }) });
      }
      await connection.query('COMMIT');
      return { observedAt, completeness:bindings.length>20?'INCOMPLETE':'COMPLETE',samples };
    } catch (error) { await connection.query('ROLLBACK').catch(()=>{}); if(error.status)throw error;reject(502,'LEGACY_READ_UNAVAILABLE'); }
    finally { connection.release(); }
  } }));
}
