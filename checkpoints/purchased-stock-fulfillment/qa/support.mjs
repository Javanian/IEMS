import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { allSnapshot, denied, restoreRow } from '../../quote-catalog-entitlement/qa/support.mjs';

export { startOwned, allSnapshot, denied, restoreRow };
export const command = values => ({ expectedVersion: 1, reason: 'Independent purchased fulfillment custody evidence', idempotencyKey: randomUUID(), ...values });
export const orderPath = order => `/purchased-fulfillment/orders/${typeof order === 'string' ? order : order._id}`;
export const stockPath = receipt => `/catalog-stock/receipts/${typeof receipt === 'string' ? receipt : receipt._id}`;

export async function guardedReplay(h, effect, guardCalls, cookie = h.alpha) {
  assert.ok(Number.isSafeInteger(guardCalls) && guardCalls >= 1 && guardCalls <= 3);
  const scope = await h.scopeOf(cookie), expected = await allSnapshot(h);
  const tokenHash = createHash('sha256').update(cookie.slice('portfolio_session='.length)).digest('hex');
  const plant = expected.plants.find(row => row._id === scope.selectedPlantId && row.tenantId === scope.tenantId); assert.ok(plant);
  const targets = {
    sessions: row => row.tokenHash === tokenHash,
    memberships: row => row._id === scope.membershipId && row.tenantId === scope.tenantId,
    users: row => row._id === scope.userId,
    tenants: row => row._id === scope.tenantId,
    plants: row => row._id === scope.selectedPlantId && row.tenantId === scope.tenantId,
    legalEntities: row => row._id === plant.legalEntityId && row.tenantId === scope.tenantId,
  };
  for (const [name, predicate] of Object.entries(targets)) {
    const rows = expected[name].filter(predicate); assert.equal(rows.length, 1);
    const before = rows[0].crmFence ?? 0; assert.ok(Number.isSafeInteger(before) && before >= 0);
    rows[0].crmFence = before + guardCalls;
  }
  const result = await effect();
  assert.deepEqual(await allSnapshot(h), expected, `Replay may advance only the six exact authorization crmFence fields by ${guardCalls}`);
  return result;
}

export async function makeItem(h, { prefix, suffix, kind = 'PURCHASED', trackingPolicy = 'LOT', uom = 'KG', cookie = h.alpha }) {
  const draft = await h.ok('/inventory-master/items', command({ code: `${prefix}_${suffix}`, description: `Independent purchased fulfillment ${suffix}`, kind, uom, schema: 'INVENTORY_ITEM_V2', trackingPolicy }), 201, cookie);
  return h.ok(`/inventory-master/items/${draft._id}/approve`, command({ expectedVersion: draft.version, revision: draft.currentRevision }), 200, cookie);
}

export async function makeLocation(h, prefix, cookie = h.alpha) {
  const bin = await h.ok('/warehouse/bins', { expectedVersion: 1, code: `${prefix}_BIN`, idempotencyKey: randomUUID() }, 201, cookie);
  const draft = await h.ok('/inventory-master/locations', command({ code: `${prefix}_LOC`, binId: bin._id }), 201, cookie);
  const location = await h.ok(`/inventory-master/locations/${draft._id}/qualify`, command({ expectedVersion: draft.version }), 200, cookie);
  return { bin, location };
}

export async function makeSalesOrder(h, account, entries, cookie = h.alpha) {
  const lines = entries.map(({ item, quantity, unitPrice = '0.05' }) => ({ description: 'Customer prose does not establish source identity', quantity, uom: item.content.uom, unitPrice, currency: 'USD', catalogItem: { itemId: item._id, itemVersion: item.version, itemRevision: item.currentRevision } }));
  let quote = await h.ok('/commercial/quotes', { schema: 'CATALOG_QUOTE_V1', accountId: account._id, expiresAt: new Date(Date.now() + 86400000).toISOString(), taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines, idempotencyKey: randomUUID() }, 201, cookie);
  for (const action of ['approve', 'accept']) quote = await h.ok(`/commercial/quotes/${quote._id}/${action}`, { expectedVersion: quote.version, revision: quote.revisions.at(-1).number, idempotencyKey: randomUUID() }, 200, cookie);
  const salesOrder = await h.ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: quote.version, revision: quote.revisions.at(-1).number, idempotencyKey: randomUUID() }, 200, cookie);
  return { quote, salesOrder };
}

