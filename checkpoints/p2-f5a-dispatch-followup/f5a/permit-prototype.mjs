import { createHash, randomUUID } from 'node:crypto';

// Isolated F5-A candidate. No application imports or production registration.
export const prototypeCollections = Object.freeze({
  permits: 'f5aPrototypePermits', origins: 'f5aPrototypePermitOrigins', events: 'f5aPrototypePermitEvents',
  issueKeys: 'f5aPrototypeIssueKeys', effects: 'f5aPrototypeEffects', commandKeys: 'f5aPrototypeCommandKeys',
  audit: 'f5aPrototypeAudit', outbox: 'f5aPrototypeOutbox',
});
const canonical = value => value instanceof Date ? { date: value.toISOString() } : Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const prototypeHash = value => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const deny = () => fail(403, 'SCOPE_DENIED');
const invalid = () => fail(409, 'F5A_PERMIT_SOURCE_INVALID');
const positive = value => Number.isSafeInteger(value) && value > 0;
const semantic = value => Object.fromEntries(Object.entries(value).filter(([name]) => !['authorityHash', 'eventId'].includes(name)));
const hashless = value => Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'contentHash'));
const key = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) fail(400, 'INVALID_COMMAND_KEY'); return value; };
const immutable = value => Object.fromEntries(['_id', 'tenantId', 'sessionId', 'userId', 'membershipId', 'membershipVersion',
  'plantId', 'legalEntityId', 'policyHash', 'rolesHash', 'scopeHash', 'actions', 'issuedAt', 'originHash'].map(name => [name, value[name]]));

