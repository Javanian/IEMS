import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRevocationCommands } from '../src/provider-commands.mjs';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const commandId = '33333333-3333-4333-8333-333333333333';
const scope = { tenantId, accountId: 'synthetic' };
const input = { commandId, kind: 'policy', resourceId: 'account', expectedRevision: 1 };
function fixture() {
  let rows = { revision: 1, commands: [], audit: [], outbox: [] };
  const f = { denied: false, failOutbox: false, transactions: 0, authorizations: 0, writes: 0 };
  let active;
  const db = { collection(name) { return {
    async findOne(key, { session }) {
      assert.equal(session, active);
      assert.equal(key.tenantId, tenantId);
      assert.equal(key.accountId, scope.accountId);
      return rows.commands.find(row => row.commandId === key.commandId);
    },
    async updateOne(key, update, { session }) {
      assert.equal(session, active);
      assert.deepEqual(key, { ...scope, kind: 'policy', resourceId: 'account', authorityRevision: 1 });
      f.writes++;
      if (key.authorityRevision !== rows.revision) return { matchedCount: 0 };
      rows.revision++;
      return { matchedCount: 1 };
    },
    async insertOne(row, { session }) {
      assert.equal(session, active);
      if (name === 'provider_outbox' && f.failOutbox) throw new Error('UNKNOWN_STORAGE');
      rows[{ provider_commands: 'commands', provider_audit: 'audit', provider_outbox: 'outbox' }[name]].push(structuredClone(row));
    },
  }; } };
  f.command = createProviderRevocationCommands({ db, ...scope,
    async transaction(fn) {
      f.transactions++;
      const before = structuredClone(rows);
      active = {};
      try { return await fn(active); } catch (error) { rows = before; throw error; }
    },
    async authorize(actor, request, session) {
      f.authorizations++;
      assert.equal(session, active);
      assert.equal(actor, 'opaque-actor');
      assert.deepEqual(request, { ...scope, action: 'provider.authority.revoke' });
      return f.denied ? null : { ...scope, userId };
    },
  });
  f.rows = () => structuredClone(rows);
  return f;
}

test('revocation, result, metadata audit and outbox commit together; replay reauthorizes without mutation', async () => {
  const f = fixture();
  const result = await f.command.revoke('opaque-actor', input);
  assert.deepEqual(result, { kind: 'policy', resourceId: 'account', authorityRevision: 2 });
  assert.deepEqual(await f.command.revoke('opaque-actor', input), result);
  assert.equal(f.authorizations, 2);
  assert.equal(f.writes, 1);
  assert.equal(f.rows().audit.length, 1);
  assert.equal(f.rows().outbox.length, 1);
  assert.equal(f.rows().commands.length, 1);
  assert.equal(JSON.stringify(f.rows()).includes('opaque-actor'), false);
  f.denied = true;
  await assert.rejects(f.command.revoke('opaque-actor', input), /PROVIDER_COMMAND_DENIED/);
});

test('malformed inputs never enter transaction; denied actors cannot change authority', async () => {
  const f = fixture();
  for (const delta of [{ commandId: 'bad' }, { kind: '__proto__' }, { expectedRevision: 0 }, { resourceId: 'other' }, { body: 'private' }]) {
    await assert.rejects(f.command.revoke('opaque-actor', { ...input, ...delta }), /INVALID_PROVIDER_COMMAND/);
  }
  assert.equal(f.transactions, 0);
  f.denied = true;
  await assert.rejects(f.command.revoke('opaque-actor', input), /PROVIDER_COMMAND_DENIED/);
  assert.equal(f.writes, 0);
});

test('command key conflicts and stale revisions reject; partial failure rolls back with no automatic retry', async () => {
  const f = fixture();
  f.failOutbox = true;
  await assert.rejects(f.command.revoke('opaque-actor', input), /UNKNOWN_STORAGE/);
  assert.equal(f.transactions, 1);
  assert.deepEqual(f.rows(), { revision: 1, commands: [], audit: [], outbox: [] });
  f.failOutbox = false;
  await f.command.revoke('opaque-actor', input);
  await assert.rejects(f.command.revoke('opaque-actor', { ...input, expectedRevision: 2 }), /PROVIDER_COMMAND_CONFLICT/);
  await assert.rejects(f.command.revoke('opaque-actor', { ...input, commandId: tenantId }), /PROVIDER_AUTHORITY_FENCED/);
  assert.equal(f.rows().commands.length, 1);
});