export async function makePurchasedFixture(h, { lotQuantity = '7.500001', lotDemand = '2.500001', serialCount = 6, rejectedSerialCount = 1, serialDemand = '3', includeManufactured = false, cookie = h.alpha } = {}) {
  assert.ok(Number.isSafeInteger(serialCount) && serialCount >= 3 && serialCount <= 100);
  assert.ok(Number.isSafeInteger(rejectedSerialCount) && rejectedSerialCount >= 0 && rejectedSerialCount < serialCount);
  const prefix = `QA_PSF_${randomUUID().slice(0, 8).toUpperCase()}`;
  const lotItem = await makeItem(h, { prefix, suffix: 'LOT', cookie });
  const serialItem = await makeItem(h, { prefix, suffix: 'SERIAL', trackingPolicy: 'SERIAL', uom: 'UN', cookie });
  const outputItem = await makeItem(h, { prefix, suffix: 'OUTPUT', kind: 'MANUFACTURED', trackingPolicy: 'SERIAL', uom: 'UN', cookie });
  const { location, bin } = await makeLocation(h, prefix, cookie);
  const vendor = await h.ok('/procurement/vendors', { name: `${prefix} actual supplier` }, 201, cookie);
  const specs = [{ item: lotItem, quantity: lotQuantity }, { item: serialItem, quantity: String(serialCount) }];
  let request = await h.ok('/catalog-procurement/requests', command({ vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: specs.map(({ item, quantity }) => ({ itemId: item._id, itemVersion: item.version, itemRevision: item.currentRevision, quantity, unitPrice: '1.00', currency: 'USD' })) }), 201, cookie);
  request = await h.ok(`/catalog-procurement/requests/${request._id}/approve`, command({ expectedVersion: request.version, revision: request.currentRevision }), 200, cookie);
  let purchaseOrder = await h.ok(`/catalog-procurement/requests/${request._id}/convert`, command({ expectedVersion: request.version }), 200, cookie);
  purchaseOrder = await h.ok(`/catalog-procurement/orders/${purchaseOrder._id}/issue`, command({ expectedVersion: purchaseOrder.version }), 200, cookie);
  const serials = Array.from({ length: serialCount }, (_, index) => `${prefix}_REAL_SERIAL_${index + 1}`);
  async function receive(item, quantity, identities) {
    const receipt = await h.ok('/catalog-procurement/receipts', command({ expectedVersion: purchaseOrder.version, purchaseOrderId: purchaseOrder._id, vendorId: vendor._id, lineId: purchaseOrder.content.lines.find(line => line.itemId === item._id).lineId, quantity, ...(identities ? { serials: identities } : { lotNumber: `${prefix}_ACTUAL_LOT`, heatNumber: `${prefix}_ACTUAL_HEAT` }) }), 201, cookie);
    const path = `/catalog-disposition/receipts/${receipt._id}`;
    let qc = await h.ok(path, undefined, 200, cookie);
    const acceptedSerials = identities?.slice(0, identities.length - rejectedSerialCount), rejectedSerials = identities?.slice(identities.length - rejectedSerialCount);
    qc = await h.ok(`${path}/inspections`, command({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, acceptedQuantity: identities ? String(acceptedSerials.length) : quantity, rejectedQuantity: identities ? String(rejectedSerials.length) : '0', evidence: 'Independent actual purchased receipt inspection', ...(identities ? { acceptedSerials, rejectedSerials } : {}) }), 200, cookie);
    qc = await h.ok(`${path}/approve`, command({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, revision: qc.currentRevision }), 200, cookie);
    await h.ok(`${path}/putaway`, command({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, locationId: location._id, expectedLocationVersion: location.version }), 200, cookie);
    return receipt;
  }
  const lotReceipt = await receive(lotItem, lotQuantity), serialReceipt = await receive(serialItem, String(serialCount), serials);
  const account = await h.ok('/crm/accounts', { name: `${prefix} actual customer` }, 201, cookie);
  const entries = [{ item: lotItem, quantity: lotDemand }, { item: serialItem, quantity: serialDemand }, ...(includeManufactured ? [{ item: outputItem, quantity: '1' }] : [])];
  const { quote, salesOrder } = await makeSalesOrder(h, account, entries, cookie);
  return { prefix, lotItem, serialItem, outputItem, location, bin, vendor, purchaseOrder, account, quote, salesOrder, lotReceipt, serialReceipt, serials, acceptedSerials: serials.slice(0, serialCount - rejectedSerialCount), rejectedSerials: serials.slice(serialCount - rejectedSerialCount), lotQuantity, lotDemand, serialDemand };
}

