import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createProviderOperatorHandler, createScopedProviderOperatorHandler } from '../src/provider-operator-http.mjs';

const actions = ['provision', 'revoke', 'configurePolicy', 'activate', 'queueReply', 'approveReply'];
const actor = Object.freeze({ opaque: 'server-session' });
async function invoke({ authenticate = async () => actor, command = async () => ({ revision: 2 }),
  body = JSON.stringify({ action: 'revoke', payload: { commandId: 'same-key' } }), method = 'POST', headers = {} } = {}) {
  const req = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body)]);
  Object.assign(req, { method, headers: { 'content-type': 'application/json', ...headers } });
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = JSON.parse(body); } };
  await createProviderOperatorHandler({ authenticate, commands: Object.fromEntries(actions.map(a => [a, command])) })(req, res);
  return res;
}

test('all explicit actions pass the authenticated actor and exact metadata payload once', async () => {
  for (const action of actions) {
    let calls = 0;
    const res = await invoke({ body: JSON.stringify({ action, payload: { commandId: 'same-key' } }), command: async (principal, payload) => {
      calls++;
      assert.equal(principal, actor);
      assert.deepEqual(payload, { commandId: 'same-key' });
      return { revision: 2 };
    } });
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(res.body, { schema: 'PROVIDER_OPERATOR_RESULT_V1', data: { revision: 2 } });
    assert.equal(calls, 1);
  }
});

test('missing and denied authentication never execute commands', async () => {
  const command = () => assert.fail('unauthenticated dispatch');
  assert.equal((await invoke({ command, authenticate: async () => null })).status, 401);
  assert.equal((await invoke({ command, authenticate: async () => { throw Object.assign(new Error('private'), { status: 403 }); } })).status, 403);
});

test('malformed envelopes, scope overrides, unsupported actions and invalid UTF8 are rejected', async () => {
  const command = () => assert.fail('invalid dispatch');
  for (const body of ['null', '[]', '{', '{"action":"send","payload":{}}',
    '{"action":"revoke","payload":{},"tenantId":"other"}', '{"action":"revoke","payload":[]}',
    '{"action":"toString","payload":{}}', Buffer.from([0xff])]) {
    assert.equal((await invoke({ command, body })).status, 400);
  }
});

test('method, encoding and byte bound prevent dispatch', async () => {
  const command = () => assert.fail('invalid dispatch');
  assert.equal((await invoke({ command, method: 'GET' })).status, 405);
  assert.equal((await invoke({ command, headers: { 'content-encoding': 'gzip' } })).status, 415);
  assert.equal((await invoke({ command, body: Buffer.alloc(8193) })).status, 413);
});

test('denial/conflict remain stable and unknown outcomes never retry or expose exception text', async () => {
  for (const status of [400, 403, 404, 409, 500]) {
    let calls = 0;
    const res = await invoke({ command: async () => { calls++; throw Object.assign(new Error('private body and DB credentials'), { status }); } });
    assert.equal(res.status, status === 500 ? 503 : status);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(res.body).includes('private'));
    if (status === 500) assert.equal(res.body.nextAction, 'RECONCILE_SAME_COMMAND_ID');
  }
});

test('composition fails closed without trusted foundation mapping or source verifier', () => {
  assert.throws(() => createScopedProviderOperatorHandler({}), /INVALID_PROVIDER_OPERATOR_CONFIGURATION/);
  assert.throws(() => createProviderOperatorHandler({ authenticate: async () => actor, commands: {} }), /INVALID_PROVIDER_OPERATOR_HTTP_CONFIGURATION/);
});
