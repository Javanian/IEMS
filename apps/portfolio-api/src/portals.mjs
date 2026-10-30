import { readApprovedOrderRevision } from '../../../packages/contracts/src/domains/commercial/purchase-orders.mjs';
import { readCatalogOrderRevision } from './catalog-procurement.mjs';
import { createCommandExecutor } from '../../../packages/tenant-foundation/index.mjs';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const select = (row, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(row, key)).map(key => [key, structuredClone(row[key])]));

export const portalRoles = {
  vendorPortalReader: ['portal.vendor.read'],
  vendorPortalResponder: ['portal.vendor.read', 'portal.vendor.respond'],
  customerPortalReader: ['portal.customer.read'],
  portalAccessAdmin: ['portal.access.manage'],
};

export function createVendorResponseService(runtime) {
  return Object.freeze({
    async initialize() { await createCommandExecutor(runtime).initialize(); },
    async respond(scope, input) {
      const keys = ['plantId', 'vendorId', 'orderId', 'responseId', 'cohort', 'documentRevision', 'sourceHash', 'decision', 'promises', 'commandKey'];
      if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some(key => !keys.includes(key))) fail(400, 'INVALID_VENDOR_RESPONSE');
      const { plantId, vendorId, orderId, responseId, cohort, documentRevision, sourceHash, decision, commandKey } = input;
      let { promises } = input;
      if (![plantId, vendorId, orderId, responseId].every(uuid) || !['LEGACY', 'CATALOG'].includes(cohort) ||
          !positive(documentRevision) || typeof sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(sourceHash) || !['ACCEPT', 'DECLINE'].includes(decision) ||
          !Array.isArray(promises) || promises.length > 500 || (decision === 'DECLINE' && promises.length) ||
          promises.some(line => !line || Object.getPrototypeOf(line) !== Object.prototype ||
            Object.keys(line).some(key => !['lineId', 'promisedAt'].includes(key)) || !uuid(line.lineId) ||
            typeof line.promisedAt !== 'string' || !Number.isFinite(Date.parse(line.promisedAt)) || new Date(line.promisedAt).toISOString() !== line.promisedAt) ||
          new Set(promises.map(line => line.lineId)).size !== promises.length) fail(400, 'INVALID_VENDOR_RESPONSE');
      promises = structuredClone(promises);
      let source;
      // This authorization hook runs before the executor's receipt lookup, including replay.
      const commands = createCommandExecutor({ ...runtime, foundation: {
        async authorizeInTransaction(receivedScope, target, { session }) {
          const actor = await authorizePortalParty(runtime, receivedScope, {
            plantId, partyId: vendorId, kind: 'VENDOR', action: 'portal.vendor.respond',
          }, session);
          source = await readVendorPurchaseOrder(runtime.db, { tenantId: actor.tenantId, plantId, vendorId, orderId, cohort, documentRevision }, session);
          if (!source) fail(404, 'PORTAL_ORDER_NOT_FOUND');
          if (source.sourceHash !== sourceHash || promises.some(line => !source.lines.some(item => item.lineId === line.lineId))) fail(409, 'PORTAL_SOURCE_MISMATCH');
          return runtime.foundation.authorizeInTransaction(receivedScope, target, { session });
        },
      } });
      return commands.execute(scope, {
        plantId, action: 'portal.vendor.respond', key: commandKey, aggregateId: responseId, expectedRevision: 0,
        input: { vendorId, orderId, cohort, documentRevision, sourceHash, decision, promises },
      }, async ({ session, grant }) => {
        if (source.currentDocumentRevision !== documentRevision) fail(409, 'PORTAL_DOCUMENT_SUPERSEDED');
        try {
          await runtime.db.collection('portal_vendor_responses').insertOne({
            _id: responseId, tenantId: grant.tenantId, plantId, vendorId, orderId, cohort,
            documentRevision, sourceHash, decision, promises: structuredClone(promises), revision: 1,
            createdAt: new Date(), createdBy: grant.userId,
          }, { session });
        } catch (error) {
          if (error.code === 11000) fail(409, 'PORTAL_RESPONSE_EXISTS');
          throw error;
        }
        return { revision: 1, data: { schema: 'PORTAL_VENDOR_RESPONSE_V1', responseId, orderId, documentRevision, revision: 1 },
          events: [{ type: 'portal.vendor.responded', version: 1, data: { responseId, orderId, documentRevision } }] };
      });
    },
  });
}