export async function reservationBody(h, salesOrder, receipt, lineIndex, quantity, unitIds) {
  const view = await h.ok(orderPath(salesOrder)), stock = await h.ok(stockPath(receipt));
  return command({ expectedVersion: view.version, expectedSalesOrderVersion: view.salesOrder.version, lineIndex, receiptId: stock.receiptId, expectedReceiptVersion: stock.receiptVersion, expectedStockVersion: stock.version, quantity, ...(unitIds === undefined ? {} : { unitIds }) });
}

export async function releaseBody(h, salesOrder, claim) {
  const view = await h.ok(orderPath(salesOrder)), live = view.reservations.find(row => row._id === claim._id), stock = await h.ok(stockPath(live.receiptId));
  assert.ok(live);
  return command({ expectedVersion: view.version, expectedReservationVersion: live.version, expectedReceiptVersion: stock.receiptVersion, expectedStockVersion: stock.version });
}

export async function shipmentBody(h, salesOrder, lineIndex, selections) {
  const view = await h.ok(orderPath(salesOrder));
  const sources = [];
  for (const selection of selections) {
    const claim = view.reservations.find(row => row._id === selection.reservationId); assert.ok(claim);
    const stock = await h.ok(stockPath(claim.receiptId));
    sources.push({ reservationId: claim._id, expectedReservationVersion: claim.version, expectedReceiptVersion: stock.receiptVersion, expectedStockVersion: stock.version, quantity: selection.quantity, ...(selection.unitIds === undefined ? {} : { unitIds: selection.unitIds }) });
  }
  return command({ expectedVersion: view.version, expectedSalesOrderVersion: view.salesOrder.version, lineIndex, reference: 'Independent actual partial customer dispatch', sources });
}

export async function makeProductionConsumer(h, fixture, { item = fixture.serialItem, quantity = '1' } = {}) {
  const plan = await h.ok('/internal-production/orders', command({ itemId: fixture.outputItem._id, itemRevision: fixture.outputItem.currentRevision, expectedItemVersion: fixture.outputItem.version, locationId: fixture.location._id, expectedLocationVersion: fixture.location.version, quantity }), 201);
  let engineering = await h.ok(`/internal-production/orders/${plan._id}/engineering/revisions`, command({ expectedVersion: plan.version, operations: [{ code: 'QA_SOURCE_USE', instruction: 'Independent source competition only; no manufactured dispatch' }], materials: [{ itemId: item._id, itemRevision: item.currentRevision, expectedItemVersion: item.version, quantityPerUnit: '1', uom: item.content.uom }] }));
  engineering = await h.ok(`/internal-production/orders/${plan._id}/engineering/approve`, command({ expectedVersion: engineering.version, revision: engineering.engineering.currentRevision }));
  return h.ok('/internal-execution/orders', command({ internalOrderId: plan._id, expectedOrderVersion: engineering.version, engineeringRevision: engineering.engineering.currentRevision }), 201);
}

