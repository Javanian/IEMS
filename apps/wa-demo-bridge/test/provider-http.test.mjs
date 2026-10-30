import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import { createProviderCallbackHandler } from '../src/provider-http.mjs';
import { createProviderCallbackVerifier } from '../src/provider-callback.mjs';

const secret = Buffer.alloc(32, 7), timestamp = '1793380000000';
const body = Buffer.from(JSON.stringify({ version: 1, tenantId: '11111111-1111-4111-8111-111111111111',
  accountId: 'test', eventId: 'evt1', deliveryId: '22222222-2222-4222-8222-222222222222', providerMessageId: 'msg1', status: 'DELIVERED' }));
const signature = createHmac('sha256', secret).update(timestamp).update('.').update(body).digest('hex');
async function invoke(reconcile, { chunks = [body], method = 'POST', headers = {} } = {}) {
  const req = Readable.from(chunks);
  Object.assign(req, { method, headers: { 'content-type': 'application/json', 'x-iems-timestamp': timestamp, 'x-iems-signature': signature, ...headers } });
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(data) { this.body = JSON.parse(data); } };
  await createProviderCallbackHandler(reconcile)(req, res);
  return res;
}
test('exact split bytes reach verifier and receipt is returned', async () => {
  const verify = createProviderCallbackVerifier({ ...JSON.parse(body), secret, now: () => Number(timestamp) });
  const res = await invoke(async envelope => ({ state: verify(envelope).status }), { chunks: [body.subarray(0, 30), body.subarray(30)] });
  assert.equal(res.status, 200);
  assert.equal(res.body.state, 'DELIVERED');
  assert.equal(res.headers['cache-control'], 'no-store');
});
test('tampered bytes fail authentication', async () => {
  const verify = createProviderCallbackVerifier({ ...JSON.parse(body), secret, now: () => Number(timestamp) });
  assert.equal((await invoke(verify, { chunks: [Buffer.concat([body, Buffer.from(' ')])] })).status, 401);
});
test('method, encoding and size reject before reconciliation', async () => {
  let calls = 0;
  const consume = async () => { calls++; };
  assert.equal((await invoke(consume, { method: 'GET' })).status, 405);
  assert.equal((await invoke(consume, { headers: { 'content-encoding': 'gzip' } })).status, 415);
  assert.equal((await invoke(consume, { chunks: [Buffer.alloc(4097)] })).status, 413);
  assert.equal(calls, 0);
});
test('conflict and unknown failures expose only stable error codes without retry', async () => {
  let calls = 0;
  const res = await invoke(async () => { calls++; throw new Error('private database details'); });
  assert.equal(res.status, 503);
  assert.equal(calls, 1);
  assert.equal(res.body.error, 'CALLBACK_RECONCILIATION_UNAVAILABLE');
  assert.equal((await invoke(async () => { throw Object.assign(new Error('private'), { status: 409 }); })).status, 409);
});
