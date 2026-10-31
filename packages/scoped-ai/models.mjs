import { randomUUID } from 'node:crypto';
import { boundedTransaction, createCommandExecutor } from '../tenant-foundation/commands.mjs';
import { boundedCall, fail, scopeTarget, uuid } from './indexing.mjs';
import { createPinnedModelScorer } from './temporal.mjs';

export const modelRoles = { aiModelReader: ['ai.model.read', 'ai.predict', 'analytics.read'],
  aiModelOperator: ['ai.model.read', 'ai.model.select', 'ai.predict', 'analytics.read'] };
const modelShape = model => model && Object.keys(model).every(k => ['name', 'version', 'artifactDigest', 'featureKeys'].includes(k)) &&
  typeof model.name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(model.name) && Number.isSafeInteger(model.version) && model.version > 0 &&
  typeof model.artifactDigest === 'string' && /^[a-f0-9]{64}$/.test(model.artifactDigest) && Array.isArray(model.featureKeys) && model.featureKeys.length > 0 &&
  model.featureKeys.length <= 64 && model.featureKeys.every(k => typeof k === 'string' && /^[a-z][a-zA-Z0-9_]{0,63}$/.test(k)) && new Set(model.featureKeys).size === model.featureKeys.length;
const strict = (input, keys) => {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some(k => !keys.includes(k)) || !uuid(input.plantId)) fail('AI_INVALID_MODEL_REQUEST');
};
export function createModelWorkflow({ client, db, foundation, features = null, modelPort = null, featureKeys = [], clock = () => new Date() }) {
  const deployments = db.collection('aiModelSelections'), history = db.collection('aiModelSelectionHistory');
  const filter = grant => ({ tenantId: grant.tenantId, plantId: grant.plantId, legalEntityId: grant.legalEntityId });
  const auth = (scope, plantId, action, session) => foundation.authorizeInTransaction(scope, scopeTarget(scope, plantId, action), { session });
  const commands = createCommandExecutor({ client, db, foundation });
  const scorer = modelPort ? createPinnedModelScorer({ modelPort }) : null;
  return Object.freeze({
    async initialize() { await commands.initialize(); await deployments.createIndex({ tenantId: 1, plantId: 1 }, { unique: true });
      await history.createIndex({ tenantId: 1, plantId: 1, revision: 1 }, { unique: true }); },
    async status(scope, input) {
      strict(input, ['plantId']);
      return boundedTransaction(client, async session => {
        const grant = await auth(scope, input.plantId, 'ai.model.read', session);
        const row = await deployments.findOne(filter(grant), { session });
        return { schema: 'MODEL_SELECTION_V1', revision: row?.revision ?? 0, model: row?.model ?? null,
          previousModel: row?.previousModel ?? null, lineage: row?.lineage ?? null, changedAt: row?.changedAt ?? null,
          sourceConfigured: !!features, modelConfigured: !!modelPort, featureKeys,
          state: !features || !modelPort ? 'UNCONFIGURED' : row ? 'CONFIGURED' : 'NO_MODEL_SELECTED',
          externalBoundary: 'No trained model, source completeness or real predictions are implied by configuration.' };
      });
    },
    async select(scope, input) {
      strict(input, ['plantId', 'key', 'expectedRevision', 'model', 'reason', 'rollback']);
      if (!modelShape(input.model) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500 ||
          typeof input.rollback !== 'boolean' || input.model.featureKeys.length !== featureKeys.length ||
          input.model.featureKeys.some((k, i) => k !== featureKeys[i])) fail('AI_INVALID_MODEL_REQUEST');
      await foundation.authorize(scope, scopeTarget(scope, input.plantId, 'ai.model.select'));
      if (!modelPort) fail('AI_MODEL_VERSION_UNAVAILABLE', 503);
      const metadata = await boundedCall(signal => modelPort.getVersion({ name: input.model.name, version: input.model.version, signal }), 5000);
      if (!metadata || metadata.status !== 'READY' || metadata.name !== input.model.name || metadata.version !== input.model.version ||
          metadata.artifactDigest !== input.model.artifactDigest || JSON.stringify(metadata.featureKeys) !== JSON.stringify(featureKeys) ||
          typeof metadata.runId !== 'string' || !metadata.runId || typeof metadata.sourceManifestHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(metadata.sourceManifestHash)) fail('AI_MODEL_LINEAGE_INVALID', 409);
      return commands.execute(scope, { ...scopeTarget(scope, input.plantId, 'ai.model.select'), key: input.key,
        aggregateId: input.plantId, expectedRevision: input.expectedRevision, input }, async ({ session, grant, expectedRevision }) => {
        const predicate = filter(grant), prior = await deployments.findOne(predicate, { session });
        if ((prior?.revision ?? 0) !== expectedRevision) fail('REVISION_CONFLICT', 409);
        if (input.rollback && (!prior?.previousModel || JSON.stringify(prior.previousModel) !== JSON.stringify(input.model))) fail('AI_ROLLBACK_VERSION_INVALID', 409);
        const revision = expectedRevision + 1, row = { ...predicate, revision, model: input.model, previousModel: prior?.model ?? null,
          lineage: { runId: metadata.runId, sourceManifestHash: metadata.sourceManifestHash }, reason: input.reason,
          changedBy: grant.userId, changedAt: clock().toISOString(), rollback: input.rollback };
        if (prior) {
          const write = await deployments.updateOne({ ...predicate, revision: expectedRevision }, { $set: row }, { session });
          if (write.matchedCount !== 1) fail('REVISION_CONFLICT', 409);
        } else await deployments.insertOne({ _id: randomUUID(), ...row }, { session });
        await history.insertOne({ _id: randomUUID(), ...row }, { session });
        return { revision, data: { revision, state: 'CONFIGURED', model: input.model, lineage: row.lineage },
          events: [{ type: input.rollback ? 'ai.model.rolled_back' : 'ai.model.selected', version: 1,
            data: { revision, modelName: input.model.name, modelVersion: input.model.version } }] };
      });
    },
    async predict(scope, input) {
      strict(input, ['plantId', 'businessAsOf', 'knowledgeAsOf', 'featureSetId']);
      const snapshot = await boundedTransaction(client, async session => {
        const grant = await auth(scope, input.plantId, 'ai.predict', session);
        return deployments.findOne(filter(grant), { session });
      });
      if (!features || !scorer || !snapshot) return { schema: 'SCOPED_PREDICTION_V1', state: 'ABSTAIN', reason: 'MODEL_OR_SOURCE_UNAVAILABLE', predictions: [] };
      const data = await features.read(scope, input);
      if (data.state !== 'READY') return { schema: 'SCOPED_PREDICTION_V1', state: 'ABSTAIN', reason: data.reason, predictions: [] };
      let result;
      try { result = await scorer.predict(snapshot.model, data.rows); }
      catch (error) {
        if (!['AI_PROVIDER_TIMEOUT', 'AI_PROVIDER_UNAVAILABLE', 'AI_MODEL_VERSION_UNAVAILABLE'].includes(error.code)) throw error;
        await foundation.authorize(scope, scopeTarget(scope, input.plantId, 'ai.predict'));
        return { schema: 'SCOPED_PREDICTION_V1', state: 'ABSTAIN', reason: 'MODEL_UNAVAILABLE', predictions: [] };
      }
      return boundedTransaction(client, async session => {
        const grant = await auth(scope, input.plantId, 'ai.predict', session);
        await auth(scope, input.plantId, 'analytics.read', session);
        const write = await deployments.updateOne({ ...filter(grant), revision: snapshot.revision }, { $inc: { readFence: 1 } }, { session });
        if (write.matchedCount !== 1) fail('AI_MODEL_SELECTION_CHANGED', 409);
        return { ...result, schema: 'SCOPED_PREDICTION_V1', selectionRevision: snapshot.revision,
          businessAsOf: input.businessAsOf, knowledgeAsOf: input.knowledgeAsOf, sourceManifestId: data.sourceManifestId,
          sourceManifestHash: data.sourceManifestHash, modelLineage: snapshot.lineage, asOf: clock().toISOString(),
          warning: 'Model estimates are advisory; they do not reserve stock or establish order promises.' };
      });
    },
  });
}
