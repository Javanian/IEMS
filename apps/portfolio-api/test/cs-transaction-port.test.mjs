import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';

test('API CS forwards late-bound additive transaction authorization with the active session', async t => {
  const h = await startOwned(t, { customerService: { allowSyntheticOrders: true } });
  const member = h.seeded[0];
  await h.db.collection('memberships').updateOne({ _id: member.membershipId }, { $push: { roles: { role: 'csFixtureAdmin', plantIds: [member.plantId], tenantWide: false } } });
  const scope = await h.scopeOf(h.alpha);
  const original = h.runtime.foundation.authorizeInTransaction.bind(h.runtime.foundation);
  let calls = 0;
  h.runtime.foundation = { ...h.runtime.foundation, authorizeInTransaction: async (actor, target, options) => {
    assert.equal(options.session.inTransaction(), true); calls++;
    return original(actor, target, options);
  } };
  await h.runtime.customerService.provisionFixtureCustomer(scope, { plantId: member.plantId, customerId: randomUUID(), label: 'Synthetic adapter transaction test' });
  assert.ok(calls > 0, 'CS mutator must invoke the additive transaction authorization port');
});
