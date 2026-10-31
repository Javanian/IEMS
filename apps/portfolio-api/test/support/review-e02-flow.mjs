import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

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

export async function runE02Flow(h, { setClock, onCheckpoint = async () => {} } = {}) {
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
  flow.case = await request('/repair/cases', command({ accountId: flow.account._id, serial: f.customer_asset.serial_no, condition: f.repair_case.customer_reported_fault, currency: f.quotation.currency }), 201);
  flow.manifest.identities[f.customer_asset.id] = { caseId: flow.case._id, serial: flow.case.serial, ownership: 'CUSTOMER_OWNED_NON_INVENTORY' };
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

  await checkpoint('scope linked; remaining stages require runner continuation after domain repair');
  return flow;
}
