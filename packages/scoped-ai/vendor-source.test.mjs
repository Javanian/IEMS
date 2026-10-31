import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createVendorDraftAuthority } from './vendor-source.mjs';

test('recipient resolver uses scoped active grant, membership and expiry fences without invented contact', async () => {
  const ids = Object.fromEntries(['tenantId', 'plantId', 'legalEntityId', 'userId', 'vendorId', 'grantId', 'membershipId'].map(k => [k, randomUUID()]));
  const session = { inTransaction: () => true }, writes = [];
  const grantRow = { _id: ids.grantId, userId: ids.userId, revision: 3, expiresAt: new Date('2027-01-01T00:00:00Z') };
  let member = { _id: ids.membershipId, version: 2, plantIds: [ids.plantId], legalEntityIds: [ids.legalEntityId] };
  const db = { collection(name) { return {
    async findOne(f, opts) {
      assert.equal(opts.session, session);
      if (name === 'portal_party_grants') {
        assert.deepEqual(f, { _id: ids.grantId, tenantId: ids.tenantId, plantId: ids.plantId, partyId: ids.vendorId,
          kind: 'VENDOR', actions: 'portal.vendor.read', active: true, expiresAt: { $gt: new Date('2026-10-31T00:00:00Z') } });
        return grantRow;
      }
      return name === 'users' ? { _id: ids.userId } : member;
    },
    async updateOne(f, update, opts) { assert.equal(opts.session, session); assert.deepEqual(update, { $inc: { authorizationFence: 1 } }); writes.push({ name, f }); return { matchedCount: 1 }; },
  }; } };
  const api = createVendorDraftAuthority({ db, clock: () => new Date('2026-10-31T00:00:00Z') });
  const input = { grant: ids, vendorId: ids.vendorId, grantId: ids.grantId, session };
  const recipient = await api.recipient(input);
  assert.equal(recipient.channel, 'VENDOR_PORTAL'); assert.equal(recipient.revision, 3);
  assert.equal(recipient.userId, ids.userId); assert.equal(Object.hasOwn(recipient, 'email'), false);
  assert.deepEqual(writes.map(w => w.name), ['portal_party_grants', 'users', 'memberships']);
  member = { ...member, legalEntityIds: [] };
  await assert.rejects(api.recipient(input), { code: 'AI_RECIPIENT_DENIED' });
  await assert.rejects(api.recipient({ ...input, session: null }), { code: 'AI_RECIPIENT_DENIED' });
});
