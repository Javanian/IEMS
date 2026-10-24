import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';

test('request-local preview claims do not scan or cancel unrelated queued deliveries', async t => {
  const { db, runtime, seeded: [a] } = await startOwned(t);
  const unrelated = randomUUID(), selected = randomUUID();
  await db.collection('cs_outbox').insertOne({ _id: unrelated, tenantId: a.tenantId, channelAccountId: 'SIMULATED', state: 'QUEUED', nextAttemptAt: new Date(0), seq: 1, bindingId: randomUUID(), conversationId: randomUUID(), expiresAt: new Date(0), history: [] });
  assert.equal(await runtime.customerServicePreview.claimNextDelivery({ tenantId: a.tenantId, channelAccountId: 'SIMULATED', leaseOwner: 'test', deliveryIds: [selected] }), null);
  assert.equal((await db.collection('cs_outbox').findOne({ _id: unrelated })).state, 'QUEUED');
});
