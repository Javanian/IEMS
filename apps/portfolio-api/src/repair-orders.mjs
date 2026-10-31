import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fixtureVat, fixtureTax, formatMoney, taxAmounts } from './fixture-tax.mjs';
import { stockHash as hash } from './catalog-stock-values.mjs';
import { domainError as fail } from '../../../packages/contracts/src/domains/engineering-repair/gates.mjs';

const scales = { USD: 2, EUR: 2, GBP: 2, IDR: 2, JPY: 0, KWD: 3 };
const active = session => { if (!session?.inTransaction?.()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED'); };
const immutable = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['useFence', 'contentHash'].includes(key)));
const invalid = () => fail(409, 'REPAIR_ORDER_SOURCE_INVALID');

export function validateRepairSnapshot(snapshot) {
  const n = scales[snapshot?.currency];
  if (n === undefined || !['NO_TAX', 'FIXTURE_VAT_11_V1'].includes(snapshot.taxPolicy) || snapshot.roundingPolicy !== 'LINE_HALF_UP' || !Array.isArray(snapshot.lines) || !snapshot.lines.length) fail(409, 'SCOPE_CONFLICT');
  let net = 0n, tax = 0n;
  for (const line of snapshot.lines) {
    if (line.currency !== snapshot.currency || typeof line.unitPrice !== 'string' || !new RegExp(`^(0|[1-9][0-9]{0,27})${n ? `\\.[0-9]{${n}}` : ''}$`).test(line.unitPrice) || typeof line.quantity !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(line.quantity) || !/[1-9]/.test(line.quantity)) fail(409, 'SCOPE_CONFLICT');
    const denominator = 10n ** BigInt(line.quantity.split('.')[1]?.length || 0);
    const product = BigInt(line.quantity.replace('.', '')) * BigInt(line.unitPrice.replace('.', ''));
    const amount = (product * 2n + denominator) / (denominator * 2n), lineTax = fixtureVat(snapshot.taxPolicy) ? fixtureTax(amount) : 0n;
    if (fixtureVat(snapshot.taxPolicy) && Object.entries(taxAmounts(amount, lineTax, n)).some(([key, value]) => line[key] !== value)) fail(409, 'SCOPE_CONFLICT');
    net += amount; tax += lineTax;
  }
  if (snapshot.total !== formatMoney(net + tax, n) || fixtureVat(snapshot.taxPolicy) && (snapshot.taxRate !== '0.11' || snapshot.taxPolicyVersion !== 1 || Object.entries(taxAmounts(net, tax, n)).some(([key, value]) => snapshot[key] !== value))) fail(409, 'SCOPE_CONFLICT');
  return taxAmounts(net, tax, n);
}

export function diagnosticRepairSnapshot(scope, fee) {
  validateRepairSnapshot(scope);
  const n = scales[scope.currency], net = BigInt(fee.replace('.', '')), tax = fixtureVat(scope.taxPolicy) ? fixtureTax(net) : 0n;
  const amounts = taxAmounts(net, tax, n);
  return { currency: scope.currency, total: amounts.grossAmount, ...amounts, taxPolicy: scope.taxPolicy, ...(fixtureVat(scope.taxPolicy) ? { taxRate: '0.11', taxPolicyVersion: 1 } : {}), roundingPolicy: scope.roundingPolicy, lines: [{ description: 'Authorized diagnostic inspection', quantity: '1', uom: 'EA', unitPrice: fee, currency: scope.currency, ...amounts }] };
}

export async function initializeRepairOrders(db) {
  for (const name of ['repairSalesOrders', 'repairWorkOrders']) await db.collection(name).createIndex({ tenantId: 1, plantId: 1, caseId: 1 }, { unique: true });
  await db.collection('repairOrderRevisions').createIndex({ tenantId: 1, plantId: 1, orderId: 1, version: 1 }, { unique: true });
}

export async function readRepairOrders(db, filter, row, session) {
  active(session);
  if (row.serviceProfile !== 'REPAIR_SERVICE_V1') return null;
  if (!row.serviceOrders) fail(409, 'REPAIR_ORDERS_REQUIRED');
  const so = await db.collection('repairSalesOrders').findOne({ ...filter, _id: row.serviceOrders.salesOrderId }, { session });
  const wo = await db.collection('repairWorkOrders').findOne({ ...filter, _id: row.serviceOrders.workOrderId }, { session });
  const plant = await db.collection('plants').findOne({ tenantId: filter.tenantId, _id: filter.plantId, active: true }, { session });
  for (const order of [so, wo]) {
    if (!order || !plant || order.ownerLegalEntityId !== plant.legalEntityId || hash(immutable(order)) !== order.contentHash || order.caseId !== row._id || order.accountId !== row.ownerAccountId || order.assetId !== row.assetId || order.serial !== row.serial || order.scopeHash !== hash(row.scopes.at(-1)) || order.decisionHash !== hash(row.decision)) invalid();
    const revision = await db.collection('repairOrderRevisions').findOne({ ...filter, orderId: order._id, version: order.version }, { session });
    if (!revision || revision.contentHash !== order.contentHash || !isDeepStrictEqual(revision.snapshot, immutable(order))) invalid();
  }
  if (so.workOrderId !== wo._id || wo.salesOrderId !== so._id || so.schema !== 'REPAIR_SERVICE_SO_V1' || wo.schema !== 'REPAIR_SERVICE_WO_V1' || row.serviceOrders.salesOrderHash !== so.contentHash || row.serviceOrders.workOrderHash !== wo.contentHash) invalid();
  return { so, wo };
}