export function createPortalAccessService(runtime) {
  const commands = createCommandExecutor(runtime);
  return Object.freeze({
    async initialize() {
      await commands.initialize();
      await runtime.db.collection('portal_party_grants').createIndex(
        { tenantId: 1, plantId: 1, userId: 1, partyId: 1, kind: 1 },
        { unique: true, partialFilterExpression: { active: true } },
      );
    },
    async provision(scope, input) {
      if (!input || Object.getPrototypeOf(input) !== Object.prototype) fail(400, 'INVALID_PORTAL_GRANT');
      const { plantId, grantId, userId, partyId, kind, actions, expiresAt, commandKey } = input;
      const allowed = kind === 'VENDOR' ? ['portal.vendor.read', 'portal.vendor.respond'] : kind === 'CUSTOMER' ? ['portal.customer.read'] : [];
      const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : new Date(NaN);
      if (![plantId, grantId, userId, partyId].every(uuid) || !allowed.length ||
          !Array.isArray(actions) || !actions.length || actions.length > allowed.length ||
          new Set(actions).size !== actions.length || actions.some(action => !allowed.includes(action)) ||
          !actions.includes(allowed[0]) || !Number.isFinite(expiry.getTime()) || expiry.toISOString() !== expiresAt ||
          Object.keys(input).some(key => !['plantId', 'grantId', 'userId', 'partyId', 'kind', 'actions', 'expiresAt', 'commandKey'].includes(key))) fail(400, 'INVALID_PORTAL_GRANT');
      return commands.execute(scope, {
        plantId, action: 'portal.access.manage', key: commandKey, aggregateId: grantId, expectedRevision: 0,
        input: { operation: 'PROVISION', userId, partyId, kind, actions: [...actions].sort(), expiresAt },
      }, async ({ session, grant }) => {
        const now = new Date();
        if (expiry <= now || expiry.getTime() - now.getTime() > 30 * 86400000) fail(400, 'INVALID_PORTAL_EXPIRY');
        const member = await runtime.db.collection('memberships').findOne({ tenantId: grant.tenantId, userId, active: true }, { session });
        if (!member || !positive(member.version) || (member.tenantWide !== true &&
            (!member.plantIds?.includes(plantId) || !member.legalEntityIds?.includes(grant.legalEntityId)))) fail(403, 'PORTAL_TARGET_DENIED');
        // Fence the recipient as well as the administrator; a concurrent membership
        // invalidation or user disable must conflict with this grant creation.
        for (const [name, filter] of [
          ['memberships', { _id: member._id, tenantId: grant.tenantId, userId, active: true, version: member.version }],
          ['users', { _id: userId, active: true }],
        ]) {
          const result = await runtime.db.collection(name).updateOne(filter, { $inc: { authorizationFence: 1 } }, { session });
          if (result.matchedCount !== 1) fail(403, 'PORTAL_TARGET_DENIED');
        }
        if (!await runtime.db.collection(kind === 'VENDOR' ? 'vendors' : 'accounts').findOne({
          _id: partyId, tenantId: grant.tenantId, plantId,
        }, { session })) fail(403, 'PORTAL_TARGET_DENIED');
        try {
          await runtime.db.collection('portal_party_grants').insertOne({
            _id: grantId, tenantId: grant.tenantId, plantId, userId, partyId, kind,
            actions: [...actions].sort(), expiresAt: expiry, active: true, revision: 1,
            authorizationFence: 0, createdAt: now, createdBy: grant.userId,
          }, { session });
        } catch (error) {
          if (error.code === 11000) fail(409, 'PORTAL_GRANT_EXISTS');
          throw error;
        }
        return { revision: 1, data: { schema: 'PORTAL_GRANT_V1', grantId, active: true, revision: 1 },
          events: [{ type: 'portal.grant.provisioned', version: 1, data: { grantId, revision: 1 } }] };
      });
    },
    async revoke(scope, input) {
      if (!input || Object.getPrototypeOf(input) !== Object.prototype) fail(400, 'INVALID_PORTAL_REVOCATION');
      const { plantId, grantId, expectedRevision, commandKey } = input;
      if (![plantId, grantId].every(uuid) || !positive(expectedRevision) || expectedRevision >= Number.MAX_SAFE_INTEGER ||
          Object.keys(input).some(key => !['plantId', 'grantId', 'expectedRevision', 'commandKey'].includes(key))) fail(400, 'INVALID_PORTAL_REVOCATION');
      return commands.execute(scope, {
        plantId, action: 'portal.access.manage', key: commandKey,
        aggregateId: grantId, expectedRevision, input: { operation: 'REVOKE' },
      }, async ({ session, grant }) => {
        const revision = expectedRevision + 1;
        const row = await runtime.db.collection('portal_party_grants').findOneAndUpdate({
          _id: grantId, tenantId: grant.tenantId, plantId: grant.plantId,
          revision: expectedRevision, active: true,
        }, { $set: { active: false, revision, revokedAt: new Date(), revokedBy: grant.userId },
          $inc: { authorizationFence: 1 } }, { session, returnDocument: 'after' });
        if (!row) fail(409, 'PORTAL_GRANT_REVISION_CONFLICT');
        return { revision, data: { schema: 'PORTAL_GRANT_V1', grantId, active: false, revision },
          events: [{ type: 'portal.grant.revoked', version: 1, data: { grantId, revision } }] };
      });
    },
  });
}

