import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { companyOwnerFixture, companyCommand } from './company-stock-owner-fixture.mjs';

const require = createRequire(import.meta.url);
export const e02Fixture = require('../../../../packages/domain-test-fixtures/src/scenarios/e02RepairCustomerAsset.js').e02RepairFixture;
const iso = value => new Date(value).toISOString();
const command = values => ({ idempotencyKey: randomUUID(), ...values });

// A domain rejection carries the actual prefix; callers must never label it E02 success.
export class E02IncompleteError extends Error {
  constructor(gap, flow) {
    super(`Canonical E02 incomplete at ${gap.path}: HTTP ${gap.actual.status} ${gap.actual.error?.code}`);
    this.name = 'E02IncompleteError';
    this.code = 'E02_INCOMPLETE';
    this.gap = gap;
    this.flow = flow;
  }
}

export async function runE02Prefix(h, { setClock, onCheckpoint = async () => {} } = {}) {
  assert.equal(typeof setClock, 'function');
  const f = e02Fixture;
  const flow = { fixture: f, events: [], manifest: {
    scenario: f.scenario_id, status: 'INCOMPLETE', completed: [], identities: {},
    notRun: ['deposit', 'source-backed spare issue/replacement/quarantine', 'failed test/rework/retest/QC', 'return shipment/POD', 'final VAT invoice/deposit application/settlement', 'warranty', 'rejection variant'],
    evidenceKind: 'Synthetic canonical fixture through mounted authenticated HTTP; no external or physical verification',
  } };
  let currentTime = 0;
  const at = value => {
    const next = Date.parse(value);
    assert.ok(Number.isFinite(next) && next >= currentTime, `Business clock regressed: ${value}`);
    currentTime = next; setClock(new Date(next)); flow.events.push(iso(value));
  };
  const checkpoint = async milestone => {
    flow.manifest.completed.push(milestone);
    await onCheckpoint({ milestone, date: new Date(currentTime).toISOString(), manifest: structuredClone(flow.manifest) });
  };
  const request = async (path, body, status = 200) => {
    const actual = await h.req(path, body, h.alpha);
    if (actual.status !== status) {
      const gap = { path, body, expectedStatus: status, actual, businessAt: new Date(currentTime).toISOString() };
      flow.manifest.gap = gap;
      await onCheckpoint({ milestone: 'INCOMPLETE', manifest: structuredClone(flow.manifest) });
      throw new E02IncompleteError(gap, flow);
    }
    return actual.data;
  };
  const step = async (action, values) => {
    flow.case = await request(`/repair/cases/${flow.case._id}/${action}`, command({ expectedVersion: flow.case.version, ...values }));
  };
  const quoteContent = revision => ({
    expiresAt: iso(revision.expiry_date), taxPolicy: 'FIXTURE_VAT_11_V1', roundingPolicy: 'LINE_HALF_UP',
    lines: revision.lines.map(line => ({ description: line.description, quantity: line.quoted_qty, uom: line.uom, unitPrice: line.unit_price, currency: f.quotation.currency })),
  });

  at(f.repair_case.intake_date);
  flow.account = await request('/crm/accounts', { name: 'PT Kaltim Prima Coal — canonical synthetic E02' }, 201);
  flow.manifest.identities[f.customer_party_id] = flow.account._id;
  at(f.repair_case.custody_events[0].timestamp);
  flow.case = await request('/repair/cases', command({ accountId: flow.account._id, serial: f.customer_asset.serial_no, condition: f.repair_case.customer_reported_fault, currency: f.quotation.currency, serviceProfile: 'REPAIR_SERVICE_V1' }), 201);
  flow.manifest.identities[f.customer_asset.id] = { assetId: flow.case.assetId, caseId: flow.case._id, serial: flow.case.serial, ownership: 'CUSTOMER_OWNED_NON_INVENTORY' };
  flow.manifest.identities[f.repair_case.id] = flow.case._id;
  await checkpoint('intake/custody');

  at(f.quotation.revisions[0].issued_date);
  flow.quote = await request('/commercial/quotes', { accountId: flow.account._id, ...quoteContent(f.quotation.revisions[0]) }, 201);
  flow.quote = await request(`/commercial/quotes/${flow.quote._id}/approve`, { expectedVersion: flow.quote.version, revision: 1 });
  const immutableR1 = structuredClone(flow.quote.revisions[0]);
  at(f.diagnostic_authorization.authorized_at);
  await step('diagnostic-authorize', { feeCap: f.diagnostic_authorization.capped_diagnostic_fee, evidence: `${f.diagnostic_authorization.id}; ${f.diagnostic_authorization.customer_po_reference}; ${f.diagnostic_authorization.authorized_scope}` });
  await checkpoint('diagnostic authorization');
  at(f.teardown.completed_at);
  await step('teardown', { findings: f.teardown.findings.map(row => ({ component: row.component_name, disposition: row.disposition })), evidence: `${f.teardown.disassembly_event_id}; operator-recorded canonical teardown findings` });
  await checkpoint('teardown REUSE/REPAIR/REPLACE');

  at(f.quotation.revisions[1].issued_date);
  flow.quote = await request(`/commercial/quotes/${flow.quote._id}/revisions`, { expectedVersion: flow.quote.version, ...quoteContent(f.quotation.revisions[1]) });
  flow.quote = await request(`/commercial/quotes/${flow.quote._id}/approve`, { expectedVersion: flow.quote.version, revision: 2 });
  assert.deepEqual(flow.quote.revisions[0], immutableR1);
  const r2 = flow.quote.approvals.find(row => row.revision === 2).snapshot;
  assert.equal(r2.netAmount, f.quotation.revisions[1].totals.net_amount);
  assert.equal(r2.taxAmount, f.quotation.revisions[1].totals.tax_amount);
  assert.equal(r2.total, f.quotation.revisions[1].totals.gross_amount);
  flow.manifest.identities[f.quotation.id] = flow.quote._id;
  flow.manifest.identities[f.quotation.revisions[1].id] = { quoteId: flow.quote._id, revision: 2 };
  await checkpoint('actual approved quotation revision2 with exact VAT');
  at(f.scope_authorization.approved_at);
  await step('scope', { quoteId: flow.quote._id, revision: 2, depositRequired: f.scope_authorization.deposit_commitment, evidence: f.scope_authorization.customer_approval_doc });

  await checkpoint('actual approved revision2 linked to case scope');
  return flow;
}

