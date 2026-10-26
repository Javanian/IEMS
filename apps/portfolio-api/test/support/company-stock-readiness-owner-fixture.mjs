import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { companyOwnerFixture, companyCommand } from './company-stock-owner-fixture.mjs';

export const command = companyCommand;
export const executionPath = job => `/internal-execution/orders/${job._id}`;
export const sourcePath = source => `/company-stock/receipts/${source._id}`;

export async function allSnapshot(h) {
  const names = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort();
  const result = {};
  for (const name of names) result[name] = await h.db.collection(name).find({}).sort({ _id: 1 }).toArray();
  return result;
}

export function authorizationOnly(before, h, delta) {
  const person = h.seeded[0], tokenHash = createHash('sha256').update(h.alpha.slice('portfolio_session='.length)).digest('hex');
  const plant = before.plants.find(row => row._id === person.plantId);
  const selected = { sessions: before.sessions.find(row => row.tokenHash === tokenHash)._id,
    memberships: person.membershipId, users: person.userId, tenants: person.tenantId,
    plants: person.plantId, legalEntities: plant.legalEntityId };
  const result = { ...before };
  for (const [name, id] of Object.entries(selected)) {
    assert.equal(before[name].filter(row => row._id === id).length, 1);
    result[name] = before[name].map(row => row._id === id ? { ...row, crmFence: (row.crmFence || 0) + delta } : row);
  }
  return result;
}

export async function denied(h, path, body, code, status = 409) {
  const before = await allSnapshot(h), response = await h.req(path, body, h.alpha);
  assert.equal(response.status, status, JSON.stringify(response));
  assert.equal(response.error.code, code);
  assert.deepEqual(await allSnapshot(h), before, 'Rejected boundary command changed durable state, including authorization');
}

export function sourceFromJob(job, sourceId) {
  const source = job.companyStockSources.find(row => row._id === sourceId);
  assert.ok(source, 'Returned command must include the actual selected company receipt');
  return source;
}

export function reserveBody(fixture, job, source, unitId) {
  const unit = source.units.find(row => row._id === unitId);
  assert.ok(unit);
  return command({ expectedVersion: job.version, sourceKind: 'COMPANY_OUTPUT',
    materialLineId: job.materials.find(row => row.itemId === fixture.component._id).lineId,
    companyReceiptId: source._id, expectedStockVersion: source.version,
    quantity: '1', units: [{ companyUnitId: unit._id, expectedUnitVersion: unit.version }] });
}

export async function reserve(h, fixture, job, source, unitId) {
  const body = reserveBody(fixture, job, source, unitId);
  const result = await h.ok(`${executionPath(job)}/reservations`, body);
  const claim = result.reservations.find(row => row.companyReceiptId === source._id && row.status === 'RESERVED');
  assert.ok(claim, 'Exactly the new active claim is selected, independent of UUID order');
  assert.equal(result.reservations.filter(row => row.status === 'RESERVED').length, 1);
  return { job: result, source: sourceFromJob(result, source._id), claim, body };
}

export function abandonBody(job, source) {
  return command({ expectedVersion: job.version, expectedStockVersion: source.version });
}

export async function abandon(h, job, source, claim) {
  const body = abandonBody(job, source);
  const result = await h.ok(`${executionPath(job)}/reservations/${claim._id}/release`, body);
  assert.equal(result.reservations.find(row => row._id === claim._id).status, 'RELEASED');
  return { job: result, source: sourceFromJob(result, source._id), body };
}

export async function openingEvidence(h, source) {
  const receipt = await h.db.collection('internalCompanyStockReceipts').findOne({ _id: source._id });
  const units = await h.db.collection('internalCompanyStockUnits').find({ companyReceiptId: source._id }).sort({ _id: 1 }).toArray();
  const outputs = await h.db.collection('internalOutputUnits').find({ executionId: receipt.executionId }).sort({ _id: 1 }).toArray();
  return { receipt, units, outputs };
}

export async function makeReadinessFixture(h) {
  // Reuse the earlier owner producer setup, not the independently authored QA fixture.
  const fixture = await companyOwnerFixture(h);
  return fixture;
}

export async function makeThreeUnitEventSource(h, fixture) {
  const demand = await fixture.plan(fixture.component, '3', [[fixture.direct, '1']]);
  let producer = await fixture.execute(demand);
  producer = await fixture.reserveRaw(producer, fixture.directReceipt, fixture.direct, '3');
  producer = await fixture.mutate(producer, 'release');
  producer = await fixture.mutate(producer, 'issue');
  producer = await fixture.mutate(producer, 'records', { operationIndex: 0, inputQuantity: '3', goodQuantity: '3',
    scrapQuantity: '0', laborMinutes: '1', machineMinutes: '0', evidence: 'Actual owner boundary-source first operation' });
  const serials = Array.from({ length: 3 }, (_, index) => `P2-OWNER-${randomUUID()}-${index}`);
  producer = await fixture.mutate(producer, 'records', { operationIndex: 1, inputQuantity: '3', goodQuantity: '3',
    scrapQuantity: '0', laborMinutes: '1', machineMinutes: '0', evidence: 'Actual owner boundary-source final output', outputSerials: serials });
  for (const unit of producer.outputUnits) producer = await fixture.mutate(producer, 'allocations', {
    outputUnitId: unit._id, sources: [{ receiptId: fixture.directReceipt._id, quantity: '1' }] });
  producer = await fixture.mutate(producer, 'qc', { acceptedSerials: serials, rejectedSerials: [], evidence: 'Actual three accepted owner boundary-source units' });
  producer = await fixture.mutate(producer, 'putaway', { locationId: fixture.location._id, expectedLocationVersion: fixture.location.version });
  const source = await h.ok(`/company-stock/receipts/${producer.companyStock._id}`);
  assert.equal(source.availableQuantity, '3');
  assert.equal(source.version, 1);
  return source;
}