async function save(db, filter, collection, order, session, previous) {
  order.contentHash = hash(immutable(order));
  await db.collection('repairOrderRevisions').insertOne({ _id: randomUUID(), ...filter, orderId: order._id, version: order.version, contentHash: order.contentHash, snapshot: immutable(order) }, { session });
  if (previous) { const result = await db.collection(collection).replaceOne({ ...filter, _id: order._id, version: previous }, order, { session }); if (!result.matchedCount) fail(409, 'VERSION_CONFLICT'); }
  else await db.collection(collection).insertOne(order, { session });
}

export async function createRepairOrders(db, filter, row, actor, now, evidence, session) {
  active(session);
  if (row.serviceProfile !== 'REPAIR_SERVICE_V1' || row.serviceOrders || !['AUTHORIZED', 'REJECTED'].includes(row.status) || !row.decision) fail(409, 'REPAIR_ORDER_STATE_CONFLICT');
  const scope = row.scopes.at(-1), amounts = validateRepairSnapshot(scope.snapshot);
  const plant = await db.collection('plants').findOne({ tenantId: filter.tenantId, _id: filter.plantId, active: true }, { session });
  if (!plant?.legalEntityId) invalid();
  const salesOrderId = randomUUID(), workOrderId = randomUUID(), rejected = row.decision.decision === 'REJECT';
  const common = { ...filter, ownerLegalEntityId: plant.legalEntityId, version: 1, caseId: row._id, accountId: row.ownerAccountId, assetId: row.assetId, serial: row.serial, scopeRevision: scope.revision, quoteId: scope.quoteId, quoteRevision: scope.quoteRevision, scopeHash: hash(scope), decisionHash: hash(row.decision), snapshot: structuredClone(scope.snapshot), ...amounts, currency: row.currency, createdBy: actor, createdAt: now, evidence };
  const so = { ...common, _id: salesOrderId, schema: 'REPAIR_SERVICE_SO_V1', orderType: 'REPAIR_SERVICE', workOrderId, status: rejected ? 'CANCELLED' : 'AUTHORIZED' };
  const wo = { ...common, _id: workOrderId, schema: 'REPAIR_SERVICE_WO_V1', workOrderType: 'REPAIR', salesOrderId, status: rejected ? 'CANCELLED' : 'AUTHORIZED', ...(rejected ? { cancelledBeforeRelease: true } : {}), activities: [] };
  await save(db, filter, 'repairSalesOrders', so, session);
  await save(db, filter, 'repairWorkOrders', wo, session);
  row.serviceOrders = { salesOrderId, workOrderId, salesOrderHash: so.contentHash, workOrderHash: wo.contentHash };
}

export async function advanceRepairOrders(db, filter, row, action, actor, now, session) {
  if (row.serviceProfile !== 'REPAIR_SERVICE_V1') return;
  const { so, wo } = await readRepairOrders(db, filter, row, session);
  if (row.decision.decision !== 'ACCEPT' || ['CANCELLED', 'FULFILLED'].includes(so.status)) invalid();
  const states = { start: 'IN_PROGRESS', execute: 'TESTING', test: row.status, rework: 'TESTING', qc: 'COMPLETED' };
  if (!states[action]) return;
  const previous = wo.version;
  wo.status = states[action]; wo.version++; wo.updatedAt = now;
  wo.activities.push({ _id: randomUUID(), action, caseVersion: row.version + 1, actor, at: now, ...(action === 'test' ? { test: structuredClone(row.tests.at(-1)) } : action === 'rework' ? { rework: structuredClone(row.reworks.at(-1)) } : {}) });
  await save(db, filter, 'repairWorkOrders', wo, session, previous);
  row.serviceOrders.workOrderHash = wo.contentHash;
}

export async function fulfillRepairSalesOrder(db, filter, row, so, now, session) {
  active(session);
  if (row.decision.decision !== 'ACCEPT' || so.status !== 'AUTHORIZED') invalid();
  const previous = so.version;
  so.status = 'FULFILLED'; so.version++; so.fulfilledAt = now;
  await save(db, filter, 'repairSalesOrders', so, session, previous);
  row.serviceOrders.salesOrderHash = so.contentHash;
}
