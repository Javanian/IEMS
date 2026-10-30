import { JobError, jobScope } from './index.mjs';

// Stored session IDs identify authorization context without retaining bearer tokens.
export function createJobAuthorization({ db, roleActions, actionForKind }) {
  return async (job, { session }) => {
    if (!session?.inTransaction()) throw new JobError('JOB_TRANSACTION_REQUIRED', 500);
    const denied = () => { throw new JobError('JOB_AUTHORIZATION_DENIED', 403); };
    jobScope(job);
    const s = await db.collection('sessions').findOne({ _id: job.authorizationSessionId, tenantId: job.tenantId, userId: job.requestedBy, selectedPlantId: job.plantId, revoked: false, expiresAt: { $gt: new Date() } }, { session });
    if (!s) denied();
    const m = await db.collection('memberships').findOne({ _id: s.membershipId, tenantId: s.tenantId, userId: s.userId, version: s.membershipVersion, active: true }, { session });
    const action = actionForKind(job.kind);
    if (!m || typeof action !== 'string' || (!m.tenantWide && (!m.plantIds?.includes(job.plantId) || !m.legalEntityIds?.includes(job.legalEntityId)))
      || !m.roles?.some(g => (g.tenantWide || g.plantIds?.includes(job.plantId)) && roleActions[g.role]?.includes(action))) denied();
    for (const [name, filter] of [
      ['sessions', { _id: s._id, revoked: false, expiresAt: { $gt: new Date() } }],
      ['memberships', { _id: m._id, active: true, version: m.version }],
      ['users', { _id: s.userId, active: true }],
      ['tenants', { _id: s.tenantId, active: true }],
      ['plants', { _id: job.plantId, tenantId: s.tenantId, legalEntityId: job.legalEntityId, active: true }],
      ['legalEntities', { _id: job.legalEntityId, tenantId: s.tenantId, active: true }]
    ]) {
      const changed = await db.collection(name).updateOne(filter, { $inc: { authorizationFence: 1 } }, { session });
      if (!changed.matchedCount) denied();
    }
    return { ...jobScope(job), userId: s.userId };
  };
}
