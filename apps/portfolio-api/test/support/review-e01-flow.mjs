import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const e01Fixture = require('../../../../packages/domain-test-fixtures/src/scenarios/e01ManufacturingTenUnits.js').e01ManufacturingFixture;
const iso = value => new Date(value).toISOString();
const key = () => randomUUID();

export async function receiveE01MaterialSources(h, { setClock }) {
  const f = e01Fixture, ok = h.ok, command = values => ({ idempotencyKey: key(), ...values });
  setClock(new Date(f.procurement.purchase_order.po_date));
  const vendor = await ok('/procurement/vendors', { name: 'PT Industrial Component Partners — canonical E01 fixture' }, 201);
  let pr = await ok('/procurement/requests', { vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: f.procurement.purchase_order.lines.map(line => ({ description: line.item_code, quantity: line.ordered_qty, uom: line.uom, unitPrice: line.unit_price, currency: 'USD' })) }, 201);
  pr = await ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: pr.version });
  let po = await ok(`/procurement/requests/${pr._id}/convert`, command({ expectedVersion: pr.version }));
  po = await ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: po.version });
  setClock(new Date(f.procurement.goods_receipt.received_at));
  const receipts = [];
  for (const [lineIndex, line] of f.procurement.goods_receipt.lines.entries()) {
    let receipt = await ok('/warehouse/receipts', command({ purchaseOrderId: po._id, expectedVersion: po.version, vendorId: vendor._id, lineIndex, quantity: line.received_qty, uom: line.uom, lotNumber: line.lot_number, heatNumber: line.heat_number }), 201);
    receipt = await ok(`/warehouse/receipts/${receipt._id}/release`, command({ expectedVersion: receipt.version, reason: 'Canonical E01 incoming inspection release' }));
    receipt = await ok(`/warehouse/receipts/${receipt._id}/putaway`, command({ expectedVersion: receipt.version, location: f.procurement.goods_receipt.warehouse_id }));
    receipts.push(receipt);
  }
  return { vendor, po, receipts };
}

