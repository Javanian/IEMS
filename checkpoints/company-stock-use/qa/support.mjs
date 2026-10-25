import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';

export { startOwned };
export const command = values => ({ expectedVersion: 1, reason: 'Independent company component custody proof', idempotencyKey: randomUUID(), ...values });
export const executionRoot = '/internal-execution/orders';

export async function snapshot(h) {
  const auth = new Set(['sessions', 'memberships', 'users', 'tenants', 'plants', 'legalEntities', 'credentials', 'ownedRun']);
  const names = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).filter(name => !auth.has(name)).sort();
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await h.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
}

export async function denied(h, path, body, status, code, cookie = h.alpha) {
  const before = await snapshot(h), response = await h.req(path, body, cookie);
  assert.equal(response.status, status, `${path}: ${JSON.stringify(response)}`);
  assert.equal(response.error.code, code, path);
  assert.deepEqual(await snapshot(h), before, `${path}: rejected command changed durable domain state`);
  return response;
}

export async function replaceWhile(h, name, row, replacement, effect) {
  await h.db.collection(name).replaceOne({ _id: row._id }, replacement);
  try { return await effect(); }
  finally { await h.db.collection(name).replaceOne({ _id: row._id }, row); }
}

export async function makeFixture(h, { acceptedCount = 2 } = {}) {
  assert.ok(Number.isSafeInteger(acceptedCount) && acceptedCount >= 2 && acceptedCount <= 10);
  const target = acceptedCount + 1, quarters = n => { const value = BigInt(n) * 25n; return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`.replace(/\.?0+$/, ''); };
  const lotQuantity = quarters(target * 5), lotEntitlement = quarters(target * 10 + 10), serialQuantity = String(target * 2);
  const prefix = `QA_COMP_${randomUUID().slice(0, 8).toUpperCase()}`, ok = h.ok;
  async function item(suffix, kind, uom, trackingPolicy) {
    const draft = await ok('/inventory-master/items', command({ code: `${prefix}_${suffix}`, description: `${prefix} actual ${suffix}`, kind, uom, schema: 'INVENTORY_ITEM_V2', trackingPolicy }), 201);
    return ok(`/inventory-master/items/${draft._id}/approve`, command({ expectedVersion: draft.version, revision: 1 }));
  }
  const lotItem = await item('LOT', 'PURCHASED', 'KG', 'LOT'), serialItem = await item('IN', 'PURCHASED', 'UN', 'SERIAL'), componentItem = await item('COMPONENT', 'MANUFACTURED', 'UN', 'SERIAL'), leafItem = await item('LEAF', 'MANUFACTURED', 'UN', 'SERIAL');
  const bin = await ok('/warehouse/bins', { expectedVersion: 1, code: `${prefix}_BIN`, idempotencyKey: randomUUID() }, 201);
  const locationDraft = await ok('/inventory-master/locations', command({ code: `${prefix}_LOC`, binId: bin._id }), 201);
  const location = await ok(`/inventory-master/locations/${locationDraft._id}/qualify`, command({ expectedVersion: locationDraft.version }));
  const vendor = await ok('/procurement/vendors', { name: `${prefix} actual supplier` }, 201);
  let request = await ok('/catalog-procurement/requests', command({ vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [[lotItem, lotEntitlement], [serialItem, serialQuantity]].map(([source, quantity]) => ({ itemId: source._id, itemVersion: source.version, itemRevision: source.currentRevision, quantity, unitPrice: '1.00', currency: 'USD' })) }), 201);
  request = await ok(`/catalog-procurement/requests/${request._id}/approve`, command({ expectedVersion: request.version, revision: 1 }));
  let order = await ok(`/catalog-procurement/requests/${request._id}/convert`, command({ expectedVersion: request.version }));
  order = await ok(`/catalog-procurement/orders/${order._id}/issue`, command({ expectedVersion: order.version }));
  async function receive(source, quantity, suffix, serials) {
    const receipt = await ok('/catalog-procurement/receipts', command({ expectedVersion: order.version, purchaseOrderId: order._id, vendorId: vendor._id, lineId: order.content.lines.find(line => line.itemId === source._id).lineId, quantity, ...(serials ? { serials } : { lotNumber: `${prefix}_${suffix}`, heatNumber: `${prefix}_HEAT` }) }), 201), path = `/catalog-disposition/receipts/${receipt._id}`;
    let qc = await ok(path);
    qc = await ok(`${path}/inspections`, command({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, acceptedQuantity: quantity, rejectedQuantity: '0', evidence: `${prefix} actual incoming inspection`, ...(serials ? { acceptedSerials: serials, rejectedSerials: [] } : {}) }));
    qc = await ok(`${path}/approve`, command({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, revision: 1 }));
    await ok(`${path}/putaway`, command({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, locationId: location._id, expectedLocationVersion: location.version }));
    return receipt;
  }
  const incoming = Array.from({ length: target * 2 }, (_, index) => `${prefix}_RAW_${index + 1}`);
  const abandoned = await receive(lotItem, lotQuantity, 'ABANDONED'), producerLot = await receive(lotItem, lotQuantity, 'CONSUMED'), consumerLot = await receive(lotItem, '2.5', 'DIRECT'), producerSerial = await receive(serialItem, serialQuantity, 'SERIAL', incoming);
  const producerPlan = await ok('/internal-production/orders', command({ itemId: componentItem._id, itemRevision: componentItem.currentRevision, expectedItemVersion: componentItem.version, locationId: location._id, expectedLocationVersion: location.version, quantity: String(target) }), 201);
  let engineering = await ok(`/internal-production/orders/${producerPlan._id}/engineering/revisions`, command({ expectedVersion: producerPlan.version, operations: [{ code: 'QA_CUT', instruction: 'Independent actual purchased-input operation' }, { code: 'QA_FINISH', instruction: 'Independent actual component finish' }], materials: [[lotItem, '1.25'], [serialItem, '2']].map(([source, quantityPerUnit]) => ({ itemId: source._id, itemRevision: source.currentRevision, expectedItemVersion: source.version, quantityPerUnit, uom: source.content.uom })) }));
  engineering = await ok(`/internal-production/orders/${producerPlan._id}/engineering/approve`, command({ expectedVersion: engineering.version, revision: 1 }));
  let producer = await ok(executionRoot, command({ internalOrderId: producerPlan._id, expectedOrderVersion: engineering.version, engineeringRevision: 1 }), 201);
  const producerPath = `${executionRoot}/${producer._id}`;
  const stock = receipt => ok(`/catalog-stock/receipts/${receipt._id}`);
  async function reserve(receipt, sourceItem, quantity, serials) {
    const source = await stock(receipt);
    producer = await ok(`${producerPath}/reservations`, command({ expectedVersion: producer.version, materialLineId: producer.materials.find(row => row.itemId === sourceItem._id).lineId, receiptId: receipt._id, expectedReceiptVersion: source.receiptVersion, expectedStockVersion: source.version, quantity, ...(serials ? { serials } : {}) }));
  }
  await reserve(abandoned, lotItem, lotQuantity);
  const abandonedClaim = producer.reservations.find(row => row.receiptId === abandoned._id), abandonedStock = await stock(abandoned);
  producer = await ok(`${producerPath}/reservations/${abandonedClaim._id}/release`, command({ expectedVersion: producer.version, expectedReceiptVersion: abandonedStock.receiptVersion, expectedStockVersion: abandonedStock.version }));
  await reserve(producerLot, lotItem, lotQuantity); await reserve(producerSerial, serialItem, serialQuantity, incoming);
  for (const action of ['release', 'issue']) producer = await ok(`${producerPath}/${action}`, command({ expectedVersion: producer.version }));
  producer = await ok(`${producerPath}/records`, command({ expectedVersion: producer.version, operationIndex: 0, inputQuantity: String(target), goodQuantity: String(target), scrapQuantity: '0', laborMinutes: '1', machineMinutes: '0', evidence: `${prefix} actual first producer operation` }));
  const produced = Array.from({ length: target }, (_, index) => `${prefix}_COMP_${index + 1}`);
  producer = await ok(`${producerPath}/records`, command({ expectedVersion: producer.version, operationIndex: 1, inputQuantity: String(target), goodQuantity: String(target), scrapQuantity: '0', laborMinutes: '1', machineMinutes: '0', evidence: `${prefix} actual final producer operation`, outputSerials: produced }));
  for (let index = 0; index < target; index++) producer = await ok(`${producerPath}/allocations`, command({ expectedVersion: producer.version, outputUnitId: producer.outputUnits.find(unit => unit.serial === produced[index])._id, sources: [{ receiptId: producerLot._id, quantity: '1.25' }, { receiptId: producerSerial._id, quantity: '2', serials: incoming.slice(index * 2, index * 2 + 2) }] }));
  producer = await ok(`${producerPath}/qc`, command({ expectedVersion: producer.version, acceptedSerials: produced.slice(0, acceptedCount), rejectedSerials: produced.slice(acceptedCount), evidence: `${prefix} actual accepted${acceptedCount} rejected1 producer inspection` }));
  producer = await ok(`${producerPath}/putaway`, command({ expectedVersion: producer.version, locationId: location._id, expectedLocationVersion: location.version }));
  assert.equal(producer.companyStock.quantity, String(acceptedCount));
  assert.deepEqual(producer.companyStock.consumedReceiptIds, [producerLot._id, producerSerial._id].sort());
  assert.equal(producer.outputUnits.find(unit => unit.serial === produced[acceptedCount]).status, 'REJECTED');
  return { prefix, lotItem, serialItem, componentItem, leafItem, location, bin, abandoned, producerLot, producerSerial, consumerLot, producer, produced, incoming };
}

export async function producerEvidence(h, fixture) {
  const executionId = fixture.producer._id, names = ['internalCompanyStockReceipts', 'internalCompanyStockUnits', 'internalOutputUnits', 'catalogMaterialConsumptions', 'catalogMaterialIssues', 'catalogMaterialReservations'];
  const opening = Object.fromEntries(await Promise.all(names.map(async name => [name, await h.db.collection(name).find({ executionId }).sort({ _id: 1 }).toArray()])));
  const receipts = await h.db.collection('warehouseReceipts').find({ _id: { $in: [fixture.producerLot._id, fixture.producerSerial._id] } }).sort({ _id: 1 }).toArray();
  const fences = receipts.map(row => ({ receiptId: row._id, value: row.catalogStockUseFence ?? 0 }));
  for (const fence of fences) assert.ok(Number.isSafeInteger(fence.value) && fence.value >= 0);
  return { opening, physicalReceipts: receipts.map(({ catalogStockUseFence, ...row }) => row), fences };
}

export function assertProducerConserved(current, baseline) {
  assert.deepEqual(current.opening, baseline.opening);
  assert.deepEqual(current.physicalReceipts, baseline.physicalReceipts);
  for (const before of baseline.fences) assert.ok(current.fences.find(row => row.receiptId === before.receiptId).value >= before.value, 'Only the explicit technical source fence may advance');
}

export async function makeConsumer(h, fixture, { quantity = '2', sourceItem = fixture.componentItem } = {}) {
  const plan = await h.ok('/internal-production/orders', command({ schema: 'INTERNAL_PLAN_V2', itemId: fixture.leafItem._id, itemRevision: fixture.leafItem.currentRevision, expectedItemVersion: fixture.leafItem.version, locationId: fixture.location._id, expectedLocationVersion: fixture.location.version, quantity }), 201);
  let engineering = await h.ok(`/internal-production/orders/${plan._id}/engineering/revisions`, command({ expectedVersion: plan.version, operations: [{ code: 'QA_MIX', instruction: 'Independent actual one-generation assembly with process scrap' }, { code: 'QA_FINAL', instruction: 'Independent actual final leaf output' }], materials: [[sourceItem, '1'], [fixture.lotItem, '1.25']].map(([source, quantityPerUnit]) => ({ itemId: source._id, itemRevision: source.currentRevision, expectedItemVersion: source.version, quantityPerUnit, uom: source.content.uom })) }));
  engineering = await h.ok(`/internal-production/orders/${plan._id}/engineering/approve`, command({ expectedVersion: engineering.version, revision: 1 }));
  const execution = await h.ok(executionRoot, command({ internalOrderId: plan._id, expectedOrderVersion: engineering.version, engineeringRevision: 1 }), 201);
  assert.equal(execution.schema, 'INTERNAL_EXECUTION_V2');
  assert.equal(execution.materials.find(row => row.itemId === sourceItem._id).sourceKind, 'COMPANY_OUTPUT');
  assert.equal(execution.materials.find(row => row.itemId === fixture.lotItem._id).sourceKind, 'CATALOG_RECEIPT');
  return execution;
}

export const getExecution = (h, execution) => h.ok(`${executionRoot}/${execution._id}`);
export const getCompany = (h, receiptId) => h.ok(`/company-stock/receipts/${receiptId}`);
export function reserveCompanyBody(execution, source, selectedUnits, materialItemId) {
  return command({ expectedVersion: execution.version, sourceKind: 'COMPANY_OUTPUT', materialLineId: execution.materials.find(row => row.itemId === materialItemId).lineId, companyReceiptId: source._id, expectedStockVersion: source.version, quantity: String(selectedUnits.length), units: selectedUnits.map(unit => ({ companyUnitId: unit._id, expectedUnitVersion: unit.version })) });
}
export async function reserveDirectLot(h, fixture, execution, quantity = '2.5') {
  const source = await h.ok(`/catalog-stock/receipts/${fixture.consumerLot._id}`);
  return h.ok(`${executionRoot}/${execution._id}/reservations`, command({ expectedVersion: execution.version, sourceKind: 'CATALOG_RECEIPT', materialLineId: execution.materials.find(row => row.itemId === fixture.lotItem._id).lineId, receiptId: fixture.consumerLot._id, expectedReceiptVersion: source.receiptVersion, expectedStockVersion: source.version, quantity }));
}

export async function companyHold(h, receiptId, { release = false } = {}) {
  const current = await getCompany(h, receiptId);
  return h.ok(`/company-stock/receipts/${receiptId}/holds${release ? '/release' : ''}`, command({ expectedVersion: current.version, ...(release ? { expectedHoldId: current.hold._id } : { reasonCode: 'QUALITY_SUSPECT' }) }));
}
