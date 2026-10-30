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

const repairStages = {
  INTAKE: 'RECEIVED', DIAGNOSIS_AUTHORIZED: 'DIAGNOSIS', TEARDOWN: 'DIAGNOSIS',
  SCOPE_QUOTED: 'AWAITING_APPROVAL', AUTHORIZED: 'REPAIR', IN_PROGRESS: 'REPAIR',
  TESTING: 'TESTING', REWORK: 'TESTING', TEST_PASSED: 'TESTING',
  READY_FOR_RETURN: 'READY_TO_RETURN', REJECTED: 'READY_TO_RETURN', RETURNED: 'RETURNED',
};

export function createCustomerPortalReader(runtime) {
  return Object.freeze({ async order(scope, input) {
    if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
        Object.keys(input).some(key => !['plantId', 'customerId', 'orderNumber'].includes(key)) ||
        ![input.plantId, input.customerId].every(uuid) || typeof input.orderNumber !== 'string' ||
        !/^(SO|RP)-[A-Z0-9][A-Z0-9-]{0,36}$/.test(input.orderNumber)) fail(400, 'INVALID_PORTAL_READ');
    const { plantId, customerId, orderNumber } = input;
    const session = runtime.client.startSession();
    try {
      return await session.withTransaction(async () => {
        const actor = await authorizePortalParty(runtime, scope, {
          plantId, partyId: customerId, kind: 'CUSTOMER', action: 'portal.customer.read',
        }, session);
        const filter = { tenantId: actor.tenantId, plantId }, opts = { session };
        const repair = orderNumber.startsWith('RP-');
        const row = await runtime.db.collection(repair ? 'repairCases' : 'salesOrders').findOne({
          ...filter, [repair ? 'ownerAccountId' : 'accountId']: customerId,
          [repair ? 'caseNumber' : 'orderNumber']: orderNumber,
        }, opts);
        if (!row) fail(404, 'PORTAL_ORDER_NOT_FOUND');
        if (!uuid(row._id) || !positive(row.version)) fail(409, 'PORTAL_SOURCE_INVALID');
        let publicStage, shipments = [], coverage = 'COMPLETE';
        if (repair) {
          publicStage = repairStages[row.status];
          if (!publicStage) fail(409, 'PORTAL_SOURCE_INVALID');
        } else {
          const related = { ...filter, accountId: customerId, salesOrderId: row._id };
          const work = await runtime.db.collection('manufacturingWorkOrders').find(related, opts).sort({ _id: 1 }).limit(501).toArray();
          const shipped = await runtime.db.collection('fulfillmentShipments').find(related, opts).sort({ _id: 1 }).limit(501).toArray();
          if (work.some(w => !['PLANNED', 'RELEASED', 'IN_PROGRESS', 'QUARANTINED', 'QC_COMPLETED'].includes(w.status))) fail(409, 'PORTAL_SOURCE_INVALID');
          coverage = work.length > 500 || shipped.length > 500 ? 'INCOMPLETE' : 'COMPLETE';
          publicStage = coverage === 'INCOMPLETE' ? null : work.some(w => w.status === 'QUARANTINED') ? 'QUALITY_INSPECTION'
            : work.some(w => w.status === 'IN_PROGRESS') ? 'PRODUCTION'
              : work.length && work.every(w => w.status === 'QC_COMPLETED') ? 'READY_TO_SHIP' : work.length ? 'PLANNING' : 'ACCEPTED';
          const lines = row.snapshot?.lines;
          if (!Array.isArray(lines) || !lines.length) fail(409, 'PORTAL_SOURCE_INVALID');
          const quantity = value => typeof value === 'string' && /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value);
          const units = value => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0')); };
          if (lines.some(line => !quantity(line.quantity) || units(line.quantity) <= 0n || typeof line.uom !== 'string' || !line.uom)) fail(409, 'PORTAL_SOURCE_INVALID');
          for (const shipment of shipped.slice(0, 500)) {
            const line = lines[shipment.lineIndex];
            if (!Number.isSafeInteger(shipment.lineIndex) || shipment.lineIndex < 0 || !line ||
                shipment.uom !== line.uom || !quantity(shipment.quantity) || units(shipment.quantity) <= 0n ||
                !uuid(shipment._id) || shipment.status !== 'SHIPPED' ||
                !(shipment.shippedAt instanceof Date) || !Number.isFinite(shipment.shippedAt.getTime())) fail(409, 'PORTAL_SOURCE_INVALID');
          }
          if (coverage === 'COMPLETE' && shipped.length) {
            publicStage = lines.every((line, index) => shipped.filter(s => s.lineIndex === index)
              .reduce((sum, s) => sum + units(s.quantity), 0n) >= units(line.quantity)) ? 'SHIPPED' : 'PARTIALLY_SHIPPED';
          }
          shipments = shipped.slice(0, 500).map(s => ({ shipmentId: s._id, ...select(s, ['lineIndex', 'quantity', 'uom', 'shippedAt']) }));
        }
        return { schema: 'PORTAL_CUSTOMER_ORDER_V1', kind: repair ? 'REPAIR' : 'MANUFACTURE',
          orderId: row._id, orderNumber, sourceRevision: row.version, publicStage, coverage,
          source: 'PORTFOLIO_API_OWNED', asOf: new Date(), confirmedDates: {}, shipments };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
  } });
}

export function createVendorPortalReader(runtime) {
  const read = async (scope, input, history) => {
    const allowed = ['plantId', 'vendorId', 'orderId', 'cohort', 'documentRevision', ...(history ? ['limit', 'after'] : [])];
    if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some(key => !allowed.includes(key)) ||
        ![input.plantId, input.vendorId, input.orderId].every(uuid) || !['LEGACY', 'CATALOG'].includes(input.cohort) ||
        (input.documentRevision !== undefined && !positive(input.documentRevision)) ||
        (history && ((input.limit !== undefined && (!positive(input.limit) || input.limit > 100)) ||
          (input.after !== undefined && !uuid(input.after))))) fail(400, 'INVALID_PORTAL_READ');
    input = { ...input };
    const session = runtime.client.startSession();
    try {
      return await session.withTransaction(async () => {
        const actor = await authorizePortalParty(runtime, scope, {
          plantId: input.plantId, partyId: input.vendorId, kind: 'VENDOR', action: 'portal.vendor.read',
        }, session);
        const source = await readVendorPurchaseOrder(runtime.db, { ...input, tenantId: actor.tenantId }, session);
        if (!source) fail(404, 'PORTAL_ORDER_NOT_FOUND');
        if (!history) return source;
        const limit = input.limit ?? 25;
        const filter = { tenantId: actor.tenantId, plantId: input.plantId, vendorId: input.vendorId,
        orderId: input.orderId, cohort: input.cohort,
        ...(input.documentRevision === undefined ? {} : { documentRevision: input.documentRevision }),
        ...(input.after === undefined ? {} : { _id: { $gt: input.after } }) };
        const rows = await runtime.db.collection('portal_vendor_responses').find(filter, { session })
          .sort({ _id: 1 }).limit(limit + 1).toArray();
        return { schema: 'PORTAL_VENDOR_RESPONSE_PAGE_V1', items: rows.slice(0, limit).map(row => ({
          responseId: row._id, ...select(row, ['orderId', 'cohort', 'documentRevision', 'sourceHash', 'decision', 'promises', 'revision', 'createdAt']),
        })), nextCursor: rows.length > limit ? rows[limit - 1]._id : null };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
  };
  return Object.freeze({ order: (scope, input) => read(scope, input, false), history: (scope, input) => read(scope, input, true) });
}

// Mount after the application's authenticated scope middleware. No public or
// dispatcher routes are installed here; the integration owner owns app.mjs.
export function installPortals(app, runtime) {
  const customers = createCustomerPortalReader(runtime);
  const reader = createVendorPortalReader(runtime);
  const responses = createVendorResponseService(runtime);
  const access = createPortalAccessService(runtime);
  app.get('/api/portals/customers/:customerId/orders/:orderNumber', async (req, res) => {
    if (!req.scope || !uuid(req.scope.selectedPlantId)) fail(403, 'SCOPE_DENIED');
    if (Object.keys(req.query).length) fail(400, 'UNKNOWN_FIELD');
    res.json({ data: await customers.order(req.scope, { plantId: req.scope.selectedPlantId,
      customerId: req.params.customerId, orderNumber: req.params.orderNumber }) });
  });
  const input = (req, history = false) => {
    if (!req.scope || !uuid(req.scope.selectedPlantId)) fail(403, 'SCOPE_DENIED');
    const allowed = ['cohort', 'documentRevision', ...(history ? ['limit', 'after'] : [])];
    if (Object.keys(req.query).some(key => !allowed.includes(key))) fail(400, 'UNKNOWN_FIELD');
    const integer = value => {
      if (typeof value !== 'string' || !/^[1-9][0-9]{0,14}$/.test(value) || !positive(Number(value))) fail(400, 'INVALID_PORTAL_READ');
      return Number(value);
    };
    return { plantId: req.scope.selectedPlantId, vendorId: req.params.vendorId, orderId: req.params.orderId,
      cohort: req.query.cohort,
      ...(req.query.documentRevision === undefined ? {} : { documentRevision: integer(req.query.documentRevision) }),
      ...(req.query.limit === undefined ? {} : { limit: integer(req.query.limit) }),
      ...(req.query.after === undefined ? {} : { after: req.query.after }) };
  };
  const body = (req, allowed) => {
    if (!req.scope || !uuid(req.scope.selectedPlantId)) fail(403, 'SCOPE_DENIED');
    if (Object.keys(req.query).length || !req.body || Object.getPrototypeOf(req.body) !== Object.prototype ||
        Object.keys(req.body).some(key => !allowed.includes(key))) fail(400, 'UNKNOWN_FIELD');
    return { ...req.body, plantId: req.scope.selectedPlantId };
  };
  app.get('/api/portals/vendors/:vendorId/orders/:orderId', async (req, res) => res.json({ data: await reader.order(req.scope, input(req)) }));
  app.get('/api/portals/vendors/:vendorId/orders/:orderId/responses', async (req, res) => res.json({ data: await reader.history(req.scope, input(req, true)) }));
  app.post('/api/portals/vendors/:vendorId/orders/:orderId/responses', async (req, res) => {
    const payload = body(req, ['responseId', 'cohort', 'documentRevision', 'sourceHash', 'decision', 'promises', 'commandKey']);
    res.json({ data: await responses.respond(req.scope, { ...payload, vendorId: req.params.vendorId, orderId: req.params.orderId }) });
  });
  app.post('/api/portals/grants', async (req, res) => res.json({ data: await access.provision(req.scope,
    body(req, ['grantId', 'userId', 'partyId', 'kind', 'actions', 'expiresAt', 'commandKey'])) }));
  app.post('/api/portals/grants/:grantId/revoke', async (req, res) => res.json({ data: await access.revoke(req.scope, {
    ...body(req, ['expectedRevision', 'commandKey']), grantId: req.params.grantId,
  }) }));
}

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
