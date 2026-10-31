import {createManagedIndexBoundary} from '../tenant-lifecycle/indexing-effects.mjs';
import {controlledIndexProvider} from '../tenant-lifecycle/local-ai-provider.mjs';
import { randomUUID } from 'node:crypto';
import { boundedTransaction, createCommandExecutor, contentHash, CommandError } from '../tenant-foundation/commands.mjs';

export const fail = (code, status = 400) => { throw new CommandError(code, status); };
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const positive = value => Number.isSafeInteger(value) && value > 0;
export const modelId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value);
export const scopeTarget = (scope, plantId, action) => ({ tenantId: scope?.tenantId, plantId, action });
export const aiRoles = { aiReader: ['ai.retrieve'], aiIndexer: ['ai.index', 'ai.retrieve'] };

export async function boundedCall(effect, milliseconds = 10000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(() => effect(controller.signal)), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new CommandError('AI_PROVIDER_TIMEOUT', 503)); }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function sourceShape(source) {
  if (!source || !uuid(source.resourceId) || !positive(source.revision) || !positive(source.aclRevision) ||
      typeof source.title !== 'string' || !source.title.trim() || source.title.length > 240 ||
      !Array.isArray(source.chunks) || !source.chunks.length || source.chunks.length > 100 ||
      source.chunks.some(c => typeof c !== 'string' || !c.trim() || c.length > 4000) ||
      source.chunks.reduce((n, c) => n + c.length, 0) > 100000) fail('AI_SOURCE_INVALID', 409);
  return { resourceId: source.resourceId, revision: source.revision, aclRevision: source.aclRevision,
    title: source.title, chunks: source.chunks };
}

export function validateVector(value, dimensions) {
  if (!Array.isArray(value) || value.length !== dimensions || value.some(n => typeof n !== 'number' || !Number.isFinite(n)) ||
      !value.some(n => n !== 0)) fail('AI_VECTOR_INVALID', 502);
  return value;
}

// The host adapter must fence source ACL and revision in this same session, including deletion.
export async function readSource(source, grant, resourceId, session, scope) {
  const value = sourceShape(await source.readAuthorized({ scope, grant, resourceId, session }));
  if (value.resourceId !== resourceId) fail('AI_SOURCE_MISMATCH', 409);
  return { ...value, hash: contentHash(value) };
}

