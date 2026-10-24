import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';

test('strict runtime reproduces legacy denial; preview consumer is SIMULATED only and cannot record SENT', async t => {
  const h = await startOwned(t, { customerService: { previewDispatcher: true } });
  const { runtime, seeded: [a], db } = h;
  const input = { tenantId: a.tenantId, deliveryId: randomUUID(), fence: 1, outcome: 'PREVIEWED' };
  await assert.rejects(runtime.customerService.recordDeliveryResult(input), e => e.code === 'DENIED');
  await assert.rejects(runtime.customerServicePreview.claimNextDelivery({ tenantId: a.tenantId, channelAccountId: 'synthetic-browser-preview', leaseOwner: 'test' }), e => e.code === 'DENIED');
  await assert.rejects(runtime.customerServicePreview.recordDeliveryResult({ ...input, outcome: 'SENT', providerMessageId: 'forbidden-provider-id' }), e => e.code === 'DENIED');
  assert.equal(await runtime.customerServicePreview.claimNextDelivery({ tenantId: a.tenantId, channelAccountId: 'SIMULATED', leaseOwner: 'test' }), null);
  assert.equal(await db.collection('cs_outbox').countDocuments(), 0);
});