export function createPermitPrototype({ db, foundation, roleActions, now = () => new Date(), maxPermitsPerTenant = 8, hooks = {} }) {
  if (!positive(maxPermitsPerTenant) || maxPermitsPerTenant > 32) throw new TypeError('Prototype permit budget must be1..32');
  const scopes = new WeakMap(), policyHash = prototypeHash(roleActions);
  const policy = new Map(Object.entries(roleActions).map(([name, actions]) => [name, new Set(actions)]));
  const c = name => db.collection(prototypeCollections[name]);
  const instant = () => { const value = now(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError('Invalid prototype clock'); return value; };
  const transaction = session => { if (!session?.inTransaction()) throw new TypeError('Prototype requires a caller-owned transaction'); };
  const ttl = value => { if (!positive(value) || value > 3600000) fail(400, 'INVALID_PERMIT_TTL'); return value; };
  const options = session => ({ session });

  async function authority(scope, plantId, actions, session, phase) {
    transaction(session);
    if (prototypeHash(roleActions) !== policyHash) fail(409, 'F5A_POLICY_CHANGED');
    const sessionId = scopes.get(scope);
    if (!sessionId || plantId !== scope.selectedPlantId || !Array.isArray(actions) || !actions.length
      || actions.length > 32 || new Set(actions).size !== actions.length || actions.some(action => typeof action !== 'string')) deny();
    const time = instant(), opts = options(session);
    const s = await db.collection('sessions').findOne({ _id: sessionId, revoked: false, expiresAt: { $gt: time } }, opts);
    if (!s || s.tenantId !== scope.tenantId || s.userId !== scope.userId || s.selectedPlantId !== plantId) deny();
    const m = await db.collection('memberships').findOne({ _id: s.membershipId, tenantId: s.tenantId, userId: s.userId, active: true, version: s.membershipVersion }, opts);
    const user = await db.collection('users').findOne({ _id: s.userId, active: true }, opts);
    const tenant = await db.collection('tenants').findOne({ _id: s.tenantId, active: true }, opts);
    const plant = await db.collection('plants').findOne({ _id: plantId, tenantId: s.tenantId, active: true }, opts);
    const entity = plant && await db.collection('legalEntities').findOne({ _id: plant.legalEntityId, tenantId: s.tenantId, active: true }, opts);
    if (!m || !user || !tenant || !plant || !entity || !Array.isArray(m.roles) || !Array.isArray(m.plantIds)
      || !Array.isArray(m.legalEntityIds) || !m.tenantWide && (!m.plantIds.includes(plantId) || !m.legalEntityIds.includes(entity._id))) deny();
    for (const action of actions) if (!m.roles.some(grant => (grant.tenantWide || grant.plantIds.includes(plantId)) && policy.get(grant.role)?.has(action))) deny();
    const result = { s, m, user, tenant, plant, entity, time, rolesHash: prototypeHash(m.roles),
      scopeHash: prototypeHash({ tenantWide: m.tenantWide, plantIds: m.plantIds, legalEntityIds: m.legalEntityIds }) };
    await hooks.afterAuthorityRead?.({ phase, session });
    return result;
  }

  async function registrationFence(source, session) {
    const rows = [
      ['sessions', { _id: source.s._id, revoked: false, expiresAt: { $gt: instant() }, membershipVersion: source.s.membershipVersion }],
      ['memberships', { _id: source.m._id, tenantId: source.s.tenantId, active: true, version: source.m.version }],
      ['users', { _id: source.user._id, active: true }], ['tenants', { _id: source.tenant._id, active: true }],
      ['plants', { _id: source.plant._id, tenantId: source.s.tenantId, active: true }],
      ['legalEntities', { _id: source.entity._id, tenantId: source.s.tenantId, active: true }],
    ];
    for (const [name, filter] of rows) {
      const changed = await db.collection(name).updateOne(filter, { $inc: { f5aPermitRegistrationFence: 1 } }, options(session));
      if (changed.matchedCount !== 1) deny();
    }
  }

  async function readPermit(permitId, tenantId, session) {
    transaction(session);
    const filter = { _id: permitId, tenantId }, opts = options(session);
    const head = await c('permits').findOne(filter, opts), origin = await c('origins').findOne(filter, opts);
    if (!head || !origin || prototypeHash(hashless(origin)) !== origin.contentHash || head.originHash !== origin.contentHash) invalid();
    const expectedBinding = { ...origin.binding, originHash: origin.contentHash };
    if (prototypeHash(immutable(head)) !== prototypeHash(immutable(expectedBinding)) || !positive(head.version) || head.version > 128) invalid();
    const events = await c('events').find({ tenantId, permitId }, opts).sort({ version: 1 }).limit(129).toArray();
    if (events.length !== head.version) invalid();
    let previous = null, previousHash = null;
    for (const [index, event] of events.entries()) {
      const row = event.snapshot;
      if (!row || event.version !== index + 1 || row.version !== event.version || event.previousHash !== previousHash
        || prototypeHash(row) !== event.contentHash || prototypeHash(immutable(row)) !== prototypeHash(immutable(expectedBinding))
        || !(row.expiresAt instanceof Date) || !Number.isSafeInteger(row.uses) || row.uses < 0) invalid();
      if (!previous) {
        if (event.kind !== 'ISSUED' || row.generation !== 1 || row.active !== true || row.uses !== 0
          || row.expiresAt.getTime() !== origin.binding.expiresAt.getTime()) invalid();
      } else {
        if (!previous.active || !['USED', 'RENEWED', 'REVOKED'].includes(event.kind)) invalid();
        if (event.kind === 'REVOKED') {
          if (row.active !== false || row.generation !== previous.generation + 1 || row.uses !== previous.uses
            || row.expiresAt.getTime() !== previous.expiresAt.getTime()) invalid();
        } else if (row.active !== true || row.generation !== previous.generation || row.generation !== 1
          || row.uses !== previous.uses + (event.kind === 'USED' ? 1 : 0)
          || (event.kind === 'USED' ? row.expiresAt.getTime() !== previous.expiresAt.getTime() : row.expiresAt <= previous.expiresAt)) invalid();
      }
      previous = row; previousHash = event.contentHash;
    }
    if (events.at(-1)._id !== head.eventId || previousHash !== head.authorityHash || prototypeHash(semantic(head)) !== previousHash) invalid();
    return head;
  }

  async function append(previous, value, kind, session) {
    if (previous?.version >= (kind === 'REVOKED' ? 128 : 127)) fail(409, 'F5A_PERMIT_HISTORY_LIMIT');
    const snapshot = { ...semantic(value), version: previous ? previous.version + 1 : 1 };
    const eventId = randomUUID(), authorityHash = prototypeHash(snapshot), head = { ...snapshot, eventId, authorityHash };
    if (previous) {
      const changed = await c('permits').replaceOne({ _id: head._id, tenantId: head.tenantId, version: previous.version, authorityHash: previous.authorityHash }, head, options(session));
      if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
    } else await c('permits').insertOne(head, options(session));
    await c('events').insertOne({ _id: eventId, tenantId: head.tenantId, permitId: head._id, version: head.version, kind,
      previousHash: previous?.authorityHash || null, snapshot, contentHash: authorityHash }, options(session));
    return head;
  }

  function matchesSource(head, source, action) {
    if (!head.active || head.generation !== 1 || head.expiresAt <= instant() || head.sessionId !== source.s._id
      || head.userId !== source.s.userId || head.membershipId !== source.m._id || head.membershipVersion !== source.m.version
      || head.plantId !== source.plant._id || head.legalEntityId !== source.entity._id || head.policyHash !== policyHash
      || head.rolesHash !== source.rolesHash || head.scopeHash !== source.scopeHash || !head.actions.includes(action)) deny();
  }

  const api = {
    async initialize() {
      await c('permits').createIndex({ tenantId: 1, sessionId: 1, plantId: 1 }, { unique: true });
      await c('permits').createIndex({ tenantId: 1, membershipId: 1 });
      await c('events').createIndex({ tenantId: 1, permitId: 1, version: 1 }, { unique: true });
      for (const name of ['issueKeys', 'commandKeys', 'effects', 'audit', 'outbox']) await c(name).createIndex({ tenantId: 1, key: 1 }, { unique: true });
    },
    async authenticate(token) {
      const scope = await foundation.authenticate(token);
      const actual = await db.collection('sessions').findOne({ tokenHash: createHash('sha256').update(token).digest('hex') });
      if (!actual) deny();
      scopes.set(scope, actual._id);
      return scope;
    },
    async issuePermit(scope, { plantId, actions, ttlMs, commandKey }, { session }) {
      key(commandKey); ttl(ttlMs);
      const source = await authority(scope, plantId, actions, session, 'issue');
      await registrationFence(source, session);
      const payloadHash = prototypeHash({ kind: 'ISSUE', sessionId: source.s._id, plantId, actions, ttlMs });
      const prior = await c('issueKeys').findOne({ tenantId: source.s.tenantId, key: commandKey }, options(session));
      if (prior) {
        if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT');
        await readPermit(prior.result.permitId, source.s.tenantId, session);
        return prior.result;
      }
      const existing = await c('permits').findOne({ tenantId: source.s.tenantId, sessionId: source.s._id, plantId }, options(session));
      if (existing) fail(409, 'F5A_PERMIT_EXISTS');
      const registered = await c('permits').find({ tenantId: source.s.tenantId }, options(session)).limit(maxPermitsPerTenant + 1).toArray();
      if (registered.length >= maxPermitsPerTenant) fail(409, 'F5A_PERMIT_CAPACITY');
      for (const row of registered) await readPermit(row._id, source.s.tenantId, session);
      const binding = { _id: randomUUID(), tenantId: source.s.tenantId, sessionId: source.s._id, userId: source.s.userId,
        membershipId: source.m._id, membershipVersion: source.m.version, plantId, legalEntityId: source.entity._id,
        policyHash, rolesHash: source.rolesHash, scopeHash: source.scopeHash, actions: [...actions], issuedAt: instant(),
        expiresAt: new Date(Math.min(source.s.expiresAt.getTime(), instant().getTime() + ttlMs)) };
      const origin = { _id: binding._id, tenantId: binding.tenantId, binding }; origin.contentHash = prototypeHash(origin);
      await c('origins').insertOne(origin, options(session));
      const head = await append(null, { ...binding, originHash: origin.contentHash, generation: 1, active: true, uses: 0 }, 'ISSUED', session);
      const result = { permitId: head._id, generation: head.generation, version: head.version };
      await c('issueKeys').insertOne({ _id: randomUUID(), tenantId: head.tenantId, key: commandKey, payloadHash, result }, options(session));
      return result;
    },
    async renewPermit(scope, { permitId, ttlMs, commandKey }, { session }) {
      key(commandKey); ttl(ttlMs);
      const existing = await readPermit(permitId, scope.tenantId, session);
      const source = await authority(scope, existing.plantId, existing.actions, session, 'renew');
      for (const action of existing.actions) matchesSource(existing, source, action);
      await registrationFence(source, session);
      const payloadHash = prototypeHash({ kind: 'RENEW', permitId, ttlMs });
      const prior = await c('issueKeys').findOne({ tenantId: scope.tenantId, key: commandKey }, options(session));
      if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT'); return prior.result; }
      const expiresAt = new Date(Math.min(source.s.expiresAt.getTime(), instant().getTime() + ttlMs));
      if (expiresAt <= existing.expiresAt) fail(409, 'F5A_PERMIT_EXPIRY_CONFLICT');
      const head = await append(existing, { ...semantic(existing), expiresAt }, 'RENEWED', session);
      const result = { permitId: head._id, generation: head.generation, version: head.version };
      await c('issueKeys').insertOne({ _id: randomUUID(), tenantId: head.tenantId, key: commandKey, payloadHash, result }, options(session));
      return result;
    },
    async authorizeInTransaction(scope, { plantId, action }, { session }) {
      const source = await authority(scope, plantId, [action], session, 'authorize');
      const actual = await c('permits').findOne({ tenantId: source.s.tenantId, sessionId: source.s._id, plantId }, options(session));
      if (!actual) deny();
      const previous = await readPermit(actual._id, source.s.tenantId, session);
      matchesSource(previous, source, action);
      // Candidate intentionally writes the permit only; source state is read-only here.
      const head = await append(previous, { ...semantic(previous), uses: previous.uses + 1 }, 'USED', session);
      await hooks.afterPermitWrite?.({ phase: 'authorize', session });
      return { tenantId: source.s.tenantId, plantId, legalEntityId: source.entity._id, userId: source.s.userId,
        sessionId: source.s._id, permitId: head._id, permitVersion: head.version, prototype: true };
    },
    async command(scope, { plantId, action, commandKey, payload }, { session }) {
      key(commandKey);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || Buffer.byteLength(JSON.stringify(payload), 'utf8') > 4096) fail(400, 'INVALID_PROTOTYPE_PAYLOAD');
      const grant = await api.authorizeInTransaction(scope, { plantId, action }, { session });
      const payloadHash = prototypeHash({ plantId, action, payload }), prior = await c('commandKeys').findOne({ tenantId: grant.tenantId, key: commandKey }, options(session));
      if (prior) {
        const effect = prior.result && await c('effects').findOne({ _id: prior.result._id, tenantId: grant.tenantId }, options(session));
        const audit = await c('audit').findOne({ tenantId: grant.tenantId, key: commandKey }, options(session));
        const outbox = await c('outbox').findOne({ tenantId: grant.tenantId, key: commandKey }, options(session));
        if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT');
        if (!effect || !audit || !outbox || effect.key !== commandKey || effect.payloadHash !== payloadHash || effect.plantId !== plantId || effect.action !== action || effect.userId !== grant.userId || effect.sessionId !== grant.sessionId || effect.permitId !== grant.permitId
          || prototypeHash(hashless(effect)) !== effect.contentHash || prototypeHash(prior.result) !== prototypeHash(effect)
          || audit.effectHash !== effect.contentHash || outbox.effectHash !== effect.contentHash) invalid();
        return effect;
      }
      const effect = { _id: randomUUID(), tenantId: grant.tenantId, plantId, sessionId: grant.sessionId,
        userId: grant.userId, permitId: grant.permitId, key: commandKey, action, payloadHash, payload, recordedAt: instant() };
      effect.contentHash = prototypeHash(effect);
      await c('effects').insertOne(effect, options(session));
      const metadata = { tenantId: grant.tenantId, key: commandKey, effectId: effect._id, effectHash: effect.contentHash };
      await c('audit').insertOne({ _id: randomUUID(), ...metadata }, options(session));
      await c('outbox').insertOne({ _id: randomUUID(), ...metadata, state: 'PENDING' }, options(session));
      await c('commandKeys').insertOne({ _id: randomUUID(), tenantId: grant.tenantId, key: commandKey, payloadHash, result: effect }, options(session));
      return effect;
    },
    async withdrawMembership({ tenantId, membershipId }, { session }) {
      transaction(session);
      const all = await c('permits').find({ tenantId }, options(session)).limit(maxPermitsPerTenant + 1).toArray();
      if (all.length > maxPermitsPerTenant) fail(409, 'F5A_PERMIT_CAPACITY');
      const membership = await db.collection('memberships').findOne({ _id: membershipId, tenantId, active: true }, options(session));
      if (!membership) deny();
      const changed = await db.collection('memberships').updateOne({ _id: membershipId, tenantId, active: true, version: membership.version },
        { $set: { active: false }, $inc: { version: 1 } }, options(session));
      if (changed.matchedCount !== 1) deny();
      const affected = [];
      for (const row of all) {
        const current = await readPermit(row._id, tenantId, session);
        if (current.membershipId === membershipId && current.active) {
          const head = await append(current, { ...semantic(current), active: false, generation: current.generation + 1 }, 'REVOKED', session);
          affected.push(head._id);
        }
      }
      return { membershipId, permits: affected };
    },
    inspectPermit: readPermit,
  };
  return Object.freeze(api);
}