async function receiveE02Spares(h) {
  // Reuse the canonical-stock owner fixture's qualified location and source pipeline.
  const infrastructure = await companyOwnerFixture(h), f = e02Fixture, ok = h.ok, cmd = companyCommand;
  const items = [], receipts = [], values = [
    { code: f.repair_work_order.material_issues[0].item_code, uom: f.repair_work_order.material_issues[0].uom, cost: f.repair_work_order.material_issues[0].unit_cost, lot: f.repair_work_order.material_issues[0].lot_number },
    { code: f.functional_testing.rework_order.rework_material.item_code, uom: f.functional_testing.rework_order.rework_material.uom, cost: f.functional_testing.rework_order.rework_material.cost, lot: 'E02-SUPPLEMENTAL-BACKUP-RING-LOT' },
  ];
  for (const value of values) {
    const draft = await ok('/inventory-master/items', cmd({ code: value.code, description: value.code, schema: 'INVENTORY_ITEM_V2', kind: 'PURCHASED', uom: value.uom, trackingPolicy: 'LOT' }), 201);
    items.push(await ok(`/inventory-master/items/${draft._id}/approve`, cmd({ expectedVersion: draft.version, revision: 1 })));
  }
  const vendor = await ok('/procurement/vendors', { name: 'Canonical E02 synthetic Parker spare supplier' }, 201);
  let pr = await ok('/catalog-procurement/requests', cmd({ vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: items.map((item, i) => ({ itemId: item._id, itemVersion: item.version, itemRevision: item.currentRevision, quantity: '1.0000', unitPrice: values[i].cost, currency: 'USD' })) }), 201);
  pr = await ok(`/catalog-procurement/requests/${pr._id}/approve`, cmd({ expectedVersion: pr.version, revision: 1 }));
  let po = await ok(`/catalog-procurement/requests/${pr._id}/convert`, cmd({ expectedVersion: pr.version }));
  po = await ok(`/catalog-procurement/orders/${po._id}/issue`, cmd({ expectedVersion: po.version }));
  for (const [index, item] of items.entries()) {
    const receipt = await ok('/catalog-procurement/receipts', cmd({ expectedVersion: po.version, purchaseOrderId: po._id, vendorId: vendor._id, lineId: po.content.lines.find(line => line.itemId === item._id).lineId, quantity: '1.0000', lotNumber: values[index].lot }), 201);
    const path = `/catalog-disposition/receipts/${receipt._id}`;
    let qc = await ok(path);
    qc = await ok(`${path}/inspections`, cmd({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, acceptedQuantity: '1', rejectedQuantity: '0', evidence: 'Synthetic E02 source-backed incoming lot inspection' }));
    qc = await ok(`${path}/approve`, cmd({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, revision: qc.currentRevision }));
    await ok(`${path}/putaway`, cmd({ expectedVersion: qc.version, expectedReceiptVersion: qc.receiptVersion, locationId: infrastructure.location._id, expectedLocationVersion: infrastructure.location.version }));
    receipts.push(receipt);
  }
  return { items, receipts, po, location: infrastructure.location, supplementalCompanyReceiptId: infrastructure.producer.companyStock._id };
}

