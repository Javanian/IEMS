import { createHash } from 'node:crypto';

const actions = ['binding.create', 'binding.revoke', 'prompt.create', 'session.create', 'policy.pause', 'policy.resume'].map(a => `wa.preview.${a}`);
export const operatorRoleActions = Object.freeze({ bridgeAdmin: Object.freeze(actions), bridgeReader: Object.freeze([]) });
const deny = () => { throw Object.assign(new Error('SCOPE_FORBIDDEN'), { status: 403 }); };

export function createFoundationOperatorAdapter({ foundation, db, tenantId, plantId, account }) {
  if (!foundation || !db || !tenantId || !plantId || !account) throw new Error('Explicit foundation operator scope required');
  return {
    async authenticate(req) {
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1];
      if (!token) deny();
      try {
        const scope = await foundation.authenticate(token);
        const aliases = { tenant: tenantId, tenantId, tenant_id: tenantId, 'x-tenant-id': tenantId, plantId, plant_id: plantId, 'x-plant-id': plantId, account };
        for (const source of [req.headers, req.operatorBody ?? {}, Object.fromEntries(new URL(req.url, 'http://localhost').searchParams)]) {
          for (const [key, expected] of Object.entries(aliases)) if (Object.hasOwn(source, key) && source[key] !== expected) deny();
        }
        if (scope.tenantId !== tenantId || scope.selectedPlantId !== plantId) deny();
        return { id: scope.userId, scope, tokenHash: createHash('sha256').update(token).digest('hex') };
      } catch { deny(); }
    },
    async authorize(actor, action, resource, { session }) {
      if (resource.tenant !== tenantId || resource.account !== account || !actions.includes(action) || !session) deny();
      try {
        const grant = await foundation.authorize(actor.scope, { tenantId, plantId, action });
        // Write fences make revocation and permission changes conflict with the bridge transaction.
        const m = await db.collection('memberships').updateOne({ _id: grant.membershipId, tenantId, active: true, version: grant.membershipVersion }, { $inc: { bridgeAuthorizationRevision: 1 } }, { session });
        const s = await db.collection('sessions').updateOne({ tokenHash: actor.tokenHash, tenantId, selectedPlantId: plantId, membershipId: grant.membershipId, membershipVersion: grant.membershipVersion, revoked: false, expiresAt: { $gt: new Date() } }, { $inc: { bridgeAuthorizationRevision: 1 } }, { session });
        if (m.matchedCount !== 1 || s.matchedCount !== 1) deny();
        return true;
      } catch (error) {
        if (error.status === 403) deny();
        throw error;
      }
    }
  };
}
