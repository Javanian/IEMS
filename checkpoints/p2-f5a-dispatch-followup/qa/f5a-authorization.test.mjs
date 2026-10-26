import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startOwned, sourceRoot, roles, action, command, otherConnection, atomic, latch, bounded, intercept, snapshot, noWrites, fault, principal, writeAuthority, itemHTTP, onlyChangedMembership, prototypeFixture } from './f5a-support.mjs';

const prototypeURL = process.env.IEMS_F5_CANDIDATE ? pathToFileURL(resolve(process.env.IEMS_F5_CANDIDATE)) : new URL('../f5a/permit-prototype.mjs', import.meta.url);
const evidenceDirectory = resolve(process.env.IEMS_F5_EVIDENCE || process.env.IEMS_QA_EVIDENCE || (() => { throw Error('IEMS_F5_EVIDENCE or IEMS_QA_EVIDENCE is required before any owned runtime starts'); })());
const reportPath = resolve(evidenceDirectory, 'independent-f5a-results.json');
try { await access(reportPath); throw Error('Refusing to overwrite an earlier independent F5-A report'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const expectedPrototypeHash = '75a42712d2d385c9d7c046fabb217528500b21214c0fa84ba18e81afb3106553';
const prototypeBytes = await readFile(prototypeURL);
assert.equal(createHash('sha256').update(prototypeBytes).digest('hex'), expectedPrototypeHash, 'Candidate source changed after independent review');
const { createPermitPrototype, prototypeCollections: C } = await import(prototypeURL);
const proof = [], effect = () => ({ amount: '1', purpose: 'Isolated authorization proof; not a stock or financial integration command' });
const request = f => ({ plantId: f.who.plantId, action, commandKey: randomUUID(), payload: effect() });
const runCommand = (h, f, body, client = h.client) => atomic(client, session => f.candidate.command(f.scope, body, { session }));

async function caseOf(t, name, effect) {
  await t.test(name, async () => {
    const row = { name, startedUTC: new Date().toISOString() }; proof.push(row);
    try { await effect(row); row.status = 'PASS'; }
    catch (error) { row.status = 'FAIL'; row.error = { name: error.name, code: error.code, message: error.message }; throw error; }
    finally { row.finishedUTC = new Date().toISOString(); }
  });
}

async function barrierBeforeHTTPResponse(barrier, actor, row, label) {
  let reached = false;
  await bounded(Promise.race([
    barrier.arrived.then(value => { reached = true; return value; }),
    actor.then(response => {
      if (reached) return;
      row.earlyHTTPResponse = { status: response.status, errorCode: response.error?.code || null };
      throw Error(`HTTP completed before ${label}: ${response.status} ${response.error?.code || ''}`);
    }, error => {
      if (reached) return;
      row.earlyHTTPResponse = { errorName: error.name, errorCode: error.code || null };
      throw error;
    }),
  ]), label);
}

test('independent actual guard controls and isolated permit verdict', { timeout: 300000 }, async t => {
  const h = await startOwned(t), other = await otherConnection(h);
  let rejectedCounterexample = false, portfolioSessionMismatch = false;
  try {
    await caseOf(t, 'actual foundation stale-role snapshot conflicts and denies without membership-version change', async row => {
      const who = await principal(h), events = [], barrier = latch('foundation-after-authority-reads-before-first-fence', events), attempts = [], conflicts = [];
      const original = await h.db.collection('memberships').findOne({ _id: who.membershipId }), before = await snapshot(h.db);
      let armed = true;
      const restore = intercept(h.db, (name, method, args) => armed && name === 'sessions' && method === 'updateOne' && args[1]?.$inc?.authorizationFence === 1, async ({ acknowledgedWrite }) => { armed = false; await barrier.pause({ acknowledgedWrite, snapshotEstablishedBy: 'actual foundation verification reads' }); }, { conflicts });
      const actor = atomic(h.client, async session => {
        await h.runtime.foundation.authorizeInTransaction(who.scope, { tenantId: who.tenantId, plantId: who.plantId, action }, { session });
        await h.db.collection('f5aIndependentEffects').insertOne({ _id: randomUUID(), label: 'must-not-commit' }, { session });
      }, attempts); actor.catch(() => {});
      try {
        await bounded(barrier.arrived, 'foundation reads reached');
        await writeAuthority(other.db, other.client, who, {}, events);
        assert.equal((await other.db.collection('memberships').findOne({ _id: who.membershipId })).version, original.version);
        barrier.release();
        await assert.rejects(actor, error => error.status === 403 && error.code === 'SCOPE_DENIED');
        assert.ok(attempts.length >= 2); assert.ok(conflicts.some(value => value.code === 112));
        onlyChangedMembership(before, await snapshot(h.db), who);
        row.events = events; row.callbackAttempts = attempts.length; row.actualWriteConflicts = conflicts;
      } finally { barrier.release(); await actor.catch(() => {}); restore(); await h.db.collection('memberships').replaceOne({ _id: original._id }, original); }
    });

    await caseOf(t, 'actual portfolio HTTP stale-role snapshot conflicts after acknowledged session fence and denies403', async row => {
      const who = await principal(h), body = command(), events = [], barrier = latch('portfolio-after-actual-session-fence', events), conflicts = [];
      const controlBody = command(), control = await itemHTTP(h, who, controlBody);
      assert.equal(control.status, 201);
      row.validHTTPControl = { status: control.status, itemId: control.data._id, code: controlBody.code, idempotencyKey: controlBody.idempotencyKey };
      row.request = { code: body.code, idempotencyKey: body.idempotencyKey };
      const original = await h.db.collection('memberships').findOne({ _id: who.membershipId }), before = await snapshot(h.db);
      let armed = true, acknowledgedWrites = 0;
      const restore = intercept(h.db, (name, method, args) => name === 'sessions' && method === 'findOneAndUpdate' && args[0]?.tokenHash === createHash('sha256').update(who.token).digest('hex') && args[1]?.$inc?.crmFence === 1, async ({ result, acknowledgedWrite }) => {
        acknowledgedWrites++; if (!armed) return; armed = false;
        assert.equal(acknowledgedWrite, true); assert.equal(result._id, who.sessionId);
        await barrier.pause({ acknowledgedWrite: true, sessionId: result._id, snapshotEstablishedBy: 'actual session findOneAndUpdate completed before membership write' });
      }, { after: true, conflicts });
      const actor = itemHTTP(h, who, body); actor.catch(() => {});
      try {
        await barrierBeforeHTTPResponse(barrier, actor, row, 'portfolio session write reached');
        await writeAuthority(other.db, other.client, who, {}, events);
        barrier.release(); const result = await actor;
        assert.equal(result.status, 403); assert.equal(result.error.code, 'SCOPE_DENIED');
        assert.ok(acknowledgedWrites >= 2); assert.ok(conflicts.some(value => value.name === 'memberships' && value.code === 112));
        onlyChangedMembership(before, await snapshot(h.db), who);
        row.events = events; row.acknowledgedSessionWrites = acknowledgedWrites; row.actualWriteConflicts = conflicts;
      } finally { barrier.release(); await actor.catch(() => {}); restore(); await h.db.collection('memberships').replaceOne({ _id: original._id }, original); }
    });

    await caseOf(t, 'isolated candidate commits after direct-role revoke: preserved-contract counterexample REJECTED', async row => {
      const events = [], barrier = latch('candidate-live-authority-read-before-permit-only-CAS', events);
      let armed = false;
      const f = await prototypeFixture(h, createPermitPrototype, { hooks: { afterAuthorityRead: async ({ phase }) => { if (armed && phase === 'authorize') { armed = false; await barrier.pause({ phase }); } } } });
      const original = await h.db.collection('memberships').findOne({ _id: f.who.membershipId }), before = await snapshot(h.db), body = request(f);
      armed = true;
      const actor = runCommand(h, f, body); actor.catch(() => {});
      try {
        await bounded(barrier.arrived, 'candidate authority read');
        await writeAuthority(other.db, other.client, f.who, {}, events);
        const revoked = await other.db.collection('memberships').findOne({ _id: f.who.membershipId });
        assert.equal(revoked.version, original.version); assert.deepEqual(revoked.roles, []);
        barrier.release(); const committed = await actor;
        assert.equal(committed.key, body.commandKey);
        for (const name of [C.effects, C.commandKeys, C.audit, C.outbox]) assert.equal(await h.db.collection(name).countDocuments({ tenantId: f.who.tenantId, key: body.commandKey }), 1);
        const after = await snapshot(h.db);
        for (const name of ['sessions', 'users', 'tenants', 'plants', 'legalEntities']) assert.deepEqual(after[name], before[name], 'Candidate unexpectedly wrote a production authority fence');
        assert.deepEqual(after.memberships, before.memberships.map(value => value._id === original._id ? { ...value, roles: [] } : value));
        await noWrites(h, () => runCommand(h, f, body), 403, 'SCOPE_DENIED');
        rejectedCounterexample = true;
        row.verdict = 'REJECTED'; row.events = events; row.committedEffectId = committed._id;
        row.reason = 'A permit-only write does not conflict with the preserved direct-role writer; actual guard controls above deny the equivalent stale snapshot.';
      } finally { barrier.release(); await actor.catch(() => {}); await h.db.collection('memberships').replaceOne({ _id: original._id }, original); }
    });

    await caseOf(t, 'actual foundation mutation-first commit precedes revoke; later authorization is denied', async row => {
      const who = await principal(h), events = [], barrier = latch('foundation-pending-effect-before-commit', events), attempts = [];
      const original = await h.db.collection('memberships').findOne({ _id: who.membershipId }), key = randomUUID();
      const actor = atomic(h.client, async session => {
        await h.runtime.foundation.authorizeInTransaction(who.scope, { plantId: who.plantId, action }, { session });
        for (const name of ['f5aIndependentEffects', 'f5aIndependentKeys', 'f5aIndependentOutbox']) await h.db.collection(name).insertOne({ _id: randomUUID(), key, tenantId: who.tenantId }, { session });
        await barrier.pause({ actualAuthorityAndEffectsWritten: true });
      }); actor.then(() => events.push({ event: 'actor-commit', utc: new Date().toISOString() })).catch(() => {});
      let revoker, listener;
      const started = new Promise(resolve => {
        listener = event => { if (event.commandName === 'update' && event.command.update === 'memberships' && event.command.updates?.some(value => value.q._id === who.membershipId)) { other.client.off('commandStarted', listener); resolve(); } };
        other.client.on('commandStarted', listener);
      });
      try {
        await bounded(barrier.arrived, 'actual mutation pending');
        revoker = atomic(other.client, session => other.db.collection('memberships').updateOne({ _id: who.membershipId }, { $set: { roles: [] } }, { session }), attempts).then(() => events.push({ event: 'revoke-commit', utc: new Date().toISOString() })); revoker.catch(() => {});
        await bounded(started, 'actual revoke write issued'); barrier.release(); await actor; await revoker;
        assert.ok(events.findIndex(value => value.event === 'actor-commit') < events.findIndex(value => value.event === 'revoke-commit'));
        for (const name of ['f5aIndependentEffects', 'f5aIndependentKeys', 'f5aIndependentOutbox']) assert.equal(await h.db.collection(name).countDocuments({ key }), 1);
        await noWrites(h, () => atomic(h.client, session => h.runtime.foundation.authorizeInTransaction(who.scope, { plantId: who.plantId, action }, { session })), 403, 'SCOPE_DENIED');
        row.events = events; row.revokerCallbackAttempts = attempts.length; row.effectKind = 'isolated authorization effect, not stock integration';
      } finally { barrier.release(); await actor.catch(() => {}); await revoker?.catch(() => {}); other.client.off('commandStarted', listener); await h.db.collection('memberships').replaceOne({ _id: original._id }, original); }
    });

    await caseOf(t, 'actual portfolio HTTP mutation-first stores one item/key/outbox and revoked exact replay remains denied', async row => {
      const who = await principal(h), body = command(), events = [], barrier = latch('portfolio-pending-actual-outbox-before-commit', events);
      row.request = { code: body.code, idempotencyKey: body.idempotencyKey };
      const original = await h.db.collection('memberships').findOne({ _id: who.membershipId }); let armed = true;
      const restore = intercept(h.db, (name, method, args) => armed && name === 'internalPlanningOutbox' && method === 'insertOne' && args[0]?.tenantId === who.tenantId, async ({ acknowledgedWrite }) => { armed = false; await barrier.pause({ acknowledgedWrite, actualOutboxInserted: true }); }, { after: true });
      const actor = itemHTTP(h, who, body); actor.then(() => events.push({ event: 'actor-response', utc: new Date().toISOString() })).catch(() => {});
      let revoker, listener;
      const started = new Promise(resolve => { listener = event => { if (event.commandName === 'update' && event.command.update === 'memberships' && event.command.updates?.some(value => value.q._id === who.membershipId)) { other.client.off('commandStarted', listener); resolve(); } }; other.client.on('commandStarted', listener); });
      try {
        await barrierBeforeHTTPResponse(barrier, actor, row, 'actual guarded outbox inserted');
        revoker = atomic(other.client, session => other.db.collection('memberships').updateOne({ _id: who.membershipId }, { $set: { roles: [] } }, { session })).then(() => events.push({ event: 'revoke-commit', utc: new Date().toISOString() })); revoker.catch(() => {});
        await bounded(started, 'revoke membership write started'); barrier.release();
        const response = await actor; assert.equal(response.status, 201); await revoker;
        assert.equal(await h.db.collection('inventoryItems').countDocuments({ tenantId: who.tenantId, code: body.code }), 1);
        assert.equal(await h.db.collection('internalPlanningKeys').countDocuments({ tenantId: who.tenantId, key: body.idempotencyKey }), 1);
        assert.equal(await h.db.collection('internalPlanningOutbox').countDocuments({ tenantId: who.tenantId }), 1);
        const before = await snapshot(h.db), replayed = await itemHTTP(h, who, body);
        assert.equal(replayed.status, 403); assert.equal(replayed.error.code, 'SCOPE_DENIED'); assert.deepEqual(await snapshot(h.db), before);
        row.events = events; row.actualItemId = response.data._id; row.revokedReplayStatus = 403;
      } finally { barrier.release(); await actor.catch(() => {}); await revoker?.catch(() => {}); other.client.off('commandStarted', listener); restore(); await h.db.collection('memberships').replaceOne({ _id: original._id }, original); }
    });

    await caseOf(t, 'candidate mutation-first permit write serializes official withdrawal and replay is then refused', async row => {
      const events = [], barrier = latch('candidate-pending-permit-write-before-command-effect', events); let armed = false;
      const f = await prototypeFixture(h, createPermitPrototype, { hooks: { afterPermitWrite: async () => { if (armed) { armed = false; await barrier.pause({ actualPermitWrite: true }); } } } });
      const peer = createPermitPrototype({ db: other.db, foundation: h.runtime.foundation, roleActions: f.policy, now: () => new Date(f.clock.value) });
      const body = request(f); armed = true;
      const actor = runCommand(h, f, body); actor.then(() => events.push({ event: 'actor-commit', utc: new Date().toISOString() })).catch(() => {});
      let revoker, listener;
      const started = new Promise(resolve => { listener = event => { if (event.commandName === 'update' && event.command.update === C.permits && event.command.updates?.some(value => value.q._id === f.issued.permitId && value.u.active === false)) { other.client.off('commandStarted', listener); resolve(); } }; other.client.on('commandStarted', listener); });
      try {
        await bounded(barrier.arrived, 'candidate actual permit append');
        revoker = atomic(other.client, session => peer.withdrawMembership({ tenantId: f.who.tenantId, membershipId: f.who.membershipId }, { session })).then(result => { events.push({ event: 'revoke-commit', utc: new Date().toISOString() }); return result; }); revoker.catch(() => {});
        await bounded(started, 'official revoker actual permit CAS'); barrier.release(); await actor; await revoker;
        assert.ok(events.findIndex(value => value.event === 'actor-commit') < events.findIndex(value => value.event === 'revoke-commit'));
        assert.equal(await h.db.collection(C.effects).countDocuments({ key: body.commandKey }), 1);
        await noWrites(h, () => runCommand(h, f, body), 403, 'SCOPE_DENIED');
        row.events = events; row.scope = 'Official isolated withdrawal only; arbitrary production revokers remain outside this successful serialization';
      } finally { barrier.release(); await actor.catch(() => {}); await revoker?.catch(() => {}); other.client.off('commandStarted', listener); }
    });

    const faults = [
      ['session revoked', 'sessions', f => f.who.sessionId, row => ({ revoked: true }), 401],
      ['session expired', 'sessions', f => f.who.sessionId, row => ({ expiresAt: new Date(0) }), 401],
      ['membership inactive', 'memberships', f => f.who.membershipId, row => ({ active: false }), 401],
      ['direct role removed without version', 'memberships', f => f.who.membershipId, row => ({ roles: [] }), 403],
      ['role grant plant scope removed', 'memberships', f => f.who.membershipId, row => ({ roles: row.roles.map(value => ({ ...value, plantIds: [] })) }), 403],
      ['membership plant scope removed', 'memberships', f => f.who.membershipId, row => ({ plantIds: [] }), 401],
      ['membership legal entity scope removed', 'memberships', f => f.who.membershipId, row => ({ legalEntityIds: [] }), 401],
      ['user inactive', 'users', f => f.who.userId, row => ({ active: false }), 401],
      ['tenant inactive', 'tenants', f => f.who.tenantId, row => ({ active: false }), 401],
      ['plant inactive', 'plants', f => f.who.plantId, row => ({ active: false }), 401],
      ['legal entity inactive', 'legalEntities', f => f.who.entityIds[0], row => ({ active: false }), 401],
    ];
    for (const [label, name, identity, changes, httpStatus] of faults) await caseOf(t, `sequential ${label}: fresh use and exact replay deny with reference errors unchanged`, async row => {
      const f = await prototypeFixture(h, createPermitPrototype), body = request(f), committed = await runCommand(h, f, body);
      const original = await h.db.collection(name).findOne({ _id: identity(f) });
      await fault(h.db, name, original, changes(original), async () => {
        await noWrites(h, () => runCommand(h, f, { ...body, commandKey: randomUUID() }), 403, 'SCOPE_DENIED');
        await noWrites(h, () => runCommand(h, f, body), 403, 'SCOPE_DENIED');
        await noWrites(h, () => atomic(h.client, session => h.runtime.foundation.authorizeInTransaction(f.scope, { plantId: f.who.plantId, action }, { session })), 403, 'SCOPE_DENIED');
        const before = await snapshot(h.db), response = await itemHTTP(h, f.who, command());
        assert.equal(response.status, httpStatus); assert.equal(response.error.code, httpStatus === 401 ? 'UNAUTHENTICATED' : 'SCOPE_DENIED');
        assert.deepEqual(await snapshot(h.db), before);
        row.actualPortfolioStatus = httpStatus; row.prototypeStatus = 403; row.referenceFoundationStatus = 403;
        if (httpStatus === 401) portfolioSessionMismatch = true;
      });
      assert.equal(await h.db.collection(C.effects).countDocuments({ _id: committed._id }), 1);
    });

    await caseOf(t, 'actual session rotation invalidates the old candidate and both real authorization references', async row => {
      const f = await prototypeFixture(h, createPermitPrototype), body = request(f); await runCommand(h, f, body);
      const rotated = await h.runtime.foundation.switchSession(f.scope, { tenantId: f.who.tenantId, selectedPlantId: f.who.plantId, ttlMs: 3600000 });
      await noWrites(h, () => runCommand(h, f, body), 403, 'SCOPE_DENIED');
      await noWrites(h, () => atomic(h.client, session => h.runtime.foundation.authorizeInTransaction(f.scope, { plantId: f.who.plantId, action }, { session })), 403, 'SCOPE_DENIED');
      const before = await snapshot(h.db), response = await itemHTTP(h, f.who, command());
      assert.equal(response.status, 401); assert.equal(response.error.code, 'UNAUTHENTICATED'); assert.deepEqual(await snapshot(h.db), before);
      const newScope = await f.candidate.authenticate(rotated.token);
      await noWrites(h, () => atomic(h.client, session => f.candidate.command(newScope, request(f), { session })), 403, 'SCOPE_DENIED');
      row.oldSession = f.who.sessionId; row.newSession = rotated.sessionId; row.newSessionHasNoImplicitPermit = true;
    });

    await caseOf(t, 'permit expiry policy change forged scope and foreign target fail closed without generation shortcuts', async row => {
      const f = await prototypeFixture(h, createPermitPrototype), body = request(f);
      await noWrites(h, () => atomic(h.client, session => f.candidate.command({ ...f.scope }, body, { session })), 403, 'SCOPE_DENIED');
      await noWrites(h, () => atomic(h.client, session => h.runtime.foundation.authorizeInTransaction({ ...f.scope }, { plantId: f.who.plantId, action }, { session })), 403, 'SCOPE_DENIED');
      await noWrites(h, () => runCommand(h, f, { ...body, plantId: randomUUID() }), 403, 'SCOPE_DENIED');
      f.clock.value += 60001;
      await noWrites(h, () => runCommand(h, f, body), 403, 'SCOPE_DENIED');
      f.clock.value -= 60001;
      f.policy.owner.push('independent.policy.change');
      try { await noWrites(h, () => runCommand(h, f, body), 409, 'F5A_POLICY_CHANGED'); }
      finally { f.policy.owner.pop(); }
      row.permitOnlyExpiry = true; row.policyScope = 'isolated policy object; no live production policy writer is certified';
    });

    await caseOf(t, 'duplicate orphan and corrupt permit generation are refused and restored faults leave valid use', async row => {
      const f = await prototypeFixture(h, createPermitPrototype), head = await h.db.collection(C.permits).findOne({ _id: f.issued.permitId }), origin = await h.db.collection(C.origins).findOne({ _id: f.issued.permitId });
      await assert.rejects(h.db.collection(C.permits).insertOne({ ...head, _id: randomUUID() }), error => error.code === 11000);
      await noWrites(h, () => atomic(h.client, session => f.candidate.issuePermit(f.scope, { plantId: f.who.plantId, actions: [action], ttlMs: 60000, commandKey: randomUUID() }, { session })), 409, 'F5A_PERMIT_EXISTS');
      await h.db.collection(C.origins).deleteOne({ _id: origin._id });
      try { await noWrites(h, () => runCommand(h, f, request(f)), 409, 'F5A_PERMIT_SOURCE_INVALID'); }
      finally { await h.db.collection(C.origins).insertOne(origin); }
      await fault(h.db, C.permits, head, { generation: 99 }, () => noWrites(h, () => runCommand(h, f, request(f)), 409, 'F5A_PERMIT_SOURCE_INVALID'));
      await h.db.collection(C.permits).deleteOne({ _id: head._id });
      try { await noWrites(h, () => runCommand(h, f, request(f)), 403, 'SCOPE_DENIED'); }
      finally { await h.db.collection(C.permits).insertOne(head); }
      const result = await runCommand(h, f, request(f)); assert.equal(result.permitId, head._id);
      row.invalidGeneration = 99; row.scope = 'bounded missing-head/origin/unique-index/generation faults, not exhaustive coherent chain forgery';
    });

    await caseOf(t, 'candidate outbox failure rolls back permit usage and effect/key/audit; exact key then commits once', async row => {
      const f = await prototypeFixture(h, createPermitPrototype), body = request(f), options = (await h.db.listCollections({ name: C.outbox }).toArray())[0].options;
      await h.db.command({ collMod: C.outbox, validator: { $jsonSchema: { required: ['INDEPENDENT_ROLLBACK_FAULT'] } }, validationLevel: 'strict', validationAction: 'error' });
      try {
        const before = await snapshot(h.db);
        await assert.rejects(runCommand(h, f, body), error => error.code === 121);
        assert.deepEqual(await snapshot(h.db), before);
      } finally { await h.db.command({ collMod: C.outbox, validator: options.validator || {}, validationLevel: options.validationLevel || 'strict', validationAction: options.validationAction || 'error' }); }
      const committed = await runCommand(h, f, body), before = await snapshot(h.db), replayed = await runCommand(h, f, body), after = await snapshot(h.db);
      assert.deepEqual(replayed, committed);
      for (const name of Object.keys(before).filter(name => ![C.permits, C.events].includes(name))) assert.deepEqual(after[name], before[name]);
      const permitBefore = before[C.permits].find(value => value._id === f.issued.permitId), permitAfter = after[C.permits].find(value => value._id === f.issued.permitId);
      assert.equal(permitAfter.version, permitBefore.version + 1); assert.equal(permitAfter.uses, permitBefore.uses + 1);
      assert.equal(after[C.events].length, before[C.events].length + 1);
      assert.equal(await h.db.collection(C.effects).countDocuments({ key: body.commandKey }), 1);
      row.replayPermitUseIncrement = 1; row.businessEffectsForKey = 1;
    });

    await caseOf(t, 'renewal extends one immutable permit and retained tenant capacity rejects an extra registration', async row => {
      const f = await prototypeFixture(h, createPermitPrototype, { maximum: 1 });
      f.clock.value += 1000;
      const renewed = await atomic(h.client, session => f.candidate.renewPermit(f.scope, { permitId: f.issued.permitId, ttlMs: 120000, commandKey: randomUUID() }, { session }));
      assert.equal(renewed.permitId, f.issued.permitId); assert.equal(renewed.version, 2);
      const next = await h.runtime.foundation.issueSession({ userId: f.who.userId, tenantId: f.who.tenantId, selectedPlantId: f.who.plantId, ttlMs: 3600000 }), nextScope = await f.candidate.authenticate(next.token);
      await noWrites(h, () => atomic(h.client, session => f.candidate.issuePermit(nextScope, { plantId: f.who.plantId, actions: [action], ttlMs: 60000, commandKey: randomUUID() }, { session })), 409, 'F5A_PERMIT_CAPACITY');
      assert.equal(await h.db.collection(C.permits).countDocuments({ tenantId: f.who.tenantId }), 1);
      await atomic(h.client, session => f.candidate.withdrawMembership({ tenantId: f.who.tenantId, membershipId: f.who.membershipId }, { session }));
      const withdrawn = await h.db.collection('memberships').findOne({ _id: f.who.membershipId });
      await h.runtime.foundation.invalidateMembership({ tenantId: f.who.tenantId, membershipId: f.who.membershipId, expectedVersion: withdrawn.version, active: true });
      const reactivated = await h.runtime.foundation.issueSession({ userId: f.who.userId, tenantId: f.who.tenantId, selectedPlantId: f.who.plantId, ttlMs: 3600000 }), activeScope = await f.candidate.authenticate(reactivated.token);
      await noWrites(h, () => atomic(h.client, session => f.candidate.issuePermit(activeScope, { plantId: f.who.plantId, actions: [action], ttlMs: 60000, commandKey: randomUUID() }, { session })), 409, 'F5A_PERMIT_CAPACITY');
      row.retainedTenantLimit = 1; row.extraSessionGetsNoPermit = true; row.inactivePermitStillOccupiesCapacity = true;
    });

    await caseOf(t, 'real permit conflict retries the callback and preserves exactly two distinct effects', async row => {
      const events = [], barrier = latch('candidate-retry-after-authority-read', events);
      let armed = false;
      const f = await prototypeFixture(h, createPermitPrototype, { hooks: { afterAuthorityRead: async ({ phase }) => { if (armed && phase === 'authorize') { armed = false; await barrier.pause(); } } } });
      const peer = createPermitPrototype({ db: other.db, foundation: h.runtime.foundation, roleActions: f.policy, now: () => new Date(f.clock.value) }), peerScope = await peer.authenticate(f.who.token), attempts = [], conflicts = [];
      const restore = intercept(h.db, () => false, () => {}, { conflicts });
      const first = request(f), second = request(f); armed = true;
      const actor = atomic(h.client, session => f.candidate.command(f.scope, first, { session }), attempts); actor.catch(() => {});
      try {
        await bounded(barrier.arrived, 'retry actor source read');
        await atomic(other.client, session => peer.command(peerScope, second, { session }));
        events.push({ event: 'peer-permit-and-effect-commit', utc: new Date().toISOString() }); barrier.release();
        await actor; assert.ok(attempts.length >= 2); assert.ok(conflicts.some(value => value.name === C.permits && value.code === 112));
        for (const key of [first.commandKey, second.commandKey]) for (const name of [C.effects, C.commandKeys, C.audit, C.outbox]) assert.equal(await h.db.collection(name).countDocuments({ key }), 1);
        row.events = events; row.callbackAttempts = attempts.length; row.actualWriteConflicts = conflicts;
      } finally { barrier.release(); await actor.catch(() => {}); restore(); }
    });

    await caseOf(t, 'concurrent actual registration has one permit and no orphan origin or extra acknowledged issue key', async row => {
      const who = await principal(h), policy = roles(), events = [], barrier = latch('registration-authority-read', events), clock = { value: Date.now() };
      let armed = true;
      const candidate = createPermitPrototype({ db: h.db, foundation: h.runtime.foundation, roleActions: policy, now: () => new Date(clock.value), hooks: { afterAuthorityRead: async ({ phase }) => { if (armed && phase === 'issue') { armed = false; await barrier.pause(); } } } });
      await candidate.initialize();
      const scope = await candidate.authenticate(who.token), peer = createPermitPrototype({ db: other.db, foundation: h.runtime.foundation, roleActions: policy, now: () => new Date(clock.value) }), peerScope = await peer.authenticate(who.token);
      const firstKey = randomUUID(), secondKey = randomUUID(), attempts = [];
      const issue = (key, session, instance, bound) => instance.issuePermit(bound, { plantId: who.plantId, actions: [action], ttlMs: 60000, commandKey: key }, { session });
      const actor = atomic(h.client, session => issue(firstKey, session, candidate, scope), attempts); actor.catch(() => {});
      try {
        await bounded(barrier.arrived, 'first registration snapshot');
        const winning = await atomic(other.client, session => issue(secondKey, session, peer, peerScope));
        events.push({ event: 'second-registration-commit', utc: new Date().toISOString() }); barrier.release();
        await assert.rejects(actor, error => error.status === 409 && error.code === 'F5A_PERMIT_EXISTS');
        assert.ok(attempts.length >= 2);
        for (const name of [C.permits, C.origins, C.issueKeys]) assert.equal(await h.db.collection(name).countDocuments({ tenantId: who.tenantId }), 1);
        assert.equal((await h.db.collection(C.issueKeys).findOne({ tenantId: who.tenantId })).key, secondKey);
        row.events = events; row.callbackAttempts = attempts.length; row.winnerPermitId = winning.permitId;
      } finally { barrier.release(); await actor.catch(() => {}); }
    });

    for (const phase of ['issue', 'renew', 'authorize']) await caseOf(t, `official prototype withdrawal wins against ${phase} and actor cannot commit from old authority`, async row => {
      const events = [], barrier = latch(`official-withdrawal-vs-${phase}`, events); let armed = false;
      const f = await prototypeFixture(h, createPermitPrototype, { hooks: { afterAuthorityRead: async ({ phase: actual }) => { if (armed && actual === phase) { armed = false; await barrier.pause({ phase: actual }); } } } });
      const peer = createPermitPrototype({ db: other.db, foundation: h.runtime.foundation, roleActions: f.policy, now: () => new Date(f.clock.value) }), attempts = [];
      let scope = f.scope;
      if (phase === 'issue') { const next = await h.runtime.foundation.issueSession({ userId: f.who.userId, tenantId: f.who.tenantId, selectedPlantId: f.who.plantId, ttlMs: 3600000 }); scope = await f.candidate.authenticate(next.token); }
      f.clock.value += 1000; armed = true;
      const actor = atomic(h.client, session => phase === 'issue'
        ? f.candidate.issuePermit(scope, { plantId: f.who.plantId, actions: [action], ttlMs: 60000, commandKey: randomUUID() }, { session })
        : phase === 'renew' ? f.candidate.renewPermit(scope, { permitId: f.issued.permitId, ttlMs: 120000, commandKey: randomUUID() }, { session })
          : f.candidate.command(scope, request(f), { session }), attempts); actor.catch(() => {});
      try {
        await bounded(barrier.arrived, 'actor old source read');
        const withdrawn = await atomic(other.client, session => peer.withdrawMembership({ tenantId: f.who.tenantId, membershipId: f.who.membershipId }, { session }));
        assert.deepEqual(withdrawn.permits, [f.issued.permitId]); events.push({ event: 'official-withdrawal-commit', utc: new Date().toISOString() });
        barrier.release(); await assert.rejects(actor, error => error.code === 'SCOPE_DENIED' && error.status === 403);
        assert.ok(attempts.length >= 2);
        assert.equal(await h.db.collection(C.effects).countDocuments({ tenantId: f.who.tenantId }), 0);
        assert.equal(await h.db.collection(C.permits).countDocuments({ tenantId: f.who.tenantId }), 1);
        const permit = await atomic(h.client, session => f.candidate.inspectPermit(f.issued.permitId, f.who.tenantId, session)); assert.equal(permit.active, false); assert.equal(permit.generation, 2);
        row.events = events; row.callbackAttempts = attempts.length; row.writerScope = 'trusted isolated withdrawal only; existing production writers are not rewired';
      } finally { barrier.release(); await actor.catch(() => {}); }
    });

    await caseOf(t, 'concurrent official prototype revokers produce one terminal generation and no partial second invalidation', async row => {
      const f = await prototypeFixture(h, createPermitPrototype), events = [], barrier = latch('first-revoker-after-real-membership-read', events), attempts = [];
      const peer = createPermitPrototype({ db: other.db, foundation: h.runtime.foundation, roleActions: f.policy, now: () => new Date(f.clock.value) }); let armed = true;
      const restore = intercept(h.db, (name, method, args) => armed && name === 'memberships' && method === 'updateOne' && args[0]?._id === f.who.membershipId && args[1]?.$set?.active === false, async () => { armed = false; await barrier.pause({ snapshotEstablishedBy: 'actual retained permits and membership reads' }); });
      const actor = atomic(h.client, session => f.candidate.withdrawMembership({ tenantId: f.who.tenantId, membershipId: f.who.membershipId }, { session }), attempts); actor.catch(() => {});
      try {
        await bounded(barrier.arrived, 'first official revoker reads');
        await atomic(other.client, session => peer.withdrawMembership({ tenantId: f.who.tenantId, membershipId: f.who.membershipId }, { session }));
        events.push({ event: 'second-revoker-commit', utc: new Date().toISOString() }); barrier.release();
        await assert.rejects(actor, error => error.status === 403 && error.code === 'SCOPE_DENIED'); assert.ok(attempts.length >= 2);
        const permit = await atomic(h.client, session => f.candidate.inspectPermit(f.issued.permitId, f.who.tenantId, session));
        assert.equal(permit.active, false); assert.equal(permit.generation, 2);
        assert.equal(await h.db.collection(C.events).countDocuments({ tenantId: f.who.tenantId, kind: 'REVOKED' }), 1);
        row.events = events; row.callbackAttempts = attempts.length; row.terminalGeneration = 2;
      } finally { barrier.release(); await actor.catch(() => {}); restore(); }
    });

    await caseOf(t, 'foundation cross-target selected-only deactivation classifies actual baseline rather than inventing candidate coverage', async row => {
      const who = await principal(h, { crossTarget: true }), events = [], barrier = latch('foundation-cross-target-after-verification', events), selected = await h.db.collection('plants').findOne({ _id: who.plantId });
      let armed = true;
      const restore = intercept(h.db, (name, method, args) => armed && name === 'sessions' && method === 'updateOne' && args[1]?.$inc?.authorizationFence === 1, async () => { armed = false; await barrier.pause({ selectedPlant: who.plantId, requestedPlant: who.plantIds[1] }); });
      const key = randomUUID(), actor = atomic(h.client, async session => {
        const grant = await h.runtime.foundation.authorizeInTransaction(who.scope, { plantId: who.plantIds[1], action }, { session });
        assert.equal(grant.plantId, who.plantIds[1]);
        await h.db.collection('f5aIndependentEffects').insertOne({ _id: randomUUID(), key, selectedPlant: who.plantId, requestedPlant: grant.plantId }, { session });
      }); actor.catch(() => {});
      try {
        await bounded(barrier.arrived, 'cross-target actual verification');
        await writeAuthority(other.db, other.client, who, { name: 'plants', filter: { _id: who.plantId }, update: { $set: { active: false } } }, events);
        barrier.release(); await actor;
        assert.equal(await h.db.collection('f5aIndependentEffects').countDocuments({ key }), 1);
        await noWrites(h, () => atomic(h.client, session => h.runtime.foundation.authorizeInTransaction(who.scope, { plantId: who.plantIds[1], action }, { session })), 403, 'SCOPE_DENIED');
        row.events = events; row.observedOverlap = 'COMMITTED after selected-only change; concurrent mutation-first serialization remains a contract decision';
        row.scope = 'Actual foundation requested-target fence behavior only; candidate same-plant scope and portfolio selected-plant guard are not upgraded by this observation';
      } finally { barrier.release(); await actor.catch(() => {}); restore(); await h.db.collection('plants').replaceOne({ _id: selected._id }, selected); }
    });
    assert.equal(rejectedCounterexample, true); assert.equal(portfolioSessionMismatch, true);
  } finally {
    await other.client.close();
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(reportPath, JSON.stringify({ sourceRoot, prototypeHash: expectedPrototypeHash, verdict: rejectedCounterexample ? 'REJECTED' : 'UNESTABLISHED', portfolioSessionErrorMismatch: portfolioSessionMismatch, cases: proof, limits: ['Prototype is isolated and never installed.', 'Selected/requested baseline overlap is classified, not silently strengthened.', 'No performance benchmark or stock/financial integration acceptance.', 'Read raw TAP for overall matrix completeness; a rejection counterexample does not turn another failed test into PASS.'] }, null, 2), { flag: 'wx' });
  }
});
