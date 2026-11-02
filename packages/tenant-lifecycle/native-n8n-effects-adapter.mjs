import { randomUUID } from 'node:crypto';
import { CommandError, contentHash } from '../tenant-foundation/commands.mjs';
import { effectHash, effectTransaction } from './effect-primitives.mjs';
import { isNativeN8nProvider, verifiedNativeN8nObservation } from './native-n8n-provider.mjs';

const adapters = new WeakSet();
const fail = (code, status = 409) => { throw new CommandError(code, status); };
export const isNativeN8nAdapter = value => adapters.has(value);
const setProof = rows => rows.map(row => ({ attemptId: row._id, commandId: row.commandId, phase: row.phase,
  ordinal: row.ordinal, instanceEpoch: row.instanceEpoch, epoch: row.epoch, fence: row.fence,
  inputHash: row.inputHash, providerKey: row.providerKey, highWater: row.provider?.highWater ?? null,
  bindingHash: row.provider?.bindingHash ?? null, providerState: row.provider?.state ?? 'NOT_PERFORMED',
  receiptHash: row.provider?.proofHash ?? null })).sort((a, b) => a.attemptId.localeCompare(b.attemptId));

export function createNativeN8nEffectsAdapter({ client, db, provider, id = 'native.n8n' }) {
  if (!isNativeN8nProvider(provider) || !provider.owns(client, db) || id !== 'native.n8n') fail('NATIVE_ADAPTER_CONFIGURATION', 503);
  const instanceEpoch = provider.processEpoch, attempts = db.collection('saasEffectAttempts'), commands = db.collection('saasEffectCommands'),
    events = db.collection('saasEffectEvents'), barriers = db.collection('saasEffectBarriers');
  const tx = fn => effectTransaction(client, fn);
  const filter = attempt => ({ _id: attempt._id, tenantId: attempt.tenantId, plantId: attempt.plantId,
    legalEntityId: attempt.legalEntityId, commandId: attempt.commandId, phase: attempt.phase, ordinal: attempt.ordinal,
    adapterId: id, instanceEpoch: attempt.instanceEpoch, epoch: attempt.epoch, providerKey: attempt.providerKey,
    inputHash: attempt.inputHash, fence: attempt.fence });
  function transaction(session) { if (!session?.inTransaction() || session.client !== client) fail('EFFECT_TRANSACTION_REQUIRED', 500); }
  async function record(attempt, session, kind, proof) {
    const command = await commands.findOne({ _id: attempt.commandId, tenantId: attempt.tenantId }, { session });
    if (!command) fail('NATIVE_COMMAND_MISSING');
    const version = command.version + 1;
    const changed = await commands.updateOne({ _id: command._id, tenantId: command.tenantId, version: command.version },
      { $set: { version, updatedAt: new Date().toISOString() } }, { session });
    if (changed.matchedCount !== 1) fail('EFFECT_VERSION_CONFLICT');
    await events.insertOne({ _id: randomUUID(), schemaVersion: 1, tenantId: command.tenantId, commandId: command._id,
      version, kind, proof: { attemptId: attempt._id, adapterId: id, instanceEpoch: attempt.instanceEpoch, ...proof }, occurredAt: new Date().toISOString() }, { session });
  }
  async function bound(attempt, session) {
    const binding = provider.binding(attempt), row = await attempts.findOne(filter(attempt), { session });
    const command = await commands.findOne({ _id: attempt.commandId, tenantId: attempt.tenantId, plantId: attempt.plantId, legalEntityId: attempt.legalEntityId }, { session });
    if (!row || !command || !['automation.native-engine', 'automation.native-delivery'].includes(command.kind) ||
        command.ownerNamespace !== 'automation_audit_logs' || command.plan?.native?.providerId !== provider.id ||
        command.plan.native.instanceId !== provider.instanceId || command.plan.native.workflowId !== binding.workflowId ||
        command.plan.native.workflowHash !== binding.workflowHash ||
        (command.kind === 'automation.native-engine') !== (binding.deliveryId === null) ||
        (binding.deliveryId !== null && attempt.phase !== binding.deliveryId) ||
        (binding.deliveryId === null && attempt.phase !== 'EFFECT') ||
        row.inputHash !== effectHash(row.input) || contentHash(provider.binding(row)) !== contentHash(binding) ||
        (row.provider && (row.provider.mode !== 'NATIVE_LOCAL_N8N' || row.provider.bindingHash !== contentHash(binding)))) fail('NATIVE_ATTEMPT_BINDING_CHANGED');
    return { row, binding };
  }
  const adapter = { id, instanceEpoch, mode: 'NATIVE_LOCAL_N8N',
    async invoke(attempt, work, { authorize } = {}) {
      if (attempt.adapterId !== id || attempt.instanceEpoch !== instanceEpoch || typeof work !== 'function' || typeof authorize !== 'function') fail('NATIVE_INVOKE_CAPABILITY_REQUIRED');
      await tx(async session => {
        await authorize(session);
        const { row, binding } = await bound(attempt, session);
        if (row.provider) fail('NATIVE_ALREADY_BEGUN');
        const tenant = await db.collection('tenants').findOneAndUpdate({ _id: attempt.tenantId, active: true, saasEffectDispatchOpen: { $ne: false },
          ...(attempt.epoch === 0 ? { $or: [{ saasEffectEpoch: 0 }, { saasEffectEpoch: { $exists: false } }] } : { saasEffectEpoch: attempt.epoch }) },
        { $inc: { saasEffectFence: 1, saasEffectHighWater: 1 } }, { session, returnDocument: 'after' });
        if (!tenant) fail('NATIVE_DISPATCH_STOPPED');
        const changed = await attempts.updateOne({ ...filter(attempt), state: 'INVOKING', provider: { $exists: false } },
          { $set: { provider: { state: 'BEGUN', mode: 'NATIVE_LOCAL_N8N', providerId: provider.id, instanceId: provider.instanceId,
            bindingHash: contentHash(binding), highWater: tenant.saasEffectHighWater, startedAt: new Date().toISOString() } } }, { session });
        if (changed.matchedCount !== 1) fail('NATIVE_BEGIN_RACE');
        await record(attempt, session, 'NATIVE_PROVIDER_BEGUN', { bindingHash: contentHash(binding), highWater: tenant.saasEffectHighWater, fence: attempt.fence });
      });
      try {
        const payload = await work();
        await provider.execute(attempt, payload, { authorize });
        const proof = await provider.observe(attempt);
        if (!proof) fail('NATIVE_OUTCOME_UNKNOWN');
        return (await tx(session => adapter.reconcile(attempt, proof, { session }))).result;
      } catch (error) {
        await tx(async session => {
          const changed = await attempts.updateOne({ ...filter(attempt), 'provider.state': 'BEGUN' },
            { $set: { 'provider.state': 'UNKNOWN' } }, { session });
          if (changed.matchedCount) await record(attempt, session, 'NATIVE_PROVIDER_UNKNOWN', { fence: attempt.fence });
        });
        throw error;
      }
    },
    async observe(attempt, { session } = {}) {
      const { row, binding } = await bound(attempt, session);
      if (row.provider?.state !== 'TERMINAL') return { state: row.provider ? 'UNKNOWN' : 'NOT_BEGUN' };
      const proof = row.provider.receipt, proofHash = effectHash({ bindingHash: contentHash(binding), receipt: proof });
      if (proofHash !== row.provider.proofHash || proof?.mode !== 'NATIVE_LOCAL_N8N' || proof.instanceId !== provider.instanceId ||
          proof.providerId !== provider.id || proof.bindingHash !== contentHash(binding)) fail('NATIVE_RECEIPT_CORRUPT');
      return { state: 'TERMINAL', mode: 'NATIVE_LOCAL_N8N', adapterId: id, instanceEpoch: row.instanceEpoch,
        providerKey: row.providerKey, proofHash, result: proof.result };
    },
    async refresh(attempt, { session }) {
      transaction(session);
      await bound(attempt, session);
      const observation = await provider.observe(attempt);
      return observation ? adapter.reconcile(attempt, observation, { session }) : adapter.observe(attempt, { session });
    },
    async reconcile(attempt, observation, { session }) {
      transaction(session);
      const proof = verifiedNativeN8nObservation(observation, attempt, provider), { row, binding } = await bound(attempt, session);
      if (!row.provider?.dispatched || !['BEGUN', 'UNKNOWN', 'TERMINAL'].includes(row.provider.state)) fail('NATIVE_NOT_BEGUN');
      const proofHash = effectHash({ bindingHash: contentHash(binding), receipt: proof });
      if (row.provider.state === 'TERMINAL') {
        if (row.provider.proofHash !== proofHash) fail('NATIVE_RECEIPT_CONFLICT');
        return adapter.observe(attempt, { session });
      }
      const changed = await attempts.updateOne({ ...filter(attempt), 'provider.state': row.provider.state, 'provider.bindingHash': contentHash(binding) },
        { $set: { 'provider.state': 'TERMINAL', 'provider.receipt': proof, 'provider.proofHash': proofHash, 'provider.completedAt': new Date().toISOString() } }, { session });
      if (changed.matchedCount !== 1) fail('NATIVE_RECEIPT_RACE');
      await record(attempt, session, 'NATIVE_PROVIDER_OBSERVED', { proofHash, bindingHash: contentHash(binding), receiptId: proof.receiptId });
      return adapter.observe(attempt, { session });
    },
    async stopAndDrain({ tenantId, stopEpoch }) {
      const gate = () => ({ _id: tenantId, active: true, saasEffectDispatchOpen: false, saasEffectEpoch: stopEpoch });
      if (!await db.collection('tenants').findOne(gate())) fail('NATIVE_STOP_GATE_REQUIRED');
      for (const attempt of await attempts.find({ tenantId, adapterId: id, 'provider.state': { $in: ['BEGUN', 'UNKNOWN'] } }).toArray()) {
        await tx(async session => {
          if (!await db.collection('tenants').findOne(gate(), { session })) fail('NATIVE_STOP_EPOCH_CHANGED');
          await adapter.refresh(attempt, { session });
        });
      }
      return tx(async session => {
        const tenant = await db.collection('tenants').findOneAndUpdate(gate(), { $inc: { saasEffectFence: 1 } }, { session, returnDocument: 'after' });
        if (!tenant) fail('NATIVE_STOP_EPOCH_CHANGED');
        for (const attempt of await attempts.find({ tenantId, adapterId: id, provider: { $exists: false }, state: { $in: ['CLAIMED', 'INVOKING', 'UNKNOWN'] } }, { session }).toArray()) {
          const changed = await attempts.updateOne({ ...filter(attempt), state: attempt.state, provider: { $exists: false } },
            { $set: { state: 'NOT_PERFORMED', stopEpoch, leaseOwner: null, leaseUntil: null }, $inc: { version: 1 } }, { session });
          if (changed.matchedCount !== 1) fail('NATIVE_CANCEL_RACE');
          await record(attempt, session, 'NATIVE_FENCED_BEFORE_BEGIN', { fence: attempt.fence, stopEpoch });
        }
        const rows = await attempts.find({ tenantId, adapterId: id }, { session }).toArray();
        for (const attempt of rows) await adapter.observe(attempt, { session });
        if (rows.some(row => row.provider ? row.provider.state !== 'TERMINAL' : row.state !== 'NOT_PERFORMED')) return { state: 'PENDING', adapterId: id, instanceEpoch, stopEpoch };
        const identity = { tenantId, adapterId: id, instanceEpoch, stopEpoch };
        const proof = { schema: 'NATIVE_N8N_DRAIN_V1', mode: 'NATIVE_LOCAL_N8N', ...identity, providerId: provider.id,
          instanceId: provider.instanceId, highWater: tenant.saasEffectHighWater ?? 0, attemptSet: setProof(rows) }, proofHash = effectHash(proof);
        await barriers.updateOne(identity, { $setOnInsert: { _id: randomUUID(), schemaVersion: 1, ...identity },
          $set: { proof, proofHash, verifiedAt: new Date().toISOString() } }, { session, upsert: true });
        return { state: 'QUIESCENT', ...identity, proofHash, highWater: proof.highWater };
      });
    },
    async verifyBarrier({ tenantId, stopEpoch, session }) {
      const tenant = await db.collection('tenants').findOne({ _id: tenantId, active: true, saasEffectDispatchOpen: false, saasEffectEpoch: stopEpoch }, { session });
      const barrier = await barriers.findOne({ tenantId, adapterId: id, instanceEpoch, stopEpoch }, { session });
      if (!tenant || !barrier || barrier.proofHash !== effectHash(barrier.proof) || barrier.proof.instanceId !== provider.instanceId ||
          barrier.proof.providerId !== provider.id || barrier.proof.highWater !== (tenant.saasEffectHighWater ?? 0)) return false;
      const rows = await attempts.find({ tenantId, adapterId: id }, { session }).toArray();
      if (rows.some(row => row.provider ? row.provider.state !== 'TERMINAL' : row.state !== 'NOT_PERFORMED')) return false;
      for (const attempt of rows) await adapter.observe(attempt, { session });
      return effectHash(setProof(rows)) === effectHash(barrier.proof.attemptSet);
    },
  };
  const frozen = Object.freeze(adapter); adapters.add(frozen); return frozen;
}
