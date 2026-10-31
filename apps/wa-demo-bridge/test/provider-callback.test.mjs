import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createProviderCallbackVerifier } from '../src/provider-callback.mjs';

const secret = Buffer.alloc(32, 7);
const tenantId = '11111111-1111-4111-8111-111111111111';
const accountId = 'synthetic-account';
const time = 1793385000000;
const body = { version: 1, tenantId, accountId, eventId: 'event:1', deliveryId: '22222222-2222-4222-8222-222222222222', providerMessageId: 'provider:1', status: 'DELIVERED' };
const verify = createProviderCallbackVerifier({ tenantId, accountId, secret, now: () => time });
function envelope(value = body, timestamp = String(time)) {
  const rawBody = Buffer.from(JSON.stringify(value));
  return { rawBody, timestamp, signature: createHmac('sha256', secret).update(timestamp).update('.').update(rawBody).digest('hex') };
}

test('verified metadata is immutable; authentication alone does not consume an event', () => {
  assert.deepEqual(verify(envelope()), body);
  assert.ok(Object.isFrozen(verify(envelope())));
  assert.deepEqual(verify(envelope()), body);
});

test('rejects unsigned changes, malformed signature, stale and future timestamps', () => {
  const input = envelope();
  for (const changed of [
    { ...input, rawBody: Buffer.from('{}') }, { ...input, signature: '0'.repeat(64) },
    { ...input, signature: 'x' }, envelope(body, String(time - 300001)),
    envelope(body, String(time + 300001)), { ...input, rawBody: '{}' },
  ]) assert.throws(() => verify(changed), { message: 'INVALID_PROVIDER_CALLBACK' });
});

test('rejects authenticated cross-scope, private fields and invalid delivery metadata', () => {
  for (const changed of [
    { ...body, accountId: 'other' }, { ...body, tenantId: body.deliveryId },
    { ...body, text: 'synthetic forbidden field' }, { ...body, deliveryId: 'bad' },
    { ...body, status: 'READ' }, { ...body, eventId: {} }, { ...body, providerMessageId: '' },
    null, [],
  ]) assert.throws(() => verify(envelope(changed)), { message: 'INVALID_PROVIDER_CALLBACK' });
});

test('configuration rejects weak keys and verifier copies the configured key', () => {
  assert.throws(() => createProviderCallbackVerifier({ tenantId, accountId, secret: Buffer.alloc(8) }));
  const mutable = Buffer.from(secret);
  const check = createProviderCallbackVerifier({ tenantId, accountId, secret: mutable, now: () => time });
  mutable.fill(0);
  assert.deepEqual(check(envelope()), body);
});
