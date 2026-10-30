import { boundedTransaction, createCommandExecutor, contentHash } from '../tenant-foundation/commands.mjs';
import { fail, uuid, scopeTarget } from './indexing.mjs';

export const documentRoles = { aiDocumentAdmin: ['ai.document.manage', 'ai.document.read', 'ai.index', 'ai.retrieve'],
  aiDocumentReader: ['ai.document.read', 'ai.retrieve'] };

export function textChunks(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 100000 || text.includes('\0')) fail('AI_INVALID_TEXT');
  const normalized = text.replaceAll('\r\n', '\n');
  return Array.from({ length: Math.ceil(normalized.length / 2000) }, (_, i) => normalized.slice(i * 2000, (i + 1) * 2000));
}

export function createAiDocuments({ client, db, foundation }) {
  const documents = db.collection('aiDocuments');
  const commands = createCommandExecutor({ client, db, foundation });
  const target = (scope, plantId, action, session) => foundation.authorizeInTransaction(scope, scopeTarget(scope, plantId, action), { session });
  const filterFor = grant => ({ tenantId: grant.tenantId, plantId: grant.plantId, legalEntityId: grant.legalEntityId });
  const source = Object.freeze({ async readAuthorized({ grant, resourceId, session }) {
    if (!session?.inTransaction() || !uuid(resourceId) || !uuid(grant?.userId)) fail('SCOPE_DENIED', 403);
    const filter = { ...filterFor(grant), _id: resourceId, active: true, allowedUserIds: grant.userId };
    const row = await documents.findOne(filter, { session });
    if (!row) fail('AI_DOCUMENT_NOT_FOUND', 404);
    if (row.contentHash !== contentHash({ title: row.title, chunks: row.chunks })) fail('AI_DOCUMENT_CORRUPT', 409);
    const write = await documents.updateOne({ ...filter, revision: row.revision, aclRevision: row.aclRevision },
      { $inc: { readFence: 1 } }, { session });
    if (write.matchedCount !== 1) fail('AI_DOCUMENT_CHANGED', 409);
    return { resourceId: row._id, revision: row.revision, aclRevision: row.aclRevision, title: row.title, chunks: row.chunks };
  } });
  return Object.freeze({ source,
    async initialize() {
      await commands.initialize();
      await documents.createIndex({ tenantId: 1, plantId: 1, active: 1, allowedUserIds: 1, _id: 1 });
    },
    async publish(scope, input) {
      if (!input || !uuid(input.plantId) || !uuid(input.resourceId) || typeof input.title !== 'string' ||
          !input.title.trim() || input.title.length > 240 || !Array.isArray(input.allowedUserIds) ||
          !input.allowedUserIds.length || input.allowedUserIds.length > 100 || !input.allowedUserIds.every(uuid) ||
          new Set(input.allowedUserIds).size !== input.allowedUserIds.length) fail('AI_INVALID_DOCUMENT');
      const chunks = textChunks(input.text), title = input.title.trim(), allowedUserIds = [...input.allowedUserIds].sort();
      return commands.execute(scope, { ...scopeTarget(scope, input.plantId, 'ai.document.manage'), key: input.key,
        aggregateId: input.resourceId, expectedRevision: input.expectedRevision,
        input: { title, chunks, allowedUserIds } }, async ({ session, grant, expectedRevision }) => {
        for (const userId of allowedUserIds) {
          const user = await db.collection('users').findOne({ _id: userId, active: true }, { session });
          const membership = await db.collection('memberships').findOne({ tenantId: grant.tenantId, userId, active: true }, { session });
          if (!user || !membership || (!membership.tenantWide && (!membership.plantIds?.includes(grant.plantId) ||
              !membership.legalEntityIds?.includes(grant.legalEntityId)))) fail('AI_DOCUMENT_READER_DENIED', 403);
          for (const [name, filter] of [['users', { _id: userId, active: true }],
            ['memberships', { _id: membership._id, tenantId: grant.tenantId, userId, version: membership.version, active: true }]]) {
            const write = await db.collection(name).updateOne(filter, { $inc: { authorizationFence: 1 } }, { session });
            if (write.matchedCount !== 1) fail('AI_DOCUMENT_READER_DENIED', 403);
          }
        }
        const filter = { ...filterFor(grant), _id: input.resourceId };
        const previous = await documents.findOne(filter, { session });
        if ((previous?.revision ?? 0) !== expectedRevision) fail('REVISION_CONFLICT', 409);
        const revision = expectedRevision + 1, aclRevision = (previous?.aclRevision ?? 0) + 1;
        const row = { ...filter, revision, aclRevision, title, chunks, allowedUserIds, active: true,
          provenance: 'MANUAL_TEXT', contentHash: contentHash({ title, chunks }), updatedAt: new Date(), updatedBy: grant.userId };
        if (previous) {
          const write = await documents.replaceOne({ ...filter, revision: expectedRevision }, row, { session });
          if (write.matchedCount !== 1) fail('REVISION_CONFLICT', 409);
        } else await documents.insertOne(row, { session });
        return { revision, data: { resourceId: input.resourceId, revision, aclRevision, state: 'PUBLISHED_REINDEX_REQUIRED' },
          events: [{ type: 'ai.document.published', version: 1, data: { resourceId: input.resourceId, revision } }] };
      });
    },
    async revoke(scope, input) {
      if (!input || !uuid(input.plantId) || !uuid(input.resourceId)) fail('AI_INVALID_DOCUMENT');
      return commands.execute(scope, { ...scopeTarget(scope, input.plantId, 'ai.document.manage'), key: input.key,
        aggregateId: input.resourceId, expectedRevision: input.expectedRevision, input: { operation: 'REVOKE' } },
      async ({ session, grant, expectedRevision }) => {
        const write = await documents.updateOne({ ...filterFor(grant), _id: input.resourceId, revision: expectedRevision },
          { $set: { active: false, updatedAt: new Date() }, $inc: { revision: 1, aclRevision: 1 } }, { session });
        if (write.matchedCount !== 1) fail('REVISION_CONFLICT', 409);
        return { revision: expectedRevision + 1, data: { resourceId: input.resourceId, state: 'REVOKED' },
          events: [{ type: 'ai.document.revoked', version: 1, data: { resourceId: input.resourceId } }] };
      });
    },
    async list(scope, plantId) {
      if (!uuid(plantId)) fail('AI_INVALID_RESOURCE');
      return boundedTransaction(client, async session => {
        const grant = await target(scope, plantId, 'ai.document.read', session);
        const rows = await documents.find({ ...filterFor(grant), active: true, allowedUserIds: grant.userId }, { session,
          projection: { _id: 1, title: 1, revision: 1, aclRevision: 1, updatedAt: 1, provenance: 1 } }).sort({ _id: 1 }).limit(51).toArray();
        for (const row of rows.slice(0, 50)) {
          const write = await documents.updateOne({ ...filterFor(grant), _id: row._id, active: true, allowedUserIds: grant.userId,
            revision: row.revision, aclRevision: row.aclRevision }, { $inc: { readFence: 1 } }, { session });
          if (write.matchedCount !== 1) fail('AI_DOCUMENT_CHANGED', 409);
        }
        return { resources: rows.slice(0, 50).map(row => ({ resourceId: row._id, title: row.title, revision: row.revision,
          aclRevision: row.aclRevision, updatedAt: row.updatedAt, provenance: row.provenance })), coverage: rows.length > 50 ? 'INCOMPLETE' : 'COMPLETE' };
      });
    },
  });
}
