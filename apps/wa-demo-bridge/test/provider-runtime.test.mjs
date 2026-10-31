import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { createLocalProviderRuntime } from '../src/provider-runtime.mjs';
import { createScopedProviderOperatorHandler } from '../src/provider-operator-http.mjs';

const response = () => ({ writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = JSON.parse(body); } });
const request = body => Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'POST', headers: { 'content-type': 'application/json' } });
function config() {
  const indexes = [];
  return { indexes, options: { tenantId: randomUUID(), plantId: randomUUID(), accountId: 'synthetic-account',
    db: { collection: name => ({ createIndex: async (...args) => { indexes.push({ name, args }); } }) },
    transaction: () => assert.fail('no effect transaction expected'), foundation: { authorizeInTransaction: () => assert.fail('no operator action expected') },
    partyDirectory: { verifyCustomerContact: () => assert.fail('no source read expected') },
    verifiedMethods: ['SIGNED_PROVIDER_CHALLENGE'], authenticate: async () => null, callbackSecret: Buffer.alloc(32, 1),
    browser: { ownerId: 'local-owner', executablePath: process.execPath, scratchRoot: process.env.PAPERCLIP_RUN_SCRATCH_DIR },
  } };
}
test('local composition performs no implicit database/browser effects and refuses send enablement', () => {
  const { options, indexes } = config();
  assert.throws(() => createLocalProviderRuntime({ ...options, externalSendEnabled: true }), /INVALID_LOCAL_PROVIDER_RUNTIME/);
  const runtime = createLocalProviderRuntime(options);
  assert.equal(indexes.length, 0); assert.equal(runtime.status().externalSendEnabled, false);
  assert.throws(() => runtime.start(), /LOCAL_PROVIDER_NOT_INITIALIZED/);
  assert.equal(runtime.status().lifecycle.browser.pid, null);
});
test('explicit initialization declares all constraints and separate handler trust boundaries remain closed', async () => {
  const { options, indexes } = config(), runtime = createLocalProviderRuntime(options), early = response();
  await runtime.operatorHandler(request({}), early); assert.equal(early.status, 503);
  await runtime.initialize(); assert.equal(indexes.length, 7);
  const operator = response(); await runtime.operatorHandler(request({ action: 'provision', payload: {} }), operator);
  assert.equal(operator.status, 401);
  const callback = response(); await runtime.callbackHandler(request({}), callback); assert.equal(callback.status, 401);
  assert.equal(runtime.status().lifecycle.browser.pid, null);
});
test('composed numeric clock is adapted to the revocation Date contract', async () => {
  const { options } = config(), session = { inTransaction: () => true }, at = 1767225600000, events = [];
  const handler = createScopedProviderOperatorHandler({ ...options, now: () => at, authenticate: async () => ({}),
    transaction: fn => fn(session), foundation: { authorizeInTransaction: async () => ({ tenantId: options.tenantId, plantId: options.plantId, userId: randomUUID() }) },
    verifyBindingSource: async () => assert.fail('revoke does not need a source binding'),
    db: { collection: name => ({ findOne: async () => null, updateOne: async () => ({ matchedCount: 1 }),
      insertOne: async row => { events.push({ name, row }); } }) },
  });
  const res = response(); await handler(request({ action: 'revoke', payload: { commandId: randomUUID(), kind: 'policy', resourceId: 'account', expectedRevision: 1 } }), res);
  assert.equal(res.status, 200); assert.ok(events.length > 0);
  assert.ok(events.every(e => e.row.at instanceof Date && e.row.at.getTime() === at));
});
