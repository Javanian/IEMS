import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startOwned, command, makeFixture, makeConsumer, getCompany, reserveCompanyBody, reserveDirectLot, executionRoot } from '../../company-stock-use/qa/support.mjs';

export { startOwned, command, makeFixture, makeConsumer, getCompany, reserveCompanyBody, reserveDirectLot, executionRoot };

export async function allSnapshot(h) {
  const names = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort();
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await h.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
}

export async function unchanged(h, effect) {
  const before = await allSnapshot(h), result = await effect();
  assert.deepEqual(await allSnapshot(h), before, 'Read or refused command changed a collection, including authorization or source fences');
  return result;
}

export async function denied(h, path, body, code, status = 409) {
  return unchanged(h, async () => {
    const response = await h.req(path, body, h.alpha);
    assert.equal(response.status, status, JSON.stringify(response));
    assert.equal(response.error.code, code);
    assert.equal(Object.hasOwn(response, 'data'), false);
    return response;
  });
}

export async function replay(h, path, body, expected, guardCount) {
  const before = await allSnapshot(h), tokenHash = createHash('sha256').update(h.alpha.slice('portfolio_session='.length)).digest('hex');
  const session = before.sessions.find(row => row.tokenHash === tokenHash);
  assert.ok(session);
  const plant = before.plants.find(row => row._id === session.selectedPlantId);
  const targets = { sessions: session._id, memberships: session.membershipId, users: session.userId, tenants: session.tenantId, plants: plant._id, legalEntities: plant.legalEntityId };
  const expectedSnapshot = { ...before };
  for (const [name, id] of Object.entries(targets)) {
    assert.equal(before[name].filter(row => row._id === id).length, 1);
    expectedSnapshot[name] = before[name].map(row => row._id === id ? { ...row, crmFence: (row.crmFence ?? 0) + guardCount } : row);
  }
  const response = await h.req(path, body, h.alpha);
  assert.equal(response.status, 200, JSON.stringify(response));
  assert.deepEqual(response.data, expected, 'Exact replay changed its immutable stored result');
  assert.deepEqual(await allSnapshot(h), expectedSnapshot, 'Replay changed more than the exact current six authority fences');
  return response.data;
}

export async function revokedReplay(h, path, body, roles) {
  const credential = await h.db.collection('credentials').findOne({ username: 'alpha.owner' });
  const membership = await h.db.collection('memberships').findOne({ userId: credential._id });
  await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: roles.map(role => ({ role, plantIds: membership.plantIds, tenantWide: false })) } });
  try { await denied(h, path, body, 'SCOPE_DENIED', 403); }
  finally { await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: membership.roles } }); }
}

export async function reserve(h, fixture, job, selectedUnitId) {
  const source = await getCompany(h, fixture.producer.companyStock._id), unit = source.units.find(row => row._id === selectedUnitId);
  const body = reserveCompanyBody(job, source, [unit], fixture.componentItem._id), path = `${executionRoot}/${job._id}/reservations`;
  const result = await h.ok(path, body);
  const added = result.reservations.filter(row => !job.reservations.some(previous => previous._id === row._id));
  assert.equal(added.length, 1);
  assert.equal(added[0].status, 'RESERVED');
  assert.deepEqual(added[0].companyUnitIds, [selectedUnitId]);
  return { job: result, claim: added[0], body, path, result };
}

export async function release(h, job, claim) {
  const source = await getCompany(h, claim.companyReceiptId), path = `${executionRoot}/${job._id}/reservations/${claim._id}/release`;
  const body = command({ expectedVersion: job.version, expectedStockVersion: source.version }), result = await h.ok(path, body);
  assert.equal(result.reservations.find(row => row._id === claim._id).status, 'RELEASED');
  return { job: result, path, body, result };
}

export async function hold(h, receiptId, releaseHold = false) {
  const source = await getCompany(h, receiptId), path = `/company-stock/receipts/${receiptId}/holds${releaseHold ? '/release' : ''}`;
  const body = command({ expectedVersion: source.version, ...(releaseHold ? { expectedHoldId: source.hold._id } : { reasonCode: 'TRACE_REVIEW' }) });
  const result = await h.ok(path, body);
  assert.equal(result.version, source.version + 1);
  assert.equal(result.hold.active, !releaseHold);
  return { path, body, result };
}

export async function makeReleasedClaimFixture(h, { count = 100 } = {}) {
  assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= 100);
  const fixture = await makeFixture(h), receiptId = fixture.producer.companyStock._id;
  const unitId = fixture.producer.companyStock.units[0]._id, jobs = [];
  for (let index = 0; index < Math.ceil(count / 20) + 1; index++) jobs.push(await makeConsumer(h, fixture));
  for (let number = 1; number <= count; number++) {
    const index = Math.floor((number - 1) / 20), reserved = await reserve(h, fixture, jobs[index], unitId);
    jobs[index] = (await release(h, reserved.job, reserved.claim)).job;
  }
  return { fixture, jobs, receiptId, unitId, source: await getCompany(h, receiptId) };
}
