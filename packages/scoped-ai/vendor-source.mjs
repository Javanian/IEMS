import { readVendorPurchaseOrder } from '../../apps/portfolio-api/src/portals.mjs';
import { fail, uuid } from './indexing.mjs';

// Call only after transaction-scoped internal procurement authorization.
export function createVendorDraftAuthority({ db, clock = () => new Date() }) {
  return Object.freeze({
    async source({ grant, reference, session }) {
      if (!session?.inTransaction() || !uuid(grant?.legalEntityId)) fail('SCOPE_DENIED', 403);
      const source = await readVendorPurchaseOrder(db, { tenantId: grant.tenantId, plantId: grant.plantId, ...reference }, session);
      if (!source) fail('AI_VENDOR_SOURCE_NOT_FOUND', 404);
      const collection = reference.cohort === 'CATALOG' ? 'catalogPurchaseOrders' : 'purchaseOrders';
      const filter = { _id: reference.orderId, tenantId: grant.tenantId, plantId: grant.plantId,
        status: source.status, ...(reference.cohort === 'CATALOG' ? { 'content.vendorId': reference.vendorId } : { vendorId: reference.vendorId }) };
      const row = await db.collection(collection).findOne(filter, { session });
      if (!row || row.legalEntityId !== undefined && row.legalEntityId !== grant.legalEntityId) fail('SCOPE_DENIED', 403);
      // Foundation's transaction-scoped plant fence also conflicts with procurement guard writes.
      // The AI workflow must never write the PO or its financial authority records.
      return source;
    },
    async recipient({ grant, vendorId, grantId, session }) {
      if (!session?.inTransaction() || !uuid(grantId)) fail('AI_RECIPIENT_DENIED', 403);
      const filter = { _id: grantId, tenantId: grant.tenantId, plantId: grant.plantId, partyId: vendorId,
        kind: 'VENDOR', actions: 'portal.vendor.read', active: true, expiresAt: { $gt: clock() } };
      const party = await db.collection('portal_party_grants').findOne(filter, { session });
      if (!party || !uuid(party.userId) || !Number.isSafeInteger(party.revision) || party.revision < 1 ||
          !(party.expiresAt instanceof Date)) fail('AI_RECIPIENT_DENIED', 403);
      const user = await db.collection('users').findOne({ _id: party.userId, active: true }, { session });
      const membership = await db.collection('memberships').findOne({ tenantId: grant.tenantId, userId: party.userId, active: true }, { session });
      if (!user || !membership || (!membership.tenantWide && (!membership.plantIds?.includes(grant.plantId) ||
          !membership.legalEntityIds?.includes(grant.legalEntityId)))) fail('AI_RECIPIENT_DENIED', 403);
      for (const [name, predicate] of [['portal_party_grants', { ...filter, revision: party.revision }],
        ['users', { _id: user._id, active: true }], ['memberships', { _id: membership._id, version: membership.version, active: true }]]) {
        const write = await db.collection(name).updateOne(predicate, { $inc: { authorizationFence: 1 } }, { session });
        if (write.matchedCount !== 1) fail('AI_RECIPIENT_DENIED', 403);
      }
      return { grantId, userId: party.userId, vendorId, revision: party.revision,
        expiresAt: party.expiresAt.toISOString(), channel: 'VENDOR_PORTAL', displayLabel: `Portal user ${party.userId}` };
    },
  });
}
