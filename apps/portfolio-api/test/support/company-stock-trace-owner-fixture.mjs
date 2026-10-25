import { companyOwnerFixture, companyCommand } from './company-stock-owner-fixture.mjs';
import { randomUUID } from 'node:crypto';

export async function companyTraceOwnerFixture(h) {
  const base = await companyOwnerFixture(h), ok = h.ok, cmd = companyCommand;
  const draft = await ok('/inventory-master/items', cmd({ code: 'OWNER_TRACE_SERIAL_INPUT', description: 'Actual serialized source for exact output trace', kind: 'PURCHASED', uom: 'UN', schema: 'INVENTORY_ITEM_V2', trackingPolicy: 'SERIAL' }), 201);
  const serialItem = await ok(`/inventory-master/items/${draft._id}/approve`, cmd({ expectedVersion: draft.version, revision: 1 }));
  const vendor = await ok('/procurement/vendors', { name: 'Owner trace actual supplier' }, 201);
  const request = await ok('/catalog-procurement/requests', cmd({ vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [[base.raw, '3'], [serialItem, '6']].map(([item, quantity]) => ({ itemId: item._id, itemVersion: item.version, itemRevision: item.currentRevision, quantity, unitPrice: '1.00', currency: 'USD' })) }), 201);
  const approved = await ok(`/catalog-procurement/requests/${request._id}/approve`, cmd({ expectedVersion: request.version, revision: 1 }));
  const converted = await ok(`/catalog-procurement/requests/${request._id}/convert`, cmd({ expectedVersion: approved.version }));
  const po = await ok(`/catalog-procurement/orders/${converted._id}/issue`, cmd({ expectedVersion: converted.version }));
  const incomingSerials = Array.from({ length: 6 }, (_, index) => `OWNER-TRACE-INPUT-${index + 1}`);
  async function receive(item, quantity, serials) {
    const receipt = await ok('/catalog-procurement/receipts', cmd({ expectedVersion: po.version, purchaseOrderId: po._id, vendorId: vendor._id, lineId: po.content.lines.find(line => line.itemId === item._id).lineId, quantity, ...(serials ? { serials } : { lotNumber: 'OWNER-TRACE-LOT', heatNumber: 'OWNER-TRACE-HEAT' }) }), 201);
    const path = `/catalog-disposition/receipts/${receipt._id}`; let qc = await ok(path);
    qc = await ok(`${path}/inspections`, cmd({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, acceptedQuantity: quantity, rejectedQuantity: '0', evidence: 'Actual owner trace incoming QC', ...(serials ? { acceptedSerials: serials, rejectedSerials: [] } : {}) }));
    qc = await ok(`${path}/approve`, cmd({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, revision: 1 }));
    await ok(`${path}/putaway`, cmd({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, locationId: base.location._id, expectedLocationVersion: base.location.version })); return receipt;
  }
  const rawReceipt = await receive(base.raw, '3'), serialReceipt = await receive(serialItem, '6', incomingSerials);
  let producer = await base.execute(await base.plan(base.component, '3', [[base.raw, '1'], [serialItem, '2']]));
  producer = await base.reserveRaw(producer, base.abandoned, base.raw, '2');
  const abandonedStock = await ok(`/catalog-stock/receipts/${base.abandoned._id}`);
  producer = await base.mutate(producer, `reservations/${producer.reservations[0]._id}/release`, { expectedReceiptVersion: abandonedStock.receiptVersion, expectedStockVersion: abandonedStock.version });
  producer = await base.reserveRaw(producer, rawReceipt, base.raw, '3');
  const stock = await ok(`/catalog-stock/receipts/${serialReceipt._id}`);
  producer = await base.mutate(producer, 'reservations', { materialLineId: producer.materials.find(line => line.itemId === serialItem._id).lineId, receiptId: serialReceipt._id, expectedReceiptVersion: stock.receiptVersion, expectedStockVersion: stock.version, quantity: '6', serials: incomingSerials });
  producer = await base.mutate(producer, 'release'); producer = await base.mutate(producer, 'issue');
  producer = await base.mutate(producer, 'records', { operationIndex: 0, inputQuantity: '3', goodQuantity: '3', scrapQuantity: '0', laborMinutes: '3', machineMinutes: '1', evidence: 'Actual trace producer operation' });
  const produced = ['OWNER-TRACE-COMP-1', 'OWNER-TRACE-COMP-2', 'OWNER-TRACE-COMP-3'];
  producer = await base.mutate(producer, 'records', { operationIndex: 1, inputQuantity: '3', goodQuantity: '3', scrapQuantity: '0', laborMinutes: '2', machineMinutes: '1', evidence: 'Actual trace producer serialized output', outputSerials: produced });
  for (let index = 0; index < produced.length; index++) producer = await base.mutate(producer, 'allocations', { outputUnitId: producer.outputUnits.find(unit => unit.serial === produced[index])._id, sources: [{ receiptId: rawReceipt._id, quantity: '1' }, { receiptId: serialReceipt._id, quantity: '2', serials: incomingSerials.slice(index * 2, index * 2 + 2) }] });
  producer = await base.mutate(producer, 'qc', { acceptedSerials: produced.slice(0, 2), rejectedSerials: produced.slice(2), evidence: 'Actual two accepted one rejected trace inspection' });
  producer = await base.mutate(producer, 'putaway', { locationId: base.location._id, expectedLocationVersion: base.location.version });
  const companyPath = `/company-stock/receipts/${producer.companyStock._id}`;
  const company = () => ok(companyPath);
  async function reserveCompany(execution, selectedIds) {
    const source = await company(), selected = source.units.filter(unit => selectedIds.includes(unit._id));
    return base.mutate(execution, 'reservations', { sourceKind: 'COMPANY_OUTPUT', companyReceiptId: source._id, expectedStockVersion: source.version, materialLineId: execution.materials.find(line => line.itemId === base.component._id).lineId, quantity: String(selected.length), units: selected.map(unit => ({ companyUnitId: unit._id, expectedUnitVersion: unit.version })) });
  }
  return { ...base, serialItem, rawReceipt, serialReceipt, incomingSerials, produced, producer, companyPath, company, reserveCompany, key: randomUUID };
}