export function createScopedIndex({ client, db, foundation, saasAdmission, source, vectors, embeddings, separateEffects, clock = () => new Date() }) {
  if (!source?.readAuthorized || !vectors?.upsert || !vectors?.search || !embeddings?.embed ||
      !modelId(embeddings.model) || !positive(embeddings.dimensions) || embeddings.dimensions > 4096) fail('AI_ADAPTER_CONFIGURATION', 500);
  const commands = createCommandExecutor({ client, db, admission: saasAdmission?.effect, foundation });
  const indexes = db.collection('aiIndexes');
  const authorize = (scope, plantId, action, session) => foundation.authorizeInTransaction(scope, scopeTarget(scope, plantId, action), { session });
  const validateRequest = input => {
    if (!input || !uuid(input.plantId) || !uuid(input.resourceId)) fail('AI_INVALID_RESOURCE');
  };
  const legacyReplay=async(scope,input,grant,session,payload)=>{
    const previous=await db.collection('foundationCommandResults').findOne({tenantId:grant.tenantId,plantId:grant.plantId,userId:grant.userId,action:'ai.index',key:input.key},{session});
    if(!saasAdmission&&await db.collection('saasSubscriptions').findOne({tenantId:grant.tenantId},{session}))fail('SAAS_ADMISSION_PORT_REQUIRED',503);
    if(!previous)return null;
    const payloadHash=contentHash({action:'ai.index',aggregateId:input.resourceId,expectedRevision:input.expectedRevision,input:payload});
    if(previous.inputHash!==payloadHash)fail('IDEMPOTENCY_CONFLICT',409);
    if(previous.response?.revision!==input.expectedRevision+1||previous.response.data?.resourceId!==input.resourceId)fail('AI_HISTORICAL_RESULT_INVALID',409);
    await saasAdmission?.effect({scope,grant,session,namespace:'foundationCommandResults',key:input.key,action:'ai.index',aggregateId:input.resourceId,payloadHash,replayed:true});
    return {...previous.response,replayed:true};
  };
  const publishRebuild = async ({session,grant,expectedRevision,scope,input,snapshot,generation,points}) => {
        const currentSource = await readSource(source, grant, input.resourceId, session, scope);
        if (currentSource.hash !== snapshot.source.hash) fail('AI_SOURCE_CHANGED', 409);
        const filter = { tenantId: grant.tenantId, plantId: grant.plantId, resourceId: input.resourceId };
        const previous = await indexes.findOne(filter, { session });
        if ((previous?.revision ?? 0) !== expectedRevision) fail('REVISION_CONFLICT', 409);
        const revision = expectedRevision + 1;
        const retiredPoints = [...new Set([...(previous?.retiredPoints ?? []), ...(previous?.points ?? [])])];
        if (retiredPoints.length > 1000) fail('AI_INDEX_CLEANUP_REQUIRED', 409);
        const row = { ...filter, revision, generation, model: embeddings.model, dimensions: embeddings.dimensions,
          sourceRevision: currentSource.revision, aclRevision: currentSource.aclRevision,
          sourceHash: currentSource.hash, active: true, indexedAt: clock(), points: points.map(p => p.id), retiredPoints };
        if (previous) {
          const write = await indexes.replaceOne({ ...filter, revision: expectedRevision }, { _id: previous._id, ...row }, { session });
          if (write.matchedCount !== 1) fail('REVISION_CONFLICT', 409);
        } else await indexes.insertOne({ _id: randomUUID(), ...row }, { session });
        return { revision, data: { resourceId: input.resourceId, revision, sourceRevision: currentSource.revision, model: embeddings.model },
          events: [{ type: 'ai.index.published', version: 1, data: { resourceId: input.resourceId, revision } }] };
  };
  const publishCleanup = async ({session,grant,expectedRevision,input,retired}) => {
        const filter = { tenantId: grant.tenantId, plantId: grant.plantId, resourceId: input.resourceId, revision: expectedRevision };
        const row = await indexes.findOne(filter, { session });
        if (!row || row.active && row.points.some(id => retired.includes(id))) fail('REVISION_CONFLICT', 409);
        const retiredPoints = (row.retiredPoints ?? []).filter(id => !retired.includes(id));
        const points = row.active ? row.points : row.points.filter(id => !retired.includes(id));
        const write = await indexes.updateOne(filter, { $set: { retiredPoints, points }, $inc: { revision: 1 } }, { session });
        if (write.matchedCount !== 1) fail('REVISION_CONFLICT', 409);
        return { revision: expectedRevision + 1, data: { resourceId: input.resourceId, removed: retired.length,
          remaining: retiredPoints.length + (!row.active ? points.length : 0) },
          events: [{ type: 'ai.index.cleaned', version: 1, data: { resourceId: input.resourceId, removed: retired.length } }] };
  };
  const managed = controlledIndexProvider(embeddings,vectors) ? createManagedIndexBoundary({client,db,foundation,saasAdmission,source,vectors,embeddings,separateEffects,clock,readSource,validateVector,readSnapshot:async(args)=>{if(typeof source.readSnapshot!=='function')fail('AI_SOURCE_OBSERVATION_UNAVAILABLE',503);const value=sourceShape(await source.readSnapshot(args));if(value.resourceId!==args.resourceId)fail('AI_SOURCE_MISMATCH',409);return {...value,hash:contentHash(value)};},publishRebuild,publishCleanup}) : null;
  return Object.freeze({
    async initialize() {
      await commands.initialize();
      await indexes.createIndex({ tenantId: 1, plantId: 1, resourceId: 1 }, { unique: true });
    },
    async status(scope, input) {
      validateRequest(input);
      if(managed)return managed.status(scope,input);
      return boundedTransaction(client, async session => {
        const grant = await authorize(scope, input.plantId, 'ai.index', session);
        const current = await readSource(source, grant, input.resourceId, session, scope);
        const row = await indexes.findOne({ tenantId: grant.tenantId, plantId: grant.plantId,
          resourceId: input.resourceId }, { session });
        const state = !row ? 'NOT_INDEXED' : !row.active ? 'REVOKED' :
          row.model !== embeddings.model || row.dimensions !== embeddings.dimensions ? 'MODEL_CHANGED' :
            row.sourceHash !== current.hash ? 'SOURCE_CHANGED' : 'CURRENT';
        return { schema: 'SCOPED_INDEX_STATUS_V1', resourceId: input.resourceId,
          revision: row?.revision ?? 0, sourceRevision: current.revision, aclRevision: current.aclRevision,
          indexedSourceRevision: row?.sourceRevision ?? null, model: embeddings.model,
          indexedModel: row?.model ?? null, state, nextAction: state === 'CURRENT' ? 'NONE' : 'REBUILD',
          retiredPointCount: (row?.retiredPoints?.length ?? 0) + (row && !row.active ? row.points.length : 0),
          asOf: clock().toISOString() };
      });
    },
    async rebuild(scope, input) {
      validateRequest(input);
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= Number.MAX_SAFE_INTEGER || typeof input.key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.key)) fail('AI_INVALID_COMMAND');
      if(managed)return managed.accept(scope,input,'rebuild');
      const snapshot = await boundedTransaction(client, async session => {
        const grant = await authorize(scope, input.plantId, 'ai.index', session);
        await saasAdmission?.unsupported(scope,{plantId:input.plantId,session});
        const current=await readSource(source, grant, input.resourceId, session, scope);
        return {grant,source:current,replay:await legacyReplay(scope,input,grant,session,{sourceHash:current.hash,model:embeddings.model})};
      });
      if(snapshot.replay)return snapshot.replay;
      const generation = randomUUID();
      const values = await boundedCall(signal => embeddings.embed(snapshot.source.chunks, { signal }));
      if (!Array.isArray(values) || values.length !== snapshot.source.chunks.length) fail('AI_EMBEDDING_UNAVAILABLE', 503);
      const points = values.map((v, index) => ({ id: randomUUID(), vector: validateVector(v, embeddings.dimensions),
        payload: { tenantId: snapshot.grant.tenantId, plantId: snapshot.grant.plantId, resourceId: input.resourceId,
          sourceRevision: snapshot.source.revision, aclRevision: snapshot.source.aclRevision, sourceHash: snapshot.source.hash,
          model: embeddings.model, generation, chunkIndex: index } }));
      // Orphan points after an uncertain upsert/publication are inert: only the committed generation is readable.
      await boundedCall(signal => vectors.upsert(points, { signal }));
      return commands.execute(scope, { ...scopeTarget(scope, input.plantId, 'ai.index'), key: input.key,
        aggregateId: input.resourceId, expectedRevision: input.expectedRevision,
        input: { sourceHash: snapshot.source.hash, model: embeddings.model } }, async ({ session, grant, expectedRevision }) => {
        return publishRebuild({session,grant,expectedRevision,scope,input,snapshot,generation,points});
      });
    },
    async revoke(scope, input) {
      validateRequest(input);
      return commands.execute(scope, { ...scopeTarget(scope, input.plantId, 'ai.index'), key: input.key,
        aggregateId: input.resourceId, expectedRevision: input.expectedRevision, input: { operation: 'REVOKE' } },
      async ({ session, grant, expectedRevision }) => {
        const write = await indexes.updateOne({ tenantId: grant.tenantId, plantId: grant.plantId,
          resourceId: input.resourceId, revision: expectedRevision }, { $set: { active: false }, $inc: { revision: 1 } }, { session });
        if (write.matchedCount !== 1) fail('REVISION_CONFLICT', 409);
        return { revision: expectedRevision + 1, data: { resourceId: input.resourceId, state: 'REVOKED' },
          events: [{ type: 'ai.index.revoked', version: 1, data: { resourceId: input.resourceId } }] };
      });
    },
    async cleanup(scope, input) {
      validateRequest(input);
      if (!vectors.deletePoints) fail('AI_INDEX_CLEANUP_UNAVAILABLE', 503);
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision >= Number.MAX_SAFE_INTEGER || typeof input.key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.key)) fail('AI_INVALID_COMMAND');
      if(managed)return managed.accept(scope,input,'cleanup');
      const retired = await boundedTransaction(client, async session => {
        const grant = await authorize(scope, input.plantId, 'ai.index', session);
        await saasAdmission?.unsupported(scope,{plantId:input.plantId,session});
        const replay=await legacyReplay(scope,input,grant,session,{operation:'CLEANUP'});if(replay)return {replay};
        const row = await indexes.findOne({ tenantId: grant.tenantId, plantId: grant.plantId, resourceId: input.resourceId }, { session });
        // A newer revision may be our own committed cleanup; receipt lookup below reconciles the same key.
        if (!row || row.revision !== input.expectedRevision) return [];
        return [...new Set([...(row.retiredPoints ?? []), ...(!row.active ? row.points : [])])].slice(0, 100);
      });
      if(retired.replay)return retired.replay;
      // Exact retired IDs are never reused. A lost delete acknowledgement can safely repeat the same IDs.
      if (retired.length) await boundedCall(signal => vectors.deletePoints(retired, { signal }));
      return commands.execute(scope, { ...scopeTarget(scope, input.plantId, 'ai.index'), key: input.key,
        aggregateId: input.resourceId, expectedRevision: input.expectedRevision, input: { operation: 'CLEANUP' } },
      async ({ session, grant, expectedRevision }) => {
        return publishCleanup({session,grant,expectedRevision,input,retired});
      });
    },
    async retrieve(scope, { plantId, query, limit = 5 }) {
      if (!uuid(plantId) || typeof query !== 'string' || !query.trim() || query.length > 2000 ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 10) fail('AI_INVALID_QUERY');
      const initial = await foundation.authorize(scope, scopeTarget(scope, plantId, 'ai.retrieve'));
      const embedded = await boundedCall(signal => embeddings.embed([query], { signal }));
      if (!Array.isArray(embedded) || embedded.length !== 1) fail('AI_EMBEDDING_UNAVAILABLE', 503);
      const candidates = await boundedCall(signal => vectors.search(validateVector(embedded[0], embeddings.dimensions), {
        tenantId: initial.tenantId, plantId: initial.plantId, model: embeddings.model, limit: 40, signal }));
      if (!Array.isArray(candidates) || candidates.length > 40) fail('AI_INDEX_INVALID', 502);
      return boundedTransaction(client, async session => {
        const grant = await authorize(scope, plantId, 'ai.retrieve', session);
        const citations = [], seen = new Set();
        for (const candidate of candidates) {
          const p = candidate?.payload;
          if (!p || p.tenantId !== grant.tenantId || p.plantId !== grant.plantId || p.model !== embeddings.model ||
              !uuid(p.resourceId) || !uuid(candidate.id) || !uuid(p.generation) || !positive(p.sourceRevision) ||
              !positive(p.aclRevision) || !Number.isSafeInteger(p.chunkIndex) || p.chunkIndex < 0 || p.chunkIndex >= 100 || seen.has(candidate.id)) continue;
          seen.add(candidate.id);
          const filter = { tenantId: grant.tenantId, plantId: grant.plantId, resourceId: p.resourceId, active: true,
            model: embeddings.model, generation: p.generation, sourceRevision: p.sourceRevision, aclRevision: p.aclRevision, sourceHash: p.sourceHash };
          const index = await indexes.findOne(filter, { session });
          if (!index || !index.points.includes(candidate.id)) continue;
          let fresh;
          try { fresh = await readSource(source, grant, p.resourceId, session, scope); }
          catch (error) { if ([403, 404].includes(error.status)) continue; throw error; }
          if (fresh.hash !== index.sourceHash || p.chunkIndex >= fresh.chunks.length) continue;
          const fence = await indexes.updateOne({ ...filter, revision: index.revision }, { $inc: { readFence: 1 } }, { session });
          if (fence.matchedCount !== 1) fail('AI_INDEX_CHANGED', 409);
          citations.push({ resourceId: p.resourceId, sourceRevision: fresh.revision, aclRevision: fresh.aclRevision,
            indexRevision: index.revision, model: embeddings.model, title: fresh.title, chunkIndex: p.chunkIndex,
            text: fresh.chunks[p.chunkIndex], kind: 'DOCUMENT', trust: 'UNTRUSTED_SOURCE_CONTENT' });
          if (citations.length === limit) break;
        }
        return { schema: 'SCOPED_RETRIEVAL_V1', state: citations.length ? 'DOCUMENT_EVIDENCE' : 'NO_AUTHORIZED_EVIDENCE',
          citations, asOf: clock().toISOString(), coverage: 'BOUNDED_TOP_K' };
      });
    },
  });
}
