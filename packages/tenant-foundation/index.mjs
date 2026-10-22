import { createHash, randomBytes, randomUUID } from 'node:crypto';

export class ScopeDenied extends Error {
  constructor() { super('Scope denied'); this.name = 'ScopeDenied'; this.code = 'SCOPE_DENIED'; this.status = 403; }
}
const deny = () => { throw new ScopeDenied(); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const id = value => { if (!uuid(value)) deny(); return value; };
const hash = token => createHash('sha256').update(token).digest('hex');
const list = value => { if (!Array.isArray(value) || value.length > 1000 || !value.every(uuid) || new Set(value).size !== value.length) deny(); return [...value]; };

export function resolveScopeAliases({ body = {}, query = {}, headers = {} } = {}) {
  const read = keys => {
    const values = [];
    for (const source of [body, query, headers]) {
      if (!source || typeof source !== 'object' || Array.isArray(source)) deny();
      for (const key of keys) if (Object.hasOwn(source, key)) values.push(id(source[key]));
    }
    if (!values.length || values.some(v => v !== values[0])) deny();
    return values[0];
  };
  return Object.freeze({ tenantId: read(['tenantId', 'tenant_id', 'x-tenant-id']), plantId: read(['plantId', 'plant_id', 'x-plant-id']) });
}

export function createTenantFoundation({ client, db, roleActions }) {
  const policy = new Map(Object.entries(roleActions).map(([role, actions]) => [role, new Set(actions)]));
  const scopes = new WeakMap();
  const c = name => db.collection(name);
  async function atomic(kind, tenantId, subjectId, effect) {
    const session = client.startSession();
    try {
      return await session.withTransaction(async () => {
        const result = await effect(session);
        await c('audit').insertOne({ _id: randomUUID(), tenantId, kind, subjectId, occurredAt: new Date() }, { session });
        return result;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    } finally { await session.endSession(); }
  }
  async function active(name, filter, session) {
    const record = await c(name).findOne({ ...filter, active: true }, { session });
    if (!record) deny();
    return record;
  }
  async function membership(userId, tenantId, plantId, session) {
    await active('tenants', { _id: id(tenantId) }, session);
    await active('users', { _id: id(userId) }, session);
    const m = await active('memberships', { tenantId, userId }, session);
    const p = await active('plants', { _id: id(plantId), tenantId }, session);
    await active('legalEntities', { _id: p.legalEntityId, tenantId }, session);
    if (!m.tenantWide && (!m.plantIds.includes(p._id) || !m.legalEntityIds.includes(p.legalEntityId))) deny();
    return { m, p };
  }
  async function verify(sessionId, session) {
    const s = await c('sessions').findOne({ _id: sessionId, revoked: false, expiresAt: { $gt: new Date() } }, { session });
    if (!s) deny();
    const { m } = await membership(s.userId, s.tenantId, s.selectedPlantId, session);
    if (m._id !== s.membershipId || m.version !== s.membershipVersion) deny();
    return { s, m };
  }
  async function provision(name, record, tenantId) {
    return atomic(`${name}.created`, tenantId, record._id, async session => {
      await c(name).insertOne({ ...record, active: true, version: 1 }, { session });
      return record._id;
    });
  }
  return Object.freeze({
    async initialize() {
      await c('memberships').createIndex({ tenantId: 1, userId: 1 }, { unique: true });
      await c('sessions').createIndex({ tokenHash: 1 }, { unique: true });
      await c('audit').createIndex({ tenantId: 1, occurredAt: 1 });
    },
    async provisionTenant({ id: value }) { return provision('tenants', { _id: id(value) }, value); },
    async provisionUser({ id: value, tenantId }) {
      await active('tenants', { _id: id(tenantId) });
      return provision('users', { _id: id(value) }, tenantId);
    },
    async provisionLegalEntity({ id: value, tenantId }) {
      await active('tenants', { _id: id(tenantId) });
      return provision('legalEntities', { _id: id(value), tenantId }, tenantId);
    },
    async provisionPlant({ id: value, tenantId, legalEntityId }) {
      await active('legalEntities', { _id: id(legalEntityId), tenantId: id(tenantId) });
      return provision('plants', { _id: id(value), tenantId, legalEntityId }, tenantId);
    },
    async provisionMembership({ id: value, tenantId, userId, legalEntityIds, plantIds, tenantWide = false, roles }) {
      id(value); id(tenantId); id(userId);
      const entities = list(legalEntityIds), plants = list(plantIds);
      if (typeof tenantWide !== 'boolean' || !Array.isArray(roles) || roles.length > 100) deny();
      const grants = roles.map(g => {
        if (!g || typeof g.role !== 'string' || !policy.has(g.role) || typeof (g.tenantWide ?? false) !== 'boolean') deny();
        const selected = list(g.plantIds);
        if (g.tenantWide && !tenantWide) deny();
        if (!tenantWide && selected.some(p => !plants.includes(p))) deny();
        return { role: g.role, plantIds: selected, tenantWide: g.tenantWide === true };
      });
      return atomic('memberships.created', tenantId, value, async session => {
        await active('tenants', { _id: tenantId }, session);
        await active('users', { _id: userId }, session);
        for (const entity of entities) await active('legalEntities', { _id: entity, tenantId }, session);
        for (const plant of new Set([...plants, ...grants.flatMap(g => g.plantIds)])) {
          const p = await active('plants', { _id: plant, tenantId }, session);
          if (!tenantWide && !entities.includes(p.legalEntityId)) deny();
        }
        await c('memberships').insertOne({ _id: value, tenantId, userId, legalEntityIds: entities, plantIds: plants, tenantWide, roles: grants, active: true, version: 1 }, { session });
        return value;
      });
    },
    async issueSession({ userId, tenantId, selectedPlantId, ttlMs }) {
      if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 86400000) deny();
      const token = randomBytes(32).toString('base64url'), sessionId = randomUUID();
      const expiresAt = new Date(Date.now() + ttlMs);
      await atomic('sessions.issued', id(tenantId), sessionId, async session => {
        const { m } = await membership(userId, tenantId, selectedPlantId, session);
        await c('sessions').insertOne({ _id: sessionId, userId, tenantId, selectedPlantId, membershipId: m._id, membershipVersion: m.version, tokenHash: hash(token), expiresAt, revoked: false }, { session });
      });
      return { token, sessionId, expiresAt };
    },
    async switchSession(scope, { tenantId, selectedPlantId, ttlMs }) {
      const previousId = scopes.get(scope);
      if (!previousId || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 86400000) deny();
      const token = randomBytes(32).toString('base64url'), sessionId = randomUUID();
      const expiresAt = new Date(Date.now() + ttlMs);
      await atomic('sessions.switched', id(tenantId), sessionId, async session => {
        const { s } = await verify(previousId, session);
        const { m } = await membership(s.userId, tenantId, selectedPlantId, session);
        const revoked = await c('sessions').updateOne({ _id: previousId, revoked: false }, { $set: { revoked: true } }, { session });
        if (revoked.matchedCount !== 1) deny();
        await c('sessions').insertOne({ _id: sessionId, userId: s.userId, tenantId, selectedPlantId, membershipId: m._id, membershipVersion: m.version, tokenHash: hash(token), expiresAt, revoked: false }, { session });
      });
      return { token, sessionId, expiresAt };
    },
    async scopedFilter(scope, target, predicate = {}) {
      const grant = await this.authorize(scope, target);
      return { $and: [{ tenantId: grant.tenantId, plantId: grant.plantId }, structuredClone(predicate)] };
    },
    async revokeSession({ tenantId, sessionId }) {
      id(tenantId); id(sessionId);
      await atomic('sessions.revoked', tenantId, sessionId, async session => {
        const result = await c('sessions').updateOne({ _id: sessionId, tenantId, revoked: false }, { $set: { revoked: true } }, { session });
        if (result.matchedCount !== 1) deny();
      });
    },
    async invalidateMembership({ tenantId, membershipId, expectedVersion, active: enabled }) {
      id(tenantId); id(membershipId);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || expectedVersion >= 2147483647 || typeof enabled !== 'boolean') deny();
      await atomic('memberships.invalidated', tenantId, membershipId, async session => {
        const result = await c('memberships').updateOne({ _id: membershipId, tenantId, version: expectedVersion }, { $set: { active: enabled }, $inc: { version: 1 } }, { session });
        if (result.matchedCount !== 1) deny();
      });
    },
    async listAudit({ tenantId, limit = 1000 }) {
      id(tenantId);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) deny();
      return c('audit').find({ tenantId }).sort({ occurredAt: 1, _id: 1 }).limit(limit).toArray();
    },
    async authenticate(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) deny();
      const record = await c('sessions').findOne({ tokenHash: hash(token) });
      if (!record) deny();
      const { s } = await verify(record._id);
      const scope = Object.freeze({ tenantId: s.tenantId, userId: s.userId, membershipId: s.membershipId, membershipVersion: s.membershipVersion, selectedPlantId: s.selectedPlantId });
      scopes.set(scope, s._id);
      return scope;
    },
    async authorizeInTransaction(scope, { tenantId, plantId, action }, { session }) {
      if (!session?.inTransaction()) deny();
      const sessionId = scopes.get(scope);
      if (!sessionId) deny();
      const { s, m } = await verify(sessionId, session);
      if (tenantId !== undefined && tenantId !== s.tenantId) deny();
      const { p } = await membership(s.userId, s.tenantId, plantId, session);
      if (typeof action !== 'string' || !m.roles.some(g => (g.tenantWide || g.plantIds.includes(p._id)) && policy.get(g.role)?.has(action))) deny();
      // Real writes force stale snapshots to conflict with revocation, even when membership version is unchanged.
      for (const [name, filter] of [
        ['sessions', { _id: s._id, revoked: false, expiresAt: { $gt: new Date() } }],
        ['memberships', { _id: m._id, tenantId: s.tenantId, active: true, version: m.version }],
        ['users', { _id: s.userId, active: true }],
        ['tenants', { _id: s.tenantId, active: true }],
        ['plants', { _id: p._id, tenantId: s.tenantId, active: true }],
        ['legalEntities', { _id: p.legalEntityId, tenantId: s.tenantId, active: true }]
      ]) {
        const result = await c(name).updateOne(filter, { $inc: { authorizationFence: 1 } }, { session });
        if (result.matchedCount !== 1) deny();
      }
      return Object.freeze({ tenantId: s.tenantId, plantId: p._id, legalEntityId: p.legalEntityId, userId: s.userId, membershipId: m._id, membershipVersion: m.version });
    },
    async authorize(scope, { tenantId, plantId, action }) {
      const sessionId = scopes.get(scope);
      if (!sessionId) deny();
      const { s, m } = await verify(sessionId);
      if (tenantId !== undefined && tenantId !== s.tenantId) deny();
      const { p } = await membership(s.userId, s.tenantId, plantId);
      if (typeof action !== 'string' || !m.roles.some(g => (g.tenantWide || g.plantIds.includes(p._id)) && policy.get(g.role)?.has(action))) deny();
      return Object.freeze({ tenantId: s.tenantId, plantId: p._id, legalEntityId: p.legalEntityId, userId: s.userId, membershipId: m._id, membershipVersion: m.version });
    }
  });
}
