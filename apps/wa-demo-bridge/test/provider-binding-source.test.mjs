import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderBindingSource } from '../src/provider-binding-source.mjs';
const tenantId = '11111111-1111-4111-8111-111111111111';
const plantId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const bindingId = '44444444-4444-4444-8444-444444444444';
function fixture(patch = {}) {
  const session = { inTransaction: () => true };
  const request = { bindingId, version: 2, recipient: 'synthetic-recipient', customerId };
  const key = { _id: bindingId, tenantId, plantId, channelAccountId: 'synthetic-account', providerContactId: request.recipient, customerId, version: 2, status: 'ACTIVE' };
  const f = { party: true, matched: 1, fences: 0, verifies: 0 };
  f.read = createProviderBindingSource({ tenantId, plantId, accountId: 'synthetic-account', verifiedMethods: ['TEST_VERIFIED'], now: () => 1000,
    db: { collection(name) { assert.equal(name, 'cs_contact_bindings'); return {
      async findOne(query, options) { assert.deepEqual(query, key); assert.equal(options.session, session); assert.equal(options.projection.address, undefined);
        return { accountId: customerId, contactId: tenantId, channel: 'TEST', synthetic: false, verifiedMethod: 'TEST_VERIFIED', verifiedAt: new Date(500), expiresAt: new Date(2000), ...patch }; },
      async updateOne(query, update, options) { assert.deepEqual(query, key); assert.equal(options.session, session); assert.deepEqual(update, { $inc: { commandFence: 1 } }); f.fences++; return { matchedCount: f.matched }; },
    }; } },
    partyDirectory: { async verifyCustomerContact(query, options) { assert.deepEqual(query, { tenantId, plantId, accountId: customerId, contactId: tenantId }); assert.equal(options.session, session); f.verifies++; return f.party; } },
  });
  return { ...f, get counts() { return f; }, read: f.read, session, request };
}
test('source read scopes every boundary, verifies CRM and fences the same binding row', async () => {
  const f = fixture(); const result = await f.read(f.request, f.session);
  assert.equal(result.expiresAt, 2000); assert.equal(result.version, 2);
  assert.equal(f.counts.fences, 1); assert.equal(f.counts.verifies, 1);
  assert.equal(result.contactId, undefined); assert.equal(result.verifiedMethod, undefined);
});
test('fixture, simulated, unknown verification and expired or mismatched source cannot confer authority', async () => {
  for (const patch of [{ synthetic: true }, { synthetic: undefined }, { channel: 'SIMULATED' }, { channel: 'FIXTURE' },
    { verifiedMethod: 'ADMIN_FIXTURE' }, { verifiedMethod: 'OPERATOR_ONBOARDING' }, { accountId: plantId },
    { expiresAt: null }, { expiresAt: new Date(1000) }, { verifiedAt: new Date(1001) }, { contactId: 'bad' }]) {
    const f = fixture(patch); await assert.rejects(f.read(f.request, f.session), /SOURCE_DENIED/); assert.equal(f.counts.fences, 0);
  }
});
test('denied CRM, lost fence, malformed metadata and absent transaction fail closed', async () => {
  const f = fixture(); f.counts.party = false;
  await assert.rejects(f.read(f.request, f.session), /SOURCE_DENIED/); assert.equal(f.counts.fences, 0);
  f.counts.party = true; f.counts.matched = 0;
  await assert.rejects(f.read(f.request, f.session), /SOURCE_DENIED/);
  await assert.rejects(f.read({ ...f.request, body: 'private' }, f.session), /SOURCE_DENIED/);
  await assert.rejects(f.read(f.request, {}), /SOURCE_DENIED/);
});