// Foundation verifies the opaque authenticated scope; request user/party IDs never
// substitute for it. The write conflicts with concurrent grant revocation.
export async function authorizePortalParty(runtime, scope, { plantId, partyId, kind, action }, session) {
  if (!session?.inTransaction?.()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  const actions = kind === 'VENDOR' ? ['portal.vendor.read', 'portal.vendor.respond'] : kind === 'CUSTOMER' ? ['portal.customer.read'] : [];
  if (![plantId, partyId].every(uuid) || !actions.includes(action)) fail(400, 'INVALID_PORTAL_ACCESS');
  const actor = await runtime.foundation.authorizeInTransaction(scope, { plantId, action }, { session });
  if (![actor?.tenantId, actor?.userId].every(uuid) || actor.plantId !== plantId) fail(403, 'PORTAL_ACCESS_DENIED');
  const grant = await runtime.db.collection('portal_party_grants').findOneAndUpdate({
    tenantId: actor.tenantId, plantId, userId: actor.userId, partyId, kind,
    active: true, expiresAt: { $gt: new Date() }, actions: action,
  }, { $inc: { authorizationFence: 1 } }, { session, returnDocument: 'after' });
  if (!grant) fail(403, 'PORTAL_ACCESS_DENIED');
  const party = await runtime.db.collection(kind === 'VENDOR' ? 'vendors' : 'accounts').findOne({
    tenantId: actor.tenantId, plantId, _id: partyId,
  }, { session });
  if (!party) fail(403, 'PORTAL_ACCESS_DENIED');
  return Object.freeze({ tenantId: actor.tenantId, plantId, userId: actor.userId, partyId, kind, grantId: grant._id });
}

export async function readVendorPurchaseOrderForPrincipal(runtime, scope, input, session) {
  const actor = await authorizePortalParty(runtime, scope, {
    plantId: input.plantId, partyId: input.vendorId, kind: 'VENDOR', action: 'portal.vendor.read',
  }, session);
  return readVendorPurchaseOrder(runtime.db, { ...input, tenantId: actor.tenantId }, session);
}

// This source adapter is not an authorization entry point. Its caller must resolve
// the authenticated principal's vendor grant in the same snapshot transaction.
export async function readVendorPurchaseOrder(db, { tenantId, plantId, vendorId, cohort, orderId, documentRevision }, session) {
  if (!session?.inTransaction?.()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  if (![tenantId, plantId, vendorId, orderId].every(uuid) || !['LEGACY', 'CATALOG'].includes(cohort) || (documentRevision !== undefined && !positive(documentRevision))) fail(400, 'INVALID_PORTAL_SOURCE');
  const filter = { tenantId, plantId };
  const vendorField = cohort === 'CATALOG' ? 'content.vendorId' : 'vendorId';
  const collection = cohort === 'CATALOG' ? 'catalogPurchaseOrders' : 'purchaseOrders';
  const row = await db.collection(collection).findOne({ ...filter, _id: orderId, [vendorField]: vendorId }, { session });
  if (!row || !['ISSUED', 'CONFIRMED'].includes(row.status)) return null;
  if (!await db.collection('vendors').findOne({ ...filter, _id: vendorId }, { session })) return null;
  const currentRevision = row.documentRevision ?? 1;
  if (!positive(currentRevision)) fail(409, 'PORTAL_SOURCE_INVALID');
  const revision = documentRevision ?? currentRevision;
  const approved = cohort === 'CATALOG'
    ? await readCatalogOrderRevision(db, filter, orderId, revision, session)
    : await readApprovedOrderRevision(db, filter, cohort, row, revision, session);
  if (approved.orderId !== orderId || approved.cohort !== cohort || approved.tenantId !== tenantId || approved.plantId !== plantId || approved.revision !== revision || (cohort === 'CATALOG' && approved.snapshot.vendorId !== vendorId)) fail(409, 'PORTAL_SOURCE_INVALID');
  const snapshot = approved.snapshot;
  if (!Array.isArray(snapshot.lines) || !snapshot.lines.length || !Array.isArray(approved.lineIds) || approved.lineIds.length !== snapshot.lines.length || !approved.lineIds.every(uuid) || new Set(approved.lineIds).size !== approved.lineIds.length || typeof approved.contentHash !== 'string') fail(409, 'PORTAL_SOURCE_INVALID');
  return {
    schema: 'PORTAL_PURCHASE_ORDER_V1', cohort, orderId, vendorId,
    documentRevision: approved.revision, currentDocumentRevision: currentRevision,
    sourceHash: approved.contentHash, source: 'COMMERCIAL_APPROVED_REVISION',
    status: row.status,
    ...select(snapshot, ['currency', 'taxPolicy', 'roundingPolicy', 'subtotal', 'tax', 'total']),
    lines: snapshot.lines.map((line, index) => ({
      ...select(line, ['description', 'itemCode', 'quantity', 'uom', 'unitPrice', 'lineTotal', 'amount']),
      lineId: approved.lineIds[index],
    })),
  };
}