export async function runE02Flow(h, { setClock, onCheckpoint = async () => {} } = {}) {
  const flow = await runE02Prefix(h, { setClock, onCheckpoint }), f = e02Fixture, ok = h.ok;
  const path = `/repair/cases/${flow.case._id}`;
  const at = value => { setClock(new Date(value)); flow.events.push(iso(value)); };
  const step = async (action, values = {}) => {
    const body = command({ expectedVersion: flow.case.version, ...(!['start', 'bill', 'deposit'].includes(action) ? { evidence: `Original E02 ${action} fixture evidence` } : {}), ...values });
    const actual = await h.req(`${path}/${action}`, body, h.alpha);
    if (actual.status !== 200) {
      flow.manifest.gap = { path: `${path}/${action}`, body, expectedStatus: 200, actual };
      throw new E02IncompleteError(flow.manifest.gap, flow);
    }
    flow.case = actual.data;
    flow.replay.push({ path: `${path}/${action}`, body, result: flow.case });
  };
  const checkpoint = async milestone => { flow.manifest.completed.push(milestone); await onCheckpoint({ milestone, manifest: structuredClone(flow.manifest) }); };
  flow.replay = [];
  await step('decide', { decision: 'ACCEPT', revision: flow.case.scopes.at(-1).revision, evidence: f.scope_authorization.customer_approval_doc });
  at(f.prepayment.received_at);
  await step('deposit', { amount: f.prepayment.initial_amount, currency: f.prepayment.currency, reference: f.prepayment.payment_reference });
  flow.deposit = flow.case.deposits[0];
  at(f.repair_sales_order.order_date);
  await step('orders');
  flow.serviceSalesOrder = await ok(`/repair/sales-orders/${flow.case.serviceOrders.salesOrderId}`);
  flow.serviceWorkOrder = await ok(`/repair/work-orders/${flow.case.serviceOrders.workOrderId}`);
  flow.manifest.identities[f.repair_sales_order.id] = flow.serviceSalesOrder._id;
  flow.manifest.identities[f.repair_work_order.id] = flow.serviceWorkOrder._id;
  flow.manifest.identities[f.prepayment.id] = flow.deposit._id;
  await checkpoint('accepted scope/deposit/typed service SO and WO');
  at(f.repair_work_order.planned_start); await step('start');
  at(f.repair_work_order.material_issues[0].posted_at);
  flow.sources = await receiveE02Spares(h);
  flow.manifest.sourceProvisioning = 'Actual owner company-stock fixture supplies qualified location; supplemental producer stock is unrelated to customer property. Canonical purchased seal kit and backup ring use their own approved item/PO/receipt/inspection/putaway. Backup-ring lot is supplemental because original fixture specifies none.';
  const component = f.teardown.findings.find(value => value.disposition === 'REPLACE').component_name;
  const install = async (index, serial, evidence) => {
    const item = flow.sources.items[index], receipt = flow.sources.receipts[index];
    await step('spare-authorize', { component, sourceKind: 'CATALOG_RECEIPT', itemId: item._id, itemVersion: item.version, itemRevision: item.currentRevision, quantity: '1', uom: item.content.uom, evidence });
    await step('component-remove', { component, serial, condition: evidence, evidence });
    const removed = flow.case.componentRemovals.at(-1), material = flow.case.spareMaterials.at(-1);
    let stock = await ok(`/catalog-stock/receipts/${receipt._id}`);
    await step('spare-reserve', { materialLineId: material.lineId, sourceId: receipt._id, expectedStockVersion: stock.version, expectedReceiptVersion: stock.receiptVersion, quantity: '1', evidence });
    let claim = flow.case.spareClaims.at(-1);
    for (const action of ['spare-issue', 'spare-install']) {
      stock = await ok(`/catalog-stock/receipts/${receipt._id}`);
      await step(action, { materialLineId: material.lineId, reservationId: claim.reservationId, expectedReservationVersion: claim.version, expectedStockVersion: stock.version, expectedReceiptVersion: stock.receiptVersion, ...(action === 'spare-install' ? { removedComponentId: removed.componentId } : {}), evidence });
      claim = flow.case.spareClaims.find(value => value.reservationId === claim.reservationId);
    }
  };
  await install(0, f.teardown.findings[2].component_serial_or_tag, f.teardown.findings[2].condition_observation);
  await step('execute', { dispositions: flow.case.scopes.at(-1).findings });
  const equipmentId = randomUUID(), equipmentPath = `/repair/quality/resources/EQUIPMENT/${equipmentId}`, quality = values => command({ evidence: 'Supplemental synthetic calibration/qualification for original hydrostatic process', ...values });
  await ok(`${equipmentPath}/configure`, quality({ expectedVersion: 0, label: f.functional_testing.run_1_failed.equipment_id, disabled: false }));
  await ok(`${equipmentPath}/calibrate`, quality({ expectedVersion: 1, validFrom: '2026-05-01T00:00:00.000Z', validUntil: '2027-05-01T00:00:00.000Z', certificate: 'E02-SYNTHETIC-CALIBRATION' }));
  const actor = await h.scopeOf(h.alpha);
  await ok(`/repair/quality/resources/OPERATOR/${actor.userId}/qualify`, quality({ expectedVersion: 0, operation: 'HYDROSTATIC_350_BAR', active: true, validFrom: '2026-05-01T00:00:00.000Z', validUntil: '2027-05-01T00:00:00.000Z' }));
  await step('test-plan', { equipmentId, operation: 'HYDROSTATIC_350_BAR' });
  flow.manifest.operatorEvidence = 'Synthetic authenticated owner records fixture technician/inspector evidence; fixture employee names are references, not verified runtime identities or independent inspection.';
  at(f.functional_testing.run_1_failed.tested_at);
  await step('test', { result: 'FAIL', evidence: f.functional_testing.run_1_failed.failure_reason });
  at(f.functional_testing.rework_order.completed_at);
  await install(1, 'E02-DAMAGED-BACKUP-RING', f.functional_testing.rework_order.action_taken);
  flow.manifest.reworkComponentBinding = 'Backup-ring removal/replacement is attributed to the approved seal-kit assembly component slot; original kit remains consumed, never returned to company inventory.';
  await step('rework', { evidence: f.functional_testing.rework_order.action_taken });
  at(f.functional_testing.run_2_passed.passed_at);
  await step('test', { result: 'PASS', evidence: `${f.functional_testing.run_2_passed.target_pressure_bar} bar; ${f.functional_testing.run_2_passed.hold_duration_minutes} minutes; pressure drop ${f.functional_testing.run_2_passed.observed_pressure_drop_bar}` });
  at(f.final_qc_release.release_date); await step('qc', { evidence: f.final_qc_release.certificate_no });
  await checkpoint('source-backed replacement/quarantine/failed test/rework/retest/QC');
  at(f.return_shipment.dispatched_at);
  await step('return', { shipmentMode: f.return_shipment.shipment_mode, carrier: f.return_shipment.carrier, reference: f.return_shipment.consignment_note, packaging: 'Synthetic canonical repaired cylinder transport protection', uom: f.return_shipment.lines[0].uom, evidence: f.return_shipment.id });
  const deliveryPath = `/deliveries/shipments/${flow.case.returnDispatch.shipmentId}`, before = await ok(deliveryPath), pod = f.return_shipment.proof_of_delivery;
  flow.shipment = flow.case.returnDispatch;
  at(pod.delivered_at);
  const podBody = command({ expectedVersion: before.version, expectedShipmentVersion: before.shipmentVersion, quantity: '1', serials: [flow.case.serial], deliveredAt: iso(pod.delivered_at), receiverName: pod.receiver_name, receiverReference: pod.receiver_badge, evidenceReference: pod.pod_id, evidenceNotes: 'Original synthetic E02 POD, operator recorded; no external carrier verification' });
  flow.delivery = await ok(`${deliveryPath}/confirmations`, podBody, 201);
  flow.replay.push({ path: `${deliveryPath}/confirmations`, body: podBody, result: flow.delivery, status: 201 });
  at(f.final_invoice.issued_date); await step('bill');
  flow.invoice = await ok(`/repair/invoices/${flow.case.finalInvoiceId}`);
  assert.equal(flow.invoice.total, f.final_invoice.totals.gross_amount); assert.equal(flow.invoice.depositApplied, f.final_invoice.totals.deposit_applied); assert.equal(flow.invoice.remaining, f.final_invoice.totals.cash_paid);
  at(f.final_invoice.final_payment.received_at);
  const paymentBody = command({ expectedVersion: flow.invoice.version, amount: f.final_invoice.final_payment.amount_received, currency: 'USD', reference: f.final_invoice.final_payment.payment_reference });
  flow.invoice = await ok(`/repair/invoices/${flow.invoice._id}/settle`, paymentBody);
  flow.replay.push({ path: `/repair/invoices/${flow.invoice._id}/settle`, body: paymentBody, result: flow.invoice });
  await step('warranty', { profile: 'POD_CALENDAR_MONTHS_V1', repairWorkOrderId: flow.serviceWorkOrder._id, invoiceId: flow.invoice._id, shipmentId: flow.shipment.shipmentId, confirmationId: flow.delivery.confirmations[0]._id, coverageMonths: f.warranty.coverage_term_months, operatingHoursLimit: f.warranty.coverage_operating_hours, terms: f.warranty.covered_scope, evidence: f.warranty.certificate_no });
  flow.warranty = flow.case.warranty;
  flow.serviceWorkOrder = await ok(`/repair/work-orders/${flow.serviceWorkOrder._id}`);
  flow.serviceSalesOrder = await ok(`/repair/sales-orders/${flow.serviceSalesOrder._id}`);
  Object.assign(flow.manifest.identities, { [f.return_shipment.id]: flow.shipment.shipmentId, [pod.pod_id]: flow.delivery.confirmations[0]._id, [f.final_invoice.id]: flow.invoice._id, [f.warranty.id]: flow.warranty._id, [f.functional_testing.run_1_failed.test_order_id]: flow.case.tests[0]._id, [f.functional_testing.run_2_passed.test_order_id]: flow.case.tests[1]._id, [f.functional_testing.rework_order.id]: flow.case.reworks[0]._id });
  flow.manifest.authorityHashes = { source: flow.delivery.sourceHash, pod: flow.delivery.confirmations[0].contentHash, serviceSalesOrder: flow.serviceSalesOrder.contentHash, serviceWorkOrder: flow.serviceWorkOrder.contentHash, warrantySources: flow.warranty.sources };
  flow.manifest.materials = flow.sources.items.map((item, index) => ({ fixtureItemCode: item.code, itemId: item._id, receiptId: flow.sources.receipts[index]._id, uom: item.content.uom, quantity: '1', claim: flow.case.spareClaims.find(value => value.sourceId === flow.sources.receipts[index]._id), replacement: flow.case.replacements.find(value => value.sourceId === flow.sources.receipts[index]._id), removal: flow.case.componentRemovals[index] }));
  flow.manifest.identities[f.repair_work_order.material_issues[0].movement_id] = { reservationId: flow.manifest.materials[0].claim.reservationId, receiptId: flow.sources.receipts[0]._id };
  flow.manifest.identities[f.final_invoice.final_payment.id] = flow.invoice.payments[0]._id;
  flow.manifest.identities[f.final_invoice.deposit_application.id] = { invoiceId: flow.invoice._id, depositIds: flow.invoice.depositIds };
  await checkpoint('actual dispatch/POD/final invoice/deposit/6990 settlement/exact warranty');

  const rejection = await runE02Prefix(h, { setClock, onCheckpoint });
  let rejectedCase = rejection.case;
  const rejectedPath = `/repair/cases/${rejectedCase._id}`, rejStep = async (action, body) => rejectedCase = await ok(`${rejectedPath}/${action}`, command({ expectedVersion: rejectedCase.version, evidence: 'Original E02 rejection variant', ...body }));
  const r = f.rejection_variant;
  setClock(new Date(r.customer_rejection.rejected_at));
  await rejStep('decide', { decision: 'REJECT', revision: rejectedCase.scopes.at(-1).revision, diagnosticFee: f.diagnostic_authorization.capped_diagnostic_fee });
  await rejStep('orders', {});
  rejection.serviceWorkOrder = await ok(`/repair/work-orders/${rejectedCase.serviceOrders.workOrderId}`);
  setClock(new Date(r.diagnostic_fee_invoice.issued_date));
  rejection.invoice = await ok(`/repair/invoices/${rejectedCase.diagnosticInvoiceId}`);
  assert.equal(rejection.invoice.total, r.diagnostic_fee_invoice.totals.gross_amount);
  setClock(new Date(r.diagnostic_payment.received_at));
  rejection.invoice = await ok(`/repair/invoices/${rejection.invoice._id}/settle`, command({ expectedVersion: rejection.invoice.version, amount: r.diagnostic_payment.amount_received, currency: 'USD', reference: r.diagnostic_payment.payment_reference }));
  setClock(new Date(r.return_unrepaired_shipment.dispatched_at));
  await rejStep('return', { shipmentMode: 'RETURN_UNREPAIRED', carrier: f.return_shipment.carrier, reference: r.return_unrepaired_shipment.shipment_number, packaging: r.return_unrepaired_shipment.packaging_notes, uom: r.return_unrepaired_shipment.lines[0].uom });
  const rejDeliveryPath = `/deliveries/shipments/${rejectedCase.returnDispatch.shipmentId}`, rejView = await ok(rejDeliveryPath), rejPod = r.return_unrepaired_shipment.proof_of_delivery;
  setClock(new Date(rejPod.delivered_at));
  rejection.delivery = await ok(`${rejDeliveryPath}/confirmations`, command({ expectedVersion: rejView.version, expectedShipmentVersion: rejView.shipmentVersion, quantity: '1', serials: [rejectedCase.serial], deliveredAt: iso(rejPod.delivered_at), receiverName: rejPod.receiver_name, receiverReference: rejPod.receiver_badge, evidenceReference: rejPod.pod_id, evidenceNotes: 'Original E02 synthetic unrepaired return POD' }), 201);
  rejection.case = rejectedCase;
  rejection.manifest.identities = { ...rejection.manifest.identities, [r.work_order_action.work_order_id]: rejection.serviceWorkOrder._id, [r.diagnostic_fee_invoice.id]: rejection.invoice._id, [r.return_unrepaired_shipment.id]: rejectedCase.returnDispatch.shipmentId, [rejPod.pod_id]: rejection.delivery.confirmations[0]._id };
  rejection.manifest.status = 'COMPLETE'; rejection.manifest.notRun = [];
  rejection.manifest.completed.push('cancelled-before-release service WO', 'actual diagnostic1200+VAT132 invoice and1332 settlement', 'actual unrepaired dispatch and POD');
  rejection.manifest.notApplicable = ['accepted deposit/final invoice', 'replacement/rework/QC', 'warranty'];
  rejection.manifest.identities[r.diagnostic_payment.id] = rejection.invoice.payments[0]._id;
  rejection.manifest.atomicDiagnosticInvoice = 'Rejection creates the diagnostic invoice atomically with the May14 decision. Original May16 issue date is a fixture reference, not a separately persisted later issue transition.';
  flow.rejection = rejection;
  flow.manifest.notRun = []; flow.manifest.status = 'COMPLETE';
  await checkpoint('accepted and rejected mounted API chains complete');
  return flow;
}
