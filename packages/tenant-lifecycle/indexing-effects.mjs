import { randomUUID } from 'node:crypto';
import { contentHash, canonicalJson, CommandError } from '../tenant-foundation/commands.mjs';
import { controlledIndexProvider, verifiedLocalProviderObservation } from './local-ai-provider.mjs';
import { effectHash, effectTransaction } from './effects.mjs';

const fail = (code, status = 409) => { throw new CommandError(code, status); };
export function createManagedIndexBoundary({ client, db, foundation, saasAdmission, source, embeddings, vectors,
  separateEffects: effects, clock, readSource, readSnapshot, validateVector, publishRebuild, publishCleanup }) {
  const provider = controlledIndexProvider(embeddings, vectors);
  if (!provider || !effects?.hasAdapter('local.ai-index')) fail('AI_EFFECT_ADAPTER_UNPROVEN', 503);
  const controls = db.collection('saasEffectCommands'), attempts = db.collection('saasEffectAttempts'), indexes = db.collection('aiIndexes');
  const results = db.collection('foundationCommandResults'), tx = work => effectTransaction(client, work);
  const identityFor = (grant, input, kind) => ({ tenantId: grant.tenantId, plantId: grant.plantId, userId: grant.userId, action: kind, resourceId: input.resourceId, key: input.key });
  const rootFilter = identity => ({ tenantId: identity.tenantId, ownerNamespace: 'AI_INDEX_ROOT_V1', ownerIdentityHash: contentHash(identity) });
  const finalFilter = (grant, key) => ({ tenantId: grant.tenantId, plantId: grant.plantId, userId: grant.userId, action: 'ai.index', key });
  const indexFilter = (grant, resourceId) => ({ tenantId: grant.tenantId, plantId: grant.plantId, resourceId });
  const authorize = (scope, plantId, session) => foundation.authorizeInTransaction(scope, { tenantId: scope?.tenantId, plantId, action: 'ai.index' }, { session });
  const compareSource = (command, current) => {
    if (command.plan.providerId !== provider.id || command.plan.model !== provider.model || command.plan.dimensions !== provider.dimensions) fail('AI_INDEX_PROVIDER_CHANGED');
    if (current.hash !== command.plan.sourceHash || current.revision !== command.plan.sourceRevision || current.aclRevision !== command.plan.aclRevision) fail('AI_SOURCE_CHANGED');
  };
  const origin = scope => ({ context: { scope }, authorize: async ({ command, session, observation }) => {
    const grant = await authorize(scope, command.plantId, session);
    compareSource(command, await readSource(source, grant, command.plan.resourceId, session, scope));
    if (!observation) await saasAdmission?.authorize(scope, { plantId: command.plantId, session });
    return grant;
  } });
  const phaseReceipt = async (command, phase, session) => {
    const row = await attempts.findOne({ tenantId: command.tenantId, commandId: command._id, phase, state: 'SETTLED' }, { session });
    if (!row?.phaseResult?.receiptId || row.phaseResult.state !== 'COMPLETED') fail('AI_PHASE_DEPENDENCY_PENDING');
    return row.phaseResult;
  };
  async function orphanProof(grant, current, index, old, attempt, session) {
    if (old.ownerNamespace !== 'AI_INDEX_ROOT_V1' || old.kind !== 'ai.index.rebuild' || old.ownerIdentityHash !== contentHash(old.owner.identity) ||
        old.owner.identity.userId !== grant.userId || old.actor.membershipId !== grant.membershipId || old.plan.providerId !== provider.id ||
        old.plan.resourceId !== current.resourceId || old.plantId !== grant.plantId || old.legalEntityId !== grant.legalEntityId ||
        !(old.plan.expectedRevision < index.revision || current.revision > old.plan.sourceRevision && current.hash !== old.plan.sourceHash)) return null;
    const observed = await provider.observe(attempt, { session }); if (!observed) return null;
    const proof = verifiedLocalProviderObservation(observed, attempt);
    if (proof.result.state !== 'COMPLETED' || proof.result.operation !== 'UPSERT' || effectHash(proof.result.pointIds) !== effectHash(old.plan.pointIds) ||
        old.plan.pointIds.some(id => index.active && index.points.includes(id))) return null;
    return { commandId: old._id, attemptId: attempt._id, receiptId: proof.receiptId, proofHash: proof.receiptProofHash, pointIds: old.plan.pointIds };
  }
  async function retiredSelection(grant, current, index, session) {
    const ids = [...new Set([...(index.retiredPoints ?? []), ...(!index.active ? index.points : [])])].slice(0, 100), orphanBindings = [];
    if (ids.length < 100) {
      const previous = await controls.find({ tenantId: grant.tenantId, plantId: grant.plantId, legalEntityId: grant.legalEntityId,
        'actor.userId': grant.userId, kind: 'ai.index.rebuild', 'plan.resourceId': current.resourceId, 'plan.providerId': provider.id }, { session }).sort({ createdAt: 1, _id: 1 }).limit(100).toArray();
      for (const old of previous) {
        if (ids.length === 100) break;
        const attempt = await attempts.findOne({ tenantId: grant.tenantId, commandId: old._id, phase: 'UPSERT' }, { session, sort: { ordinal: -1 } });
        if (!attempt) continue;
        const proof = await orphanProof(grant, current, index, old, attempt, session); if (!proof) continue;
        const present = await provider.existingPointIds(proof.pointIds, { tenantId: grant.tenantId, plantId: grant.plantId, resourceId: current.resourceId, session });
        const selected = present.filter(id => !ids.includes(id)).slice(0, 100 - ids.length);
        if (selected.length) { ids.push(...selected); orphanBindings.push({ ...proof, pointIds: selected }); }
      }
    }
    return { retiredPointIds: ids, orphanBindings };
  }
  async function sourceFor(command, scope) {
    return tx(async session => {
      const grant = await authorize(scope, command.plantId, session), current = await readSource(source, grant, command.plan.resourceId, session, scope);
      compareSource(command, current); return current;
    });
  }
  async function originalReceipt({ command, session, grant, capability, output }) {
    const proof = await effects.worker(capability, { session, publish: true });
    if (proof.command._id !== command._id || proof.command.ownerNamespace !== 'AI_INDEX_ROOT_V1' ||
        !['ai.index.rebuild', 'ai.index.cleanup'].includes(proof.command.kind)) fail('AI_PUBLICATION_CAPABILITY_REQUIRED', 403);
    const descriptor = command.plan.finalDescriptor, filter = finalFilter(grant, command.owner.identity.key);
    if (descriptor.action !== 'ai.index' || descriptor.aggregateId !== command.plan.resourceId || descriptor.key !== filter.key ||
        descriptor.expectedRevision !== command.plan.expectedRevision || descriptor.inputHash !== contentHash({ action: descriptor.action, aggregateId: descriptor.aggregateId, expectedRevision: descriptor.expectedRevision, input: descriptor.input })) fail('AI_FINAL_DESCRIPTOR_INVALID');
    const previous = await results.findOne(filter, { session });
    if (previous) {
      if (previous.inputHash !== descriptor.inputHash || previous.commandControlId !== command._id) fail('AI_FINAL_RECEIPT_BINDING_REQUIRED');
      return previous.response;
    }
    if (output.revision !== descriptor.expectedRevision + 1 || !Array.isArray(output.events) || output.events.length > 100) fail('INVALID_COMMAND_RESULT', 500);
    canonicalJson(output.data);
    const occurredAt = new Date(), commandId = randomUUID(), response = { data: output.data, revision: output.revision, commandId, replayed: false };
    const events = output.events.map(event => {
      if (typeof event.type !== 'string' || !event.type || !Number.isSafeInteger(event.version) || event.version < 1) fail('INVALID_EVENT', 500);
      canonicalJson(event.data);
      return { _id: randomUUID(), tenantId: grant.tenantId, plantId: grant.plantId, legalEntityId: grant.legalEntityId,
        aggregateId: descriptor.aggregateId, aggregateRevision: output.revision, type: event.type, schemaVersion: event.version,
        data: event.data, occurredAt, commandId, publishedAt: null };
    });
    await results.insertOne({ _id: commandId, ...filter, inputHash: descriptor.inputHash, response, occurredAt, commandControlId: command._id }, { session });
    await db.collection('audit').insertOne({ _id: randomUUID(), ...grant, kind: descriptor.action, subjectId: descriptor.aggregateId, revision: output.revision, commandId, occurredAt }, { session });
    if (events.length) await db.collection('outbox').insertMany(events, { session });
    return response;
  }
  for (const operation of ['rebuild', 'cleanup']) {
    const kind = `ai.index.${operation}`;
    effects.registerKind(kind, {
      adapterId: 'local.ai-index', providerId: provider.id, statusAction: 'ai.index',
      phases: () => operation === 'rebuild' ? ['EMBED', 'UPSERT'] : ['DELETE'],
      rebind: async ({ scope }) => origin(scope),
      readStatus: async ({ scope, grant, command, session }) => { compareSource(command, await readSnapshot({ scope, grant, resourceId: command.plan.resourceId, session })); },
      observe: ({ attempt, session }) => provider.observe(attempt, { session }),
      stopProvider: input => provider.stopAndDrain(input), verifyProviderBarrier: input => provider.verifyBarrier(input),
      prepare: async ({ command, phase, session }) => {
        if (phase === 'UPSERT') await phaseReceipt(command, 'EMBED', session);
        return { providerId: provider.id, resourceId: command.plan.resourceId, sourceHash: command.plan.sourceHash,
          ...(phase === 'DELETE' ? { pointIds: command.plan.retiredPointIds } : { pointIds: command.plan.pointIds, chunksHash: command.plan.chunksHash, generation: command.plan.generation }) };
      },
      beforeInvoke: async ({ command, attempt, session }) => {
        if (attempt.phase === 'UPSERT') await phaseReceipt(command, 'EMBED', session);
        const row = await indexes.findOne(indexFilter(command, command.plan.resourceId), { session });
        if ((row?.revision ?? 0) !== command.plan.expectedRevision || (operation === 'cleanup' && row?.generation !== command.plan.indexGeneration)) fail('REVISION_CONFLICT');
        if (operation === 'cleanup') for (const binding of command.plan.orphanBindings ?? []) {
          const old = await controls.findOne({ _id: binding.commandId, tenantId: command.tenantId }, { session }), oldAttempt = await attempts.findOne({ _id: binding.attemptId, tenantId: command.tenantId, commandId: binding.commandId }, { session });
          if (!old || !oldAttempt) fail('AI_ORPHAN_PROOF_CHANGED');
          const proof = await orphanProof({ ...command, userId: command.actor.userId, membershipId: command.actor.membershipId }, { resourceId: command.plan.resourceId, revision: command.plan.sourceRevision, hash: command.plan.sourceHash }, row, old, oldAttempt, session);
          if (!proof || proof.receiptId !== binding.receiptId || proof.proofHash !== binding.proofHash || binding.pointIds.some(id => !proof.pointIds.includes(id))) fail('AI_ORPHAN_PROOF_CHANGED');
        }
      },
      invoke: async ({ command, attempt, context }) => {
        const current = await sourceFor(command, context.scope);
        if (attempt.phase === 'EMBED') return provider.embed(attempt, current.chunks);
        if (attempt.phase === 'DELETE') return vectors.deletePoints(command.plan.retiredPointIds, { attempt });
        const embedded = await tx(session => phaseReceipt(command, 'EMBED', session));
        const values = await provider.embeddingValues(embedded.receiptId, { tenantId: command.tenantId, commandId: command._id });
        if (values.length !== command.plan.pointIds.length) fail('AI_EMBEDDING_UNAVAILABLE', 503);
        const points = values.map((value, index) => ({ id: command.plan.pointIds[index], vector: validateVector(value, embeddings.dimensions), payload: {
          tenantId: command.tenantId, plantId: command.plantId, resourceId: command.plan.resourceId,
          sourceRevision: current.revision, aclRevision: current.aclRevision, sourceHash: current.hash,
          model: embeddings.model, generation: command.plan.generation, chunkIndex: index } }));
        return vectors.upsert(points, { attempt });
      },
      publish: async ({ command, attempt, observation, session, capability, context }) => {
        const outcome = observation.result;
        if (outcome.state !== 'COMPLETED' || outcome.operation !== attempt.phase || !outcome.receiptId) fail('AI_PROVIDER_PROOF_REQUIRED');
        if (attempt.phase === 'EMBED') {
          const values = await provider.embeddingValues(outcome.receiptId, { tenantId: command.tenantId, commandId: command._id, session });
          if (values.length !== command.plan.pointIds.length) fail('AI_EMBEDDING_UNAVAILABLE', 503);
          for (const value of values) validateVector(value, embeddings.dimensions);
          return outcome;
        }
        const grant = await authorize(context.scope, command.plantId, session), input = { resourceId: command.plan.resourceId };
        const output = operation === 'rebuild'
          ? await publishRebuild({ session, grant, expectedRevision: command.plan.expectedRevision, scope: context.scope, input,
            snapshot: { source: { hash: command.plan.sourceHash } }, generation: command.plan.generation, points: command.plan.pointIds.map(id => ({ id })) })
          : await publishCleanup({ session, grant, expectedRevision: command.plan.expectedRevision, input, retired: command.plan.retiredPointIds });
        const response = await originalReceipt({ command, session, grant, capability, output });
        return { ...outcome, response };
      },
    });
  }
  return Object.freeze({
    async accept(scope, input, operation) {
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.key) || input.expectedRevision >= Number.MAX_SAFE_INTEGER) fail('INVALID_COMMAND', 400);
      const kind = `ai.index.${operation}`, payloadHash = contentHash({ action: kind, resourceId: input.resourceId, expectedRevision: input.expectedRevision, input: {} });
      const accepted = await tx(async session => {
        const grant = await authorize(scope, input.plantId, session), identity = identityFor(grant, input, kind), prior = await controls.findOne(rootFilter(identity), { session });
        if (prior && prior.payloadHash !== payloadHash) fail('IDEMPOTENCY_CONFLICT');
        const current = await readSource(source, grant, input.resourceId, session, scope);
        let plan = prior?.plan;
        const final = await results.findOne(finalFilter(grant, input.key), { session });
        if (final) {
          const expectedInput = operation === 'rebuild' ? { sourceHash: prior?.plan.sourceHash ?? current.hash, model: embeddings.model } : { operation: 'CLEANUP' };
          if (final.inputHash !== contentHash({ action: 'ai.index', aggregateId: input.resourceId, expectedRevision: input.expectedRevision, input: expectedInput })) fail('IDEMPOTENCY_CONFLICT');
          if (!prior || final.commandControlId !== prior._id) fail('HISTORICAL_EFFECT_BINDING_REQUIRED');
        }
        if (!prior) {
          const row = await indexes.findOne(indexFilter(grant, input.resourceId), { session });
          if ((row?.revision ?? 0) !== input.expectedRevision || operation === 'cleanup' && !row) fail('REVISION_CONFLICT');
          if (operation === 'rebuild' && [...new Set([...(row?.retiredPoints ?? []), ...(row?.points ?? [])])].length > 1000) fail('AI_INDEX_CLEANUP_REQUIRED');
          const finalInput = operation === 'rebuild' ? { sourceHash: current.hash, model: embeddings.model } : { operation: 'CLEANUP' };
          const descriptor = { action: 'ai.index', aggregateId: input.resourceId, key: input.key, expectedRevision: input.expectedRevision, input: finalInput };
          descriptor.inputHash = contentHash({ action: descriptor.action, aggregateId: descriptor.aggregateId, expectedRevision: descriptor.expectedRevision, input: finalInput });
          plan = { resourceId: input.resourceId, providerId: provider.id, model: provider.model, dimensions: provider.dimensions,
            sourceHash: current.hash, sourceRevision: current.revision, aclRevision: current.aclRevision, expectedRevision: input.expectedRevision,
            finalDescriptor: descriptor, ...(operation === 'rebuild' ? { chunksHash: effectHash(current.chunks), generation: randomUUID(), pointIds: current.chunks.map(() => randomUUID()) }
              : { indexGeneration: row.generation, ...await retiredSelection(grant, current, row, session) }) };
        }
        const id = prior?._id ?? randomUUID(), command = await effects.accept({ session, id, grant, actor: { type: 'USER', userId: grant.userId, membershipId: grant.membershipId },
          owner: { namespace: 'AI_INDEX_ROOT_V1', identity, hashField: 'payloadHash', payloadHash }, kind, plan,
          accepted: { commandId: id, resourceId: input.resourceId, state: 'ACCEPTED', mode: 'LOCAL_SIMULATED' }, origin: origin(scope) });
        return { command, enrolled: !!await db.collection('saasSubscriptions').findOne({ tenantId: grant.tenantId }, { session }) };
      });
      if (accepted.enrolled) return { accepted: true, ...accepted.command.acceptedResult };
      for (const phase of operation === 'rebuild' ? ['EMBED', 'UPSERT'] : ['DELETE']) await effects.run(accepted.command._id, phase);
      return tx(async session => {
        const grant = await authorize(scope, input.plantId, session), final = await results.findOne(finalFilter(grant, input.key), { session });
        if (!final || final.commandControlId !== accepted.command._id) fail('AI_FINAL_RECEIPT_BINDING_REQUIRED');
        return final.response;
      });
    },
    async status(scope, input) {
      const target = { tenantId: scope?.tenantId, plantId: input.plantId, action: 'ai.index' }, grant = await foundation.authorize(scope, target);
      const result = await tx(async session => {
        const current = await readSnapshot({ scope, grant, resourceId: input.resourceId, session }), row = await indexes.findOne(indexFilter(grant, input.resourceId), { session });
        const state = !row ? 'NOT_INDEXED' : !row.active ? 'REVOKED' : row.model !== embeddings.model || row.dimensions !== embeddings.dimensions ? 'MODEL_CHANGED' : row.sourceHash !== current.hash ? 'SOURCE_CHANGED' : 'CURRENT';
        return { schema: 'SCOPED_INDEX_STATUS_V1', resourceId: input.resourceId, revision: row?.revision ?? 0, sourceRevision: current.revision, aclRevision: current.aclRevision,
          indexedSourceRevision: row?.sourceRevision ?? null, model: embeddings.model, indexedModel: row?.model ?? null, state, nextAction: state === 'CURRENT' ? 'NONE' : 'REBUILD',
          retiredPointCount: (row?.retiredPoints?.length ?? 0) + (row && !row.active ? row.points.length : 0), asOf: clock().toISOString() };
      });
      const fresh = await foundation.authorize(scope, target);
      if (effectHash(fresh) !== effectHash(grant)) fail('SCOPE_DENIED', 403);
      return result;
    },
  });
}
