import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderActivation } from '../src/provider-activation.mjs';
const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const input = () => ({ commandId: userId, recipient: 'contact', customerId: tenantId, sourceBindingId: userId,
  sourceBindingVersion: 1, identityRevision: 1, bindingRevision: 1, expiresAt: 2000 });
function fixture() {
  let rows = { provider_authority: ['identity', 'binding'].map(kind => ({ tenantId, accountId: 'account', kind,
    resourceId: 'contact', authorityRevision: 1, version: 1, active: false })), provider_commands: [], provider_audit: [], provider_outbox: [] };
  let session;
  const f = { denied: false, badSource: false, failOutbox: false, staleBinding: false, sourceCalls: 0 };
  const match = (r, k) => Object.entries(k).every(([a,b]) => r[a] === b);
  const db = { collection(name) { return {
    async findOne(key, opts) { assert.equal(opts.session, session); return structuredClone(rows[name].find(r => match(r,key))); },
    async updateOne(key, update, opts) { assert.equal(opts.session, session);
      const row = rows[name].find(r => match(r,key));
      if (!row || (f.staleBinding && key.kind === 'binding')) return { matchedCount: 0 };
      Object.assign(row, update.$set); for (const [k,v] of Object.entries(update.$inc)) row[k] += v;
      return { matchedCount: 1 };
    },
    async insertOne(row, opts) { assert.equal(opts.session, session); if (name === 'provider_outbox' && f.failOutbox) throw Error('STORAGE_UNKNOWN'); rows[name].push(structuredClone(row)); },
  }; } };
  f.activate = createProviderActivation({ db, tenantId, accountId: 'account', now: () => 1000,
    async transaction(fn) { const before = structuredClone(rows); session = { inTransaction: () => true };
      try { return await fn(session); } catch(e) { rows = before; throw e; } },
    async authorize(actor, request, s) { assert.equal(s, session); assert.equal(request.action, 'provider.authority.configure');
      if (f.denied) throw Error('DENIED'); return { tenantId, accountId: 'account', userId }; },
    async verifyBindingSource(request, s) { assert.equal(s, session); f.sourceCalls++;
      if (f.badSource) throw Error('SOURCE_DENIED'); return { tenantId, accountId: 'account', ...request, expiresAt: 3000 }; },
  });
  f.rows = () => structuredClone(rows); return f;
}
test('activation advances both versions and replay revalidates source without rewriting authority', async () => {
  const f = fixture(); const result = await f.activate('actor', input());
  assert.equal(result.identityVersion, 2); assert.equal(result.bindingVersion, 2);
  assert.equal(f.rows().provider_authority[1].sourceBindingId, userId);
  assert.deepEqual(await f.activate('actor', input()), result); assert.equal(f.sourceCalls, 2);
  assert.equal(f.rows().provider_audit.length, 1);
  f.badSource = true; await assert.rejects(f.activate('actor', input()), /SOURCE_DENIED/);
  f.denied = true; await assert.rejects(f.activate('actor', input()), /DENIED/);
});
test('second CAS and outbox failure roll back both authorities and receipts', async () => {
  const f = fixture(); const before = f.rows(); f.staleBinding = true;
  await assert.rejects(f.activate('actor', input()), /FENCED/); assert.deepEqual(f.rows(), before);
  f.staleBinding = false; f.failOutbox = true;
  await assert.rejects(f.activate('actor', input()), /STORAGE_UNKNOWN/); assert.deepEqual(f.rows(), before);
});
test('malformed, expired, source overflow and conflicting commands fail closed', async () => {
  const f = fixture();
  for (const patch of [{ body: 'private' }, { identityRevision: 0 }, { expiresAt: 1000 }, { expiresAt: 4000 }]) {
    await assert.rejects(f.activate('actor', { ...input(), ...patch }));
  }
  assert.equal(f.rows().provider_commands.length, 0);
  await f.activate('actor', input());
  await assert.rejects(f.activate('actor', { ...input(), expiresAt: 2100 }), /CONFLICT/);
});