// Business time belongs to the owned constructor; every domain mutation below uses mounted HTTP.
export async function runE01Flow(h, { setClock, onCheckpoint = async () => {} } = {}) {
  assert.equal(typeof setClock, 'function');
  const f = e01Fixture, ok = h.ok, events = [], replay = [], manifest = { scenario: f.scenario_id, engineering: { fixtureRevision: f.engineering_package.revision_code, bom: f.engineering_package.bom.revision_code, routing: f.engineering_package.routing.revision_code, runtimeRevision: 2 }, employeeBindings: {}, supplementalEvidence: 'Operations absent from the four original execution_sessions are operator-recorded fixture test evidence; no machine telemetry or physical verification is claimed.' };
  let currentTime = 0;
  const at = value => { const next = new Date(value).getTime(); assert.ok(next >= currentTime, `Business clock regressed: ${value}`); currentTime = next; setClock(new Date(next)); events.push(iso(value)); };
  const command = values => ({ idempotencyKey: key(), ...values });
  const woPath = wo => `/manufacturing/work-orders/${wo._id}`;
  const current = wo => ok(woPath(wo));
  const schedule = (date, action) => timeline.push({ date, action });
  const timeline = [];
  at(f.inquiry.inquiry_date);
  const account = await ok('/crm/accounts', { name: 'PT Nusantara Mining Resources — canonical E01 fixture' }, 201), sourceLine = f.inquiry.lines[0];
  let inquiry = await ok('/commercial/inquiries', command({ accountId: account._id, lines: [{ itemCode: sourceLine.item_code, description: sourceLine.description, quantity: sourceLine.requested_qty, uom: sourceLine.uom, drawingNumber: sourceLine.drawing_reference, drawingRevision: 'REV-C' }] }), 201);
  for (const toStage of ['SUBMITTED', 'IN_REVIEW']) inquiry = await ok(`/commercial/inquiries/${inquiry._id}/stage`, command({ expectedVersion: inquiry.version, toStage, reason: 'Canonical E01 customer inquiry review' }));
  at(f.quotation.revisions[0].issued_date);
  const convertedInquiry = await ok(`/commercial/inquiries/${inquiry._id}/convert`, command({ expectedVersion: inquiry.version, revision: 1, expiresAt: iso(f.quotation.revisions[0].expiry_date), taxPolicy: 'FIXTURE_VAT_11_V1', roundingPolicy: 'LINE_HALF_UP', prices: [{ inquiryLineId: inquiry.revisions[0].lines[0].lineId, unitPrice: f.quotation.revisions[0].lines[0].unit_price, currency: 'USD' }] }));
  let quote = convertedInquiry.quote;
  quote = await ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: quote.version, revision: 1 });
  const immutableR1 = structuredClone(quote.revisions[0]);
  at(f.quotation.revisions[1].issued_date);
  quote = await ok(`/commercial/quotes/${quote._id}/revisions`, { expectedVersion: quote.version, expiresAt: iso(f.quotation.revisions[1].expiry_date), taxPolicy: 'FIXTURE_VAT_11_V1', roundingPolicy: 'LINE_HALF_UP', lines: quote.revisions[0].lines.map(({ description, quantity, uom, currency, provenance }) => ({ description, quantity, uom, currency, provenance, unitPrice: f.quotation.revisions[1].lines[0].unit_price })) });
  const stale = await h.req(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: quote.version, revision: 1 }, h.alpha);
  assert.equal(stale.status, 409); assert.equal(stale.error.code, 'STALE_REVISION');
  quote = await ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: quote.version, revision: 2 });
  at(f.quote_acceptance.accepted_at);
  quote = await ok(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: quote.version, revision: 2 });
  at(f.sales_order.order_date);
  const convertBody = command({ expectedVersion: quote.version, revision: 2 }), so = await ok(`/commercial/quotes/${quote._id}/convert`, convertBody);
  replay.push({ path: `/commercial/quotes/${quote._id}/convert`, body: convertBody, result: so });
  assert.deepEqual(quote.revisions[0], immutableR1);
  assert.equal(so.quoteRevision, 2);
  const { po, receipts } = await receiveE01MaterialSources(h, { setClock: at });
  manifest.engineering.dateLimitation = 'Original approval Apr15 precedes Apr17 goods receipt. Current receipt-backed engineering requires actual source receipts; runtime release occurs Apr17, with original approval date retained only as fixture reference.';
  manifest.paymentDateLimitation = 'The HTTP payment command is scheduled at original received_at. Current API atomically records receipt and allocation together with real wall-clock record timestamps; original later allocations.applied_at values are fixture references, not independently persisted business timestamps.';
  manifest.issueDateLimitation = 'Original material issue dates map to legacy release/reservation; physical source consumption is recorded on the first completed operation after its labor session. No separate legacy issue-business-timestamp authority is invented.';
  const operations = f.engineering_package.routing.operations.map(operation => ({ code: `OP${operation.operation_no}`, instruction: `${operation.operation_name}; fixture workcenter ${operation.workcenter_id}` })), materials = f.engineering_package.bom.components.map((component, index) => ({ receiptId: receipts[index]._id, quantityPerUnit: component.qty_per_parent, uom: component.uom }));
  let engineering = await ok('/manufacturing/engineering', command({ expectedVersion: 1, salesOrderId: so._id, salesOrderVersion: so.version, lineIndex: 0, uom: 'UN', operations, materials }), 201);
  engineering = await ok(`/manufacturing/engineering/${engineering._id}/revisions`, command({ expectedVersion: engineering.version, operations, materials }));
  engineering = await ok(`/manufacturing/engineering/${engineering._id}/release`, command({ expectedVersion: engineering.version, revision: 2 }));
  const frozenEngineering = await ok(`/manufacturing/engineering/${engineering._id}/revisions/2`);
  const split = await ok('/manufacturing/work-orders', command({ salesOrderId: so._id, expectedVersion: so.version, lineIndex: 0, quantities: f.work_orders.map(wo => wo.target_qty), uom: 'UN', serialized: true, genealogyRequired: true, requiredLaborOperationIndices: [0, 3] }), 201), workOrders = split.workOrders;
  const employees = {};
  for (const [employeeId, username] of [['EMP-0104', 'alpha.operator.cnc'], ['EMP-0108', 'alpha.operator.assembly']]) {
    const member = h.seeded.find(row => row.username === username); assert.ok(member);
    employees[employeeId] = { member, cookie: await h.login(username) }; manifest.employeeBindings[employeeId] = member.userId;
  }
  const wrongRevision = await h.req(`${woPath(workOrders[0])}/release-engineering`, command({ expectedVersion: 1, engineeringId: engineering._id, engineeringVersion: engineering.version, revision: 1 }), h.alpha);
  assert.equal(wrongRevision.status, 409); assert.equal(wrongRevision.error.code, 'REVISION_CONFLICT');
  const record = async (index, operationIndex) => {
    const fixtureWo = f.work_orders[index], wo = await current(workOrders[index]), body = command({ expectedVersion: wo.version, operationIndex, inputQuantity: fixtureWo.target_qty, goodQuantity: fixtureWo.target_qty, scrapQuantity: '0', uom: 'UN', evidence: `${fixtureWo.id} operation ${operations[operationIndex].code}: ${[0, 3].includes(operationIndex) ? 'Original execution-session labor evidence recorded separately' : manifest.supplementalEvidence}`, ...(operationIndex === operations.length - 1 ? { outputSerials: fixtureWo.produced_serials } : {}) });
    const result = await ok(`${woPath(wo)}/record`, body); replay.push({ path: `${woPath(wo)}/record`, body, result });
  };
  for (const [index, fixtureWo] of f.work_orders.entries()) {
    schedule(f.material_issues[index].posted_at, async () => { const wo = await current(workOrders[index]); await ok(`${woPath(wo)}/release-engineering`, command({ expectedVersion: wo.version, engineeringId: engineering._id, engineeringVersion: engineering.version, revision: 2 })); });
    for (const session of f.execution_sessions.filter(row => row.work_order_id === fixtureWo.id)) schedule(session.end_time, async () => {
      const operationIndex = f.engineering_package.routing.operations.findIndex(row => row.operation_no === session.operation_no);
      if (operationIndex === 3) { await record(index, 1); await record(index, 2); }
      const wo = await current(workOrders[index]), operator = employees[session.employee_id];
      await ok(`${woPath(wo)}/labor`, command({ expectedVersion: wo.version, operationIndex, operatorId: operator.member.userId, startedAt: iso(session.start_time), endedAt: iso(session.end_time), durationMs: new Date(session.end_time) - new Date(session.start_time), activeDurationMs: Number(session.run_hours) * 3600000, evidence: `Original ${session.employee_id}/${session.badge_no}; ${session.workcenter_id}; active run_hours=${session.run_hours}; operator-recorded, breaks excluded from active duration` }), 201, operator.cookie);
      await record(index, operationIndex);
    });
    schedule(fixtureWo.actual_completion, async () => record(index, 4));
  }
  const shipments = [], deliveries = [], invoices = [], payments = [], genealogies = [];
  for (const [index, qc] of f.quality_releases.entries()) schedule(qc.release_date, async () => {
    const wo = await current(workOrders[index]);
    await ok(`${woPath(wo)}/qc`, command({ expectedVersion: wo.version, acceptedQuantity: qc.accepted_qty, rejectedQuantity: qc.rejected_qty, uom: 'UN', acceptedSerials: qc.serials_released, rejectedSerials: [], evidence: `${qc.certificate_no}: operator-recorded original fixture verifications ${JSON.stringify(qc.verifications)}` }));
    const physicalBalances = async () => Promise.all(receipts.map(async receipt => { const row = await ok(`/warehouse/receipts/${receipt._id}`); return Object.fromEntries(['_id', 'quantity', 'status', 'availableQuantity', 'reservedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity', 'shippedQuantity', 'lotNumber', 'heatNumber', 'receiptOrigin'].map(field => [field, row[field]])); }));
    const balancesBefore = await physicalBalances();
    for (const unit of await ok(`${woPath(wo)}/output-units`)) {
      const view = await ok(`${woPath(wo)}/genealogy`);
      await ok(`${woPath(wo)}/genealogy/allocations`, command({ expectedVersion: view.workOrderVersion, expectedGenealogyVersion: view.version, reason: 'Original E01 lot/heat source attribution', outputUnitId: unit._id, materials: materials.map(material => ({ receiptId: material.receiptId, quantity: material.quantityPerUnit, uom: material.uom })) }));
    }
    let view = await ok(`${woPath(wo)}/genealogy`);
    view = await ok(`${woPath(wo)}/genealogy/losses`, command({ expectedVersion: view.workOrderVersion, expectedGenealogyVersion: view.version, reason: 'Original E01 explicitly zero process loss', losses: [] }));
    genealogies[index] = await ok(`${woPath(wo)}/genealogy/finalize`, command({ expectedVersion: view.workOrderVersion, expectedGenealogyVersion: view.version, reason: 'Original E01 complete exact five-source reconciliation' }));
    assert.deepEqual(await physicalBalances(), balancesBefore);
  });
  for (const [index, shipment] of f.shipments.entries()) {
    schedule(shipment.dispatched_at, async () => {
      const body = command({ salesOrderId: so._id, expectedVersion: so.version, lineIndex: 0, uom: 'UN', sources: [{ sourceType: 'WORK_ORDER', sourceId: workOrders[index]._id, quantity: shipment.lines[0].shipped_qty, serials: shipment.lines[0].serials }], reference: shipment.id });
      shipments[index] = await ok('/fulfillment/shipments', body, 201); replay.push({ path: '/fulfillment/shipments', body, result: shipments[index], status: 201 });
    });
    schedule(shipment.proof_of_delivery.delivered_at, async () => {
      const path = `/deliveries/shipments/${shipments[index]._id}`, view = await ok(path), pod = shipment.proof_of_delivery;
      deliveries[index] = await ok(`${path}/confirmations`, command({ expectedVersion: view.version, expectedShipmentVersion: shipments[index].version, quantity: shipment.lines[0].shipped_qty, serials: shipment.lines[0].serials, deliveredAt: iso(pod.delivered_at), receiverName: pod.receiver_name, receiverReference: pod.receiver_badge, evidenceReference: pod.pod_id, evidenceNotes: 'Original E01 signed POD fixture; operator-recorded confirmation, no external carrier integration claim' }), 201);
    });
  }
  for (const [index, invoice] of f.invoices.entries()) schedule(invoice.issued_date, async () => { invoices[index] = await ok('/fulfillment/invoices', command({ salesOrderId: so._id, expectedVersion: so.version, lines: [{ shipmentId: shipments[index]._id, quantity: invoice.lines[0].billed_qty }] }), 201); assert.equal(invoices[index].netAmount, invoice.totals.net_amount); assert.equal(invoices[index].taxAmount, invoice.totals.tax_amount); assert.equal(invoices[index].total, invoice.totals.gross_amount); });
  for (const [index, payment] of f.payments.entries()) schedule(payment.received_at, async () => { payments[index] = await ok('/fulfillment/payments', command({ accountId: account._id, currency: 'USD', reference: payment.payment_reference, amount: payment.amount_received, allocations: [{ invoiceId: invoices[index]._id, expectedVersion: invoices[index].version, amount: payment.amount_received }] }), 201); });
  for (const entry of timeline.sort((a, b) => new Date(a.date) - new Date(b.date))) { at(entry.date); await entry.action(); await onCheckpoint({ date: iso(entry.date), workOrders, shipments, invoices, payments }); }
  return { fixture: f, manifest, events, account, inquiry, quote, so, po, receipts, engineering, frozenEngineering, workOrders, shipments, deliveries, invoices, payments, genealogies, replay };
}
