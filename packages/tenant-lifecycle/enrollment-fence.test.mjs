import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { admissionProfile } from './admission.mjs';
import { allSnapshot, authorizationOnly, denied, makeReadinessFixture, reserve, executionPath }
  from '../../apps/portfolio-api/test/support/company-stock-readiness-owner-fixture.mjs';

test('company replay commits only exact authorization fences; denial rolls every fence back', { timeout: 120000 }, async t => {
  const h = await startOwned(t), fixture = await makeReadinessFixture(h);
  const source = await fixture.company(), job = await fixture.consumer('1');
  const active = await reserve(h, fixture, job, source, source.units[0]._id);
  const admission = h.runtime.saasAdmission, calls = [], observed = { ...admission };
  for (const name of ['authorize', 'effect']) {
    const original = admission[name];
    observed[name] = async (...args) => {
      const session = name === 'authorize' ? args[1].session : args[0].session;
      assert.equal(session.inTransaction(), true);
      calls.push({ name, session });
      return original(...args);
    };
  }
  h.runtime.saasAdmission = observed;
  t.after(() => { h.runtime.saasAdmission = admission; });
  const path = `${executionPath(active.job)}/reservations`;
  for (let index = 0; index < 2; index++) {
    calls.length = 0;
    const before = await allSnapshot(h);
    assert.deepEqual(await h.ok(path, active.body), active.job);
    assert.deepEqual(calls.map(call => call.name), ['authorize', 'authorize', 'effect']);
    assert.ok(calls.every(call => call.session === calls[0].session));
    // Both guards and the receipt hook fence enrollment; no other durable write is allowed.
    assert.deepEqual(await allSnapshot(h), authorizationOnly(before, h, 2, 3));
  }
  const actor = h.seeded[0];
  await h.db.collection('memberships').updateOne({ _id: actor.membershipId }, { $set: { tenantWide: true, roles: [
    { role: 'owner', plantIds: [actor.plantId], tenantWide: false },
    { role: 'saasOperator', plantIds: [], tenantWide: true },
    { role: 'saasUser', plantIds: [actor.plantId], tenantWide: false }
  ] } });
  await h.ok('/saas/subscribe', { key: randomUUID(), expectedRevision: 0, plan: 'pilot', reason: 'Owned enrollment replay proof', admissionProfile });
  for (let index = 0; index < 2; index++) {
    const before = await allSnapshot(h);
    assert.deepEqual(await h.ok(path, active.body), active.job);
    const expected = authorizationOnly(before, h, 2, 3, 4);
    expected.saasSubscriptions = before.saasSubscriptions.map(row => row.tenantId === actor.tenantId
      ? { ...row, admissionFence: (row.admissionFence || 0) + 3 } : row);
    assert.deepEqual(await allSnapshot(h), expected, 'legacy receipt replay after enrollment reauthorizes without domain, quota, rate, audit or outbox writes');
  }
  await denied(h, path, { ...active.body, reason: 'Changed replay payload' }, 'IDEMPOTENCY_CONFLICT');
  const restore = await h.setRoles(h.seeded[0], ['internalExecutionReserve', 'companyStockReader']);
  try { await denied(h, path, active.body, 'SCOPE_DENIED', 403); }
  finally { await restore(); }
  const tenant = await h.db.collection('tenants').findOne({ _id: h.seeded[0].tenantId });
  await h.db.collection('tenants').updateOne({ _id: tenant._id }, { $set: { active: false } });
  try { await denied(h, path, active.body, 'UNAUTHENTICATED', 401); }
  finally { await h.db.collection('tenants').replaceOne({ _id: tenant._id }, tenant); }
});
