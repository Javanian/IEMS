import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createPermitPrototype, prototypeCollections as collections, prototypeHash } from './permit-prototype.mjs';

const source = process.env.IEMS_F5_SOURCE_ROOT
  ? resolve(process.env.IEMS_F5_SOURCE_ROOT)
  : fileURLToPath(new URL('../../../', import.meta.url));
const { startOwned } = await import(pathToFileURL(join(source, 'apps/portfolio-api/test/support/owned-mongo.mjs')).href);
const { roleActions } = await import(pathToFileURL(join(source, 'apps/portfolio-api/src/commercial.mjs')).href);
const transactionOptions = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' };
const key = () => randomUUID();
const deferred = () => { let resolvePromise; return { promise: new Promise(resolve => { resolvePromise = resolve; }), resolve: (...args) => resolvePromise(...args) }; };
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Owned prototype barrier timed out')), 15000); })]); }
  finally { clearTimeout(timer); }
}
const isConflict = error => error?.code === 112 || error?.codeName === 'WriteConflict';
const errorCode = code => error => error?.code === code;
async function snapshot(h) {
  const result = {};
  for (const { name } of (await h.db.listCollections().toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    result[name] = await h.db.collection(name).find().sort({ _id: 1 }).toArray();
  }
  return result;
}
async function atomic(h, effect) {
  const session = h.client.startSession();
  try { return await session.withTransaction(() => effect(session), transactionOptions); }
  finally { await session.endSession(); }
}
async function officialActor(h, prototype, tenant = h.seeded[0]) {
  const foundation = h.runtime.foundation;
  const userId = randomUUID(), membershipId = randomUUID();
  const plant = await h.db.collection('plants').findOne({ _id: tenant.plantId });
  await foundation.provisionUser({ id: userId, tenantId: tenant.tenantId });
  await foundation.provisionMembership({ id: membershipId, tenantId: tenant.tenantId, userId,
    legalEntityIds: [plant.legalEntityId], plantIds: [tenant.plantId], roles: [{ role: 'owner', plantIds: [tenant.plantId] }] });
  const issued = await foundation.issueSession({ userId, tenantId: tenant.tenantId, selectedPlantId: tenant.plantId, ttlMs: 3600000 });
  const scope = await prototype.authenticate(issued.token);
  return { ...issued, scope, userId, membershipId, tenantId: tenant.tenantId, plantId: tenant.plantId,
    legalEntityId: plant.legalEntityId, cookie: `portfolio_session=${issued.token}` };
}
async function issue(h, prototype, actor, ttlMs = 60000) {
  return atomic(h, session => prototype.issuePermit(actor.scope,
    { plantId: actor.plantId, actions: ['crm.write'], ttlMs, commandKey: key() }, { session }));
}
const command = (prototype, actor, commandKey = key(), payload = { label: 'Actual isolated effect' }) => session => prototype.command(actor.scope,
  { plantId: actor.plantId, action: 'crm.write', commandKey, payload }, { session });
async function authorityRows(h, actor) {
  const rows = {};
  for (const [name, id] of [['sessions', actor.sessionId], ['memberships', actor.membershipId], ['users', actor.userId],
    ['tenants', actor.tenantId], ['plants', actor.plantId], ['legalEntities', actor.legalEntityId]]) {
    rows[name] = await h.db.collection(name).findOne({ _id: id });
  }
  return rows;
}

// These tests exercise an unadopted candidate. Expected stale-authorized commits reject it.
test('owner F5-A isolated permit experiment preserves the reference oracle and classifies rejection', async t => {
  const h = await startOwned(t);
  const policy = structuredClone(roleActions);
  let ownedTime = null, readHook = null, writeHook = null;
  const prototype = createPermitPrototype({ db: h.db, foundation: h.runtime.foundation, roleActions: policy,
    maxPermitsPerTenant: 32, now: () => new Date(ownedTime ?? Date.now()), hooks: {
      afterAuthorityRead: event => readHook?.(event), afterPermitWrite: event => writeHook?.(event),
    } });
  await prototype.initialize();

  await t.test('actual issuance fences all six sources; ordinary command and replay write only isolated permit/effect state', async () => {
    const actor = await officialActor(h, prototype), beforeIssue = await authorityRows(h, actor);
    const permit = await issue(h, prototype, actor), afterIssue = await authorityRows(h, actor);
    for (const name of Object.keys(beforeIssue)) {
      assert.equal(afterIssue[name].f5aPermitRegistrationFence, (beforeIssue[name].f5aPermitRegistrationFence || 0) + 1, name);
      const { f5aPermitRegistrationFence: ignoredBefore, ...oldRow } = beforeIssue[name];
      const { f5aPermitRegistrationFence: ignoredAfter, ...newRow } = afterIssue[name];
      assert.deepEqual(newRow, oldRow, name);
    }
    const commandKey = key(), effect = await atomic(h, command(prototype, actor, commandKey));
    const replay = await atomic(h, command(prototype, actor, commandKey));
    assert.deepEqual(replay, effect);
    assert.deepEqual(await authorityRows(h, actor), afterIssue);
    for (const name of ['effects', 'commandKeys', 'audit', 'outbox']) {
      assert.equal(await h.db.collection(collections[name]).countDocuments({ tenantId: actor.tenantId, key: commandKey }), 1, name);
    }
    const head = await atomic(h, session => prototype.inspectPermit(permit.permitId, actor.tenantId, session));
    assert.equal(head.uses, 2); assert.equal(head.version, 3);
  });

  await t.test('candidate commits after actual same-plant role withdrawal: deterministic rejection counterexample', async () => {
    const actor = await officialActor(h, prototype); await issue(h, prototype, actor);
    const original = await h.db.collection('memberships').findOne({ _id: actor.membershipId });
    const entered = deferred(), resume = deferred();
    readHook = async ({ phase }) => { if (phase === 'authorize') { entered.resolve(); await bounded(resume.promise); } };
    const session = h.client.startSession(); session.startTransaction(transactionOptions);
    const commandKey = key(), pending = command(prototype, actor, commandKey)(session);
    try {
      await bounded(entered.promise);
      await atomic(h, other => h.db.collection('memberships').updateOne({ _id: actor.membershipId }, { $set: { roles: [] } }, { session: other }));
      assert.equal((await h.db.collection('memberships').findOne({ _id: actor.membershipId })).version, original.version);
      resume.resolve(); const effect = await bounded(pending); await session.commitTransaction();
      assert.deepEqual((await h.db.collection('memberships').findOne({ _id: actor.membershipId })).roles, []);
      assert.deepEqual(await h.db.collection(collections.effects).findOne({ _id: effect._id }), effect);
      assert.equal(await h.db.collection(collections.commandKeys).countDocuments({ key: commandKey }), 1);
      t.diagnostic('REJECTED: candidate effect committed after direct authoritative role withdrawal without a membership-version increment');
    } finally {
      resume.resolve(); await pending.catch(() => {}); readHook = null;
      if (session.inTransaction()) await session.abortTransaction(); await session.endSession();
      await h.db.collection('memberships').updateOne({ _id: actor.membershipId }, { $set: { roles: original.roles } });
    }
  });

  await t.test('actual foundation same-plant stale snapshot conflicts on membership and rolls back every write', async () => {
    const actor = await officialActor(h, prototype);
    const original = await h.db.collection('memberships').findOne({ _id: actor.membershipId });
    const session = h.client.startSession(); session.startTransaction(transactionOptions);
    try {
      await h.db.collection('memberships').findOne({ _id: actor.membershipId }, { session });
      await atomic(h, other => h.db.collection('memberships').updateOne({ _id: actor.membershipId }, { $set: { roles: [] } }, { session: other }));
      const before = await snapshot(h);
      await assert.rejects(h.runtime.foundation.authorizeInTransaction(actor.scope,
        { plantId: actor.plantId, action: 'crm.write' }, { session }), isConflict);
      if (session.inTransaction()) await session.abortTransaction();
      assert.deepEqual(await snapshot(h), before);
    } finally {
      if (session.inTransaction()) await session.abortTransaction(); await session.endSession();
      await h.db.collection('memberships').updateOne({ _id: actor.membershipId }, { $set: { roles: original.roles } });
    }
  });

  await t.test('official session revoke is observed before verification; candidate 403 differs from actual portfolio HTTP 401', async () => {
    const actor = await officialActor(h, prototype); await issue(h, prototype, actor);
    const commandKey = key(); await atomic(h, command(prototype, actor, commandKey));
    await h.runtime.foundation.revokeSession({ tenantId: actor.tenantId, sessionId: actor.sessionId });
    const before = await snapshot(h);
    for (const nextKey of [key(), commandKey]) {
      await assert.rejects(atomic(h, command(prototype, actor, nextKey)), error => error.status === 403 && error.code === 'SCOPE_DENIED');
      assert.deepEqual(await snapshot(h), before);
    }
    const response = await h.req('/crm/accounts', { name: 'Must not create after actual session revoke' }, actor.cookie);
    assert.equal(response.status, 401); assert.equal(response.error.code, 'UNAUTHENTICATED');
    assert.deepEqual(await snapshot(h), before);
    t.diagnostic('REJECTED for portfolio adoption: candidate 403 is not the required HTTP 401 session contract');
  });

  await t.test('narrow atomic membership withdrawal causes real permit conflict, callback retry rechecks authority, no stale effect', async () => {
    const actor = await officialActor(h, prototype), permit = await issue(h, prototype, actor);
    const entered = deferred(), resume = deferred(); let first = true, callbacks = 0;
    readHook = async ({ phase }) => { if (phase === 'authorize' && first) { first = false; entered.resolve(); await bounded(resume.promise); } };
    const commandKey = key(), session = h.client.startSession();
    const pending = session.withTransaction(() => { callbacks += 1; return command(prototype, actor, commandKey)(session); }, transactionOptions);
    try {
      await bounded(entered.promise);
      const revoked = await atomic(h, other => prototype.withdrawMembership({ tenantId: actor.tenantId, membershipId: actor.membershipId }, { session: other }));
      assert.deepEqual(revoked.permits, [permit.permitId]);
      const afterWithdrawal = await snapshot(h);
      resume.resolve(); await assert.rejects(bounded(pending), errorCode('SCOPE_DENIED'));
      assert.ok(callbacks >= 2, `Actual driver callback retry count ${callbacks}`);
      assert.deepEqual(await snapshot(h), afterWithdrawal);
      assert.equal(await h.db.collection(collections.effects).countDocuments({ key: commandKey }), 0);
    } finally {
      resume.resolve(); await pending.catch(() => {}); readHook = null;
      if (session.inTransaction()) await session.abortTransaction(); await session.endSession();
    }
  });

  await t.test('failed actual outbox insert rolls back permit, effect, key and audit; clean retry commits once', async () => {
    const actor = await officialActor(h, prototype); await issue(h, prototype, actor);
    const commandKey = key(), before = await snapshot(h);
    const options = (await h.db.listCollections({ name: collections.outbox }).next()).options || {};
    await h.db.command({ collMod: collections.outbox, validator: { _id: { $exists: false } }, validationLevel: 'strict', validationAction: 'error' });
    try {
      await assert.rejects(atomic(h, command(prototype, actor, commandKey)), error => error.code === 121);
      assert.deepEqual(await snapshot(h), before);
    } finally {
      await h.db.command({ collMod: collections.outbox, validator: options.validator || {},
        validationLevel: options.validationLevel || 'strict', validationAction: options.validationAction || 'error' });
    }
    const result = await atomic(h, command(prototype, actor, commandKey));
    assert.equal(await h.db.collection(collections.effects).countDocuments({ _id: result._id }), 1);
    assert.deepEqual(await atomic(h, command(prototype, actor, commandKey)), result);
  });

  await t.test('current source/permit corruption and policy drift reject without effects', async () => {
    const actor = await officialActor(h, prototype), permit = await issue(h, prototype, actor);
    const original = await h.db.collection(collections.permits).findOne({ _id: permit.permitId });
    await h.db.collection(collections.permits).updateOne({ _id: permit.permitId }, { $set: { generation: 2 } });
    try {
      const before = await snapshot(h);
      await assert.rejects(atomic(h, command(prototype, actor)), errorCode('F5A_PERMIT_SOURCE_INVALID'));
      assert.deepEqual(await snapshot(h), before);
    } finally { await h.db.collection(collections.permits).replaceOne({ _id: permit.permitId }, original); }
    const beforePolicy = await snapshot(h), old = [...policy.owner];
    policy.owner = policy.owner.filter(action => action !== 'crm.write');
    try {
      await assert.rejects(atomic(h, command(prototype, actor)), errorCode('F5A_POLICY_CHANGED'));
      assert.deepEqual(await snapshot(h), beforePolicy);
    } finally { policy.owner = old; }
  });

  await t.test('genuine renewal extends unexpired permit; constructor-only expiry denies fresh and replay', async () => {
    const actor = await officialActor(h, prototype); ownedTime = Date.now();
    try {
      const permit = await issue(h, prototype, actor, 1000), commandKey = key();
      await atomic(h, command(prototype, actor, commandKey));
      ownedTime += 100;
      const renewed = await atomic(h, session => prototype.renewPermit(actor.scope,
        { permitId: permit.permitId, ttlMs: 2000, commandKey: key() }, { session }));
      assert.equal(renewed.version, 3);
      const head = await atomic(h, session => prototype.inspectPermit(permit.permitId, actor.tenantId, session));
      assert.equal(head.expiresAt.getTime(), ownedTime + 2000);
      ownedTime += 3000; const before = await snapshot(h);
      for (const nextKey of [key(), commandKey]) {
        await assert.rejects(atomic(h, command(prototype, actor, nextKey)), errorCode('SCOPE_DENIED'));
        assert.deepEqual(await snapshot(h), before);
      }
      await assert.rejects(atomic(h, session => prototype.renewPermit(actor.scope,
        { permitId: permit.permitId, ttlMs: 4000, commandKey: key() }, { session })), errorCode('SCOPE_DENIED'));
      assert.deepEqual(await snapshot(h), before);
    } finally { ownedTime = null; }
  });

  await t.test('tenant retained budget includes revoked permits and registration does not mint a third permit', async () => {
    const limited = createPermitPrototype({ db: h.db, foundation: h.runtime.foundation,
      roleActions: policy, maxPermitsPerTenant: 2 });
    const one = await officialActor(h, limited, h.seeded[1]), two = await officialActor(h, limited, h.seeded[1]);
    await issue(h, limited, one); await issue(h, limited, two);
    await atomic(h, session => limited.withdrawMembership({ tenantId: one.tenantId, membershipId: one.membershipId }, { session }));
    assert.equal(await h.db.collection(collections.permits).countDocuments({ tenantId: one.tenantId }), 2);
    assert.equal(await h.db.collection(collections.permits).countDocuments({ tenantId: one.tenantId, active: false }), 1);
    const three = await officialActor(h, limited, h.seeded[1]), before = await snapshot(h);
    await assert.rejects(issue(h, limited, three), errorCode('F5A_PERMIT_CAPACITY'));
    assert.deepEqual(await snapshot(h), before);
  });

  await t.test('private scope identity cannot be replaced by a caller object or foreign requested plant', async () => {
    const actor = await officialActor(h, prototype); await issue(h, prototype, actor);
    const before = await snapshot(h), body = { plantId: actor.plantId, action: 'crm.write', commandKey: key(), payload: { note: 'Denied' } };
    await assert.rejects(atomic(h, session => prototype.command({ ...actor.scope }, body, { session })), errorCode('SCOPE_DENIED'));
    await assert.rejects(atomic(h, session => prototype.command(actor.scope, { ...body, plantId: h.seeded[1].plantId }, { session })), errorCode('SCOPE_DENIED'));
    assert.deepEqual(await snapshot(h), before);
    t.diagnostic(`Prototype source root ${source}; policy hash ${prototypeHash(policy)}; no production guard was replaced`);
  });
});
