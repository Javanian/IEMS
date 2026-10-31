import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedProviderProvisioningCommands } from '../src/provider-operator.mjs';

const tenantId = '11111111-1111-4111-8111-111111111111';
const plantId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const commandId = '44444444-4444-4444-8444-444444444444';
const input = () => ({ commandId, kind: 'policy', resourceId: 'account',
  metadata: { expiresAt: 2000, allowlist: ['synthetic'], prefix: 'IEMS ' } });
function fixture() {
  let rows = { provider_authority: [], provider_commands: [], provider_audit: [], provider_outbox: [] };
  let active;
  const f = { denied: false, failOutbox: false, calls: 0, at: 1000 };
  const db = { collection(name) { return {
    async findOne(key, { session }) {
      assert.equal(session, active);
      return rows[name].find(row => Object.entries(key).every(([k, v]) => row[k] === v));
    },
    async insertOne(row, { session }) {
      assert.equal(session, active);
      if (name === 'provider_outbox' && f.failOutbox) throw new Error('UNKNOWN_STORAGE');
      rows[name].push(structuredClone(row));
    },
  }; } };
  f.commands = createScopedProviderProvisioningCommands({ db, tenantId, plantId, accountId: 'synthetic', now: () => f.at,
    async transaction(fn) {
      const before = structuredClone(rows);
      active = { inTransaction: () => true };
      try { return await fn(active); } catch (error) { rows = before; throw error; }
    },
    foundation: { async authorizeInTransaction(actor, request, { session }) {
      f.calls++;
      assert.equal(actor, 'opaque');
      assert.equal(session, active);
      assert.deepEqual(request, { tenantId, plantId, action: 'provider.authority.provision' });
      if (f.denied) throw new Error('DENIED');
      return { tenantId, plantId, userId };
    } },
  });
  f.rows = () => structuredClone(rows);
  return f;
}

test('inactive metadata and receipt commit atomically; expired replay still reauthorizes', async () => {
  const f = fixture();
  const result = await f.commands.provision('opaque', input());
  assert.deepEqual(result, { kind: 'policy', resourceId: 'account', authorityRevision: 1 });
  const row = f.rows().provider_authority[0];
  assert.equal(row.enabled, false);
  assert.equal(row.paused, true);
  f.at = 3000;
  assert.deepEqual(await f.commands.provision('opaque', input()), result);
  assert.equal(f.rows().provider_authority.length, 1);
  assert.equal(f.rows().provider_audit.length, 1);
  assert.equal(f.rows().provider_outbox.length, 1);
  assert.equal(f.calls, 2);
  f.denied = true;
  await assert.rejects(f.commands.provision('opaque', input()), /DENIED/);
});

test('private fields, live activation, malformed kinds and expiry are rejected', async () => {
  const f = fixture();
  for (const request of [ { ...input(), body: 'private' }, { ...input(), kind: 'reply' },
    { ...input(), metadata: { ...input().metadata, enabled: true } },
    { ...input(), metadata: { ...input().metadata, allowlist: ['synthetic', 'synthetic'] } },
    { ...input(), metadata: { ...input().metadata, expiresAt: 1000 } },
    { ...input(), metadata: { ...input().metadata, expiresAt: 1000 + 31 * 86400000 } } ]) {
    await assert.rejects(f.commands.provision('opaque', request), /INVALID_PROVIDER_PROVISIONING/);
  }
  assert.equal(f.rows().provider_authority.length, 0);
});

test('unknown storage outcome rolls back; command collisions and existing authority cannot overwrite', async () => {
  const f = fixture();
  f.failOutbox = true;
  await assert.rejects(f.commands.provision('opaque', input()), /UNKNOWN_STORAGE/);
  assert.ok(Object.values(f.rows()).every(rows => rows.length === 0));
  assert.equal(f.calls, 1);
  f.failOutbox = false;
  await f.commands.provision('opaque', input());
  await assert.rejects(f.commands.provision('opaque', { ...input(), metadata: { ...input().metadata, prefix: 'OTHER ' } }), /PROVIDER_COMMAND_CONFLICT/);
  await assert.rejects(f.commands.provision('opaque', { ...input(), commandId: tenantId }), /PROVIDER_AUTHORITY_EXISTS/);
  assert.equal(f.rows().provider_authority.length, 1);
});

test('identity and binding remain inactive, have strict metadata and independent receipts', async () => {
  const f = fixture();
  await f.commands.provision('opaque', { commandId, kind: 'identity', resourceId: 'synthetic', metadata: { expiresAt: 2000 } });
  await f.commands.provision('opaque', { commandId: tenantId, kind: 'binding', resourceId: 'synthetic', metadata: { expiresAt: 2000, customerId: plantId } });
  assert.deepEqual(f.rows().provider_authority.map(row => [row.kind, row.active, row.version]),
    [['identity', false, 1], ['binding', false, 1]]);
  assert.equal(f.rows().provider_commands.length, 2);
});