export async function makeAdditionalLot(h, fixture, quantity = '1') {
  const item = fixture.lotItem;
  let request = await h.ok('/catalog-procurement/requests', command({ vendorId: fixture.vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ itemId: item._id, itemVersion: item.version, itemRevision: item.currentRevision, quantity, unitPrice: '1.00', currency: 'USD' }] }), 201);
  request = await h.ok(`/catalog-procurement/requests/${request._id}/approve`, command({ expectedVersion: request.version, revision: request.currentRevision }));
  let order = await h.ok(`/catalog-procurement/requests/${request._id}/convert`, command({ expectedVersion: request.version }));
  order = await h.ok(`/catalog-procurement/orders/${order._id}/issue`, command({ expectedVersion: order.version }));
  const receipt = await h.ok('/catalog-procurement/receipts', command({ expectedVersion: order.version, purchaseOrderId: order._id, vendorId: fixture.vendor._id, lineId: order.content.lines[0].lineId, quantity, lotNumber: `${fixture.prefix}_SECOND_LOT`, heatNumber: `${fixture.prefix}_SECOND_HEAT` }), 201);
  const path = `/catalog-disposition/receipts/${receipt._id}`;
  let qc = await h.ok(path);
  qc = await h.ok(`${path}/inspections`, command({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, acceptedQuantity: quantity, rejectedQuantity: '0', evidence: 'Independent second actual receipt for shared demand cap' }));
  qc = await h.ok(`${path}/approve`, command({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, revision: qc.currentRevision }));
  await h.ok(`${path}/putaway`, command({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, locationId: fixture.location._id, expectedLocationVersion: fixture.location.version }));
  return receipt;
}

export async function productionReserveBody(h, execution, receipt, item, quantity, serials) {
  const stock = await h.ok(stockPath(receipt)), current = await h.ok(`/internal-execution/orders/${execution._id}`);
  return command({ expectedVersion: current.version, materialLineId: current.materials.find(row => row.itemId === item._id).lineId, receiptId: stock.receiptId, expectedReceiptVersion: stock.receiptVersion, expectedStockVersion: stock.version, quantity, ...(serials ? { serials } : {}) });
}

export async function receiptHold(h, receipt) {
  const raw = await h.db.collection('warehouseReceipts').findOne({ _id: typeof receipt === 'string' ? receipt : receipt._id });
  const result = await h.send(`/warehouse/receipts/${raw._id}/holds`, { headers: { 'Idempotency-Key': randomUUID() }, body: { expectedReceiptVersion: raw.version, reasonCode: 'QC_SUSPECT', reasonNote: 'Independent current hold after customer reservation' } });
  assert.equal(result.status, 201, JSON.stringify(result));
  return result.data.hold;
}

export async function releaseHold(h, hold) {
  const result = await h.send(`/warehouse/holds/${hold.id}/release`, { headers: { 'Idempotency-Key': randomUUID() }, body: { expectedVersion: hold.version, reasonCode: 'INSPECTION_PASSED', reasonNote: 'Independent restored customer dispatch eligibility' } });
  assert.equal(result.status, 200, JSON.stringify(result));
  return result.data.hold;
}

export async function immutableOpening(h, receipts) {
  const ids = receipts.map(row => typeof row === 'string' ? row : row._id);
  const rows = {};
  for (const name of ['catalogStockBalances', 'catalogStockUnits', 'catalogStockMovements', 'warehouseReceiptOrigins', 'warehouseMovements', 'warehouseSerials', 'catalogDispositionHeads', 'catalogInspections', 'catalogDispositionEvents']) rows[name] = await h.db.collection(name).find({ receiptId: { $in: ids } }).sort({ _id: 1 }).toArray();
  const physical = await h.db.collection('warehouseReceipts').find({ _id: { $in: ids } }).sort({ _id: 1 }).toArray();
  rows.physical = physical.map(({ version, catalogStockUseFence, ...row }) => row);
  return rows;
}

export function assertImmutableOpening(current, baseline, { holdReceiptIds = [] } = {}) {
  const allowed = new Set(holdReceiptIds);
  const project = snapshot => ({ ...snapshot, physical: snapshot.physical.map(row => {
    if (!allowed.has(row._id)) return row;
    const { hold, updatedAt, ...physical } = row;
    return physical;
  }) });
  assert.deepEqual(project(current), project(baseline), 'Only explicitly commanded holds may change hold cache/timestamp; physical identity, quantities and immutable source ledgers stay exact');
}
