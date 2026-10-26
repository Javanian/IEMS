import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const sourceRoot = resolve(process.env.IEMS_F5_SOURCE_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
export const { startOwned } = await import(pathToFileURL(resolve(sourceRoot, 'apps/portfolio-api/test/support/owned-mongo.mjs')));
const { roleActions } = await import(pathToFileURL(resolve(sourceRoot, 'apps/portfolio-api/src/commercial.mjs')));
const { MongoClient } = createRequire(resolve(sourceRoot, 'apps/portfolio-api/package.json'))('mongodb');
export const roles = () => Object.fromEntries(Object.entries(roleActions).map(([name, actions]) => [name, [...actions]]));
export const action = 'master.item.write';
export const digest = token => createHash('sha256').update(token).digest('hex');
export const command = () => ({ expectedVersion: 1, reason: 'Independent actual authorization control', idempotencyKey: randomUUID(), code: `F5C_${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`, description: 'Independent actual guarded draft master', kind: 'PURCHASED', uom: 'KG', schema: 'INVENTORY_ITEM_V2', trackingPolicy: 'LOT' });

export async function otherConnection(h) {
  const hosts = h.client.options.hosts.map(host => host.toString()).join(',');
  assert.ok(hosts && h.client.options.replicaSet);
  const client = await new MongoClient(`mongodb://${hosts}/?replicaSet=${encodeURIComponent(h.client.options.replicaSet)}`, { monitorCommands: true, serverSelectionTimeoutMS: 5000 }).connect();
  return { client, db: client.db(h.db.databaseName) };
}

export async function atomic(client, effect, attempts = []) {
  const session = client.startSession();
  try { return await session.withTransaction(async () => { attempts.push({ attempt: attempts.length + 1, utc: new Date().toISOString() }); return effect(session); }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' }); }
  finally { await session.endSession(); }
}

export function latch(label, events, timeoutMs = 20000) {
  let enter, release, timer;
  const arrived = new Promise(resolve => { enter = resolve; });
  const released = new Promise((resolve, reject) => { release = resolve; timer = setTimeout(() => reject(Error(`Barrier timed out: ${label}`)), timeoutMs); });
  released.catch(() => {});
  let hits = 0, releaseRecorded = false;
  return {
    arrived,
    async pause(details = {}) { hits++; events.push({ label, event: 'arrived', utc: new Date().toISOString(), ...details }); enter(details); await released; },
    release() { clearTimeout(timer); if (!releaseRecorded) { releaseRecorded = true; events.push({ label, event: 'released', utc: new Date().toISOString() }); } release(); },
    get hits() { return hits; },
  };
}

export async function bounded(promise, label, timeoutMs = 20000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}

export function intercept(db, matches, callback, { after = false, conflicts = [] } = {}) {
  const original = db.collection;
  db.collection = function(name, ...rest) {
    const collection = original.call(this, name, ...rest);
    return new Proxy(collection, { get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const match = matches(name, property, args);
        const failure = error => { if (error.code === 112) conflicts.push({ name, property: String(property), code: 112, utc: new Date().toISOString() }); throw error; };
        if (!match) {
          const result = value.apply(target, args);
          return result && typeof result.then === 'function' ? result.catch(failure) : result;
        }
        return (async () => {
          if (!after) await callback({ name, property, args, acknowledgedWrite: false });
          const result = await value.apply(target, args).catch(failure);
          if (after) await callback({ name, property, args, result, acknowledgedWrite: true });
          return result;
        })();
      };
    } });
  };
  return () => { db.collection = original; };
}

export async function snapshot(db) {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort();
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
}

export async function noWrites(h, effect, status, code) {
  const before = await snapshot(h.db);
  await assert.rejects(effect, error => error.status === status && error.code === code);
  assert.deepEqual(await snapshot(h.db), before);
}

export async function fault(db, name, row, changes, effect) {
  await db.collection(name).replaceOne({ _id: row._id }, { ...row, ...changes });
  try { return await effect(); }
  finally { await db.collection(name).replaceOne({ _id: row._id }, row); }
}

export async function principal(h, { crossTarget = false } = {}) {
  const foundation = h.runtime.foundation, tenantId = randomUUID(), userId = randomUUID(), membershipId = randomUUID();
  const entityIds = [randomUUID(), ...(crossTarget ? [randomUUID()] : [])], plantIds = entityIds.map(() => randomUUID());
  await foundation.provisionTenant({ id: tenantId });
  await foundation.provisionUser({ id: userId, tenantId });
  for (const [index, entityId] of entityIds.entries()) {
    await foundation.provisionLegalEntity({ id: entityId, tenantId });
    await foundation.provisionPlant({ id: plantIds[index], tenantId, legalEntityId: entityId });
  }
  await foundation.provisionMembership({ id: membershipId, tenantId, userId, legalEntityIds: entityIds, plantIds, roles: [{ role: 'owner', plantIds }] });
  const issued = await foundation.issueSession({ userId, tenantId, selectedPlantId: plantIds[0], ttlMs: 3600000 });
  const scope = await foundation.authenticate(issued.token);
  return { ...issued, tenantId, userId, membershipId, plantId: plantIds[0], plantIds, entityIds, scope, cookie: `portfolio_session=${issued.token}` };
}

export async function writeAuthority(db, client, who, change, events) {
  const result = await atomic(client, session => db.collection(change.name || 'memberships').updateOne(change.filter || { _id: who.membershipId }, change.update || { $set: { roles: [] } }, { session }));
  assert.equal(result.matchedCount, 1);
  events.push({ event: 'authority-commit', utc: new Date().toISOString(), name: change.name || 'memberships' });
}

export async function itemHTTP(h, who, body) { return h.req('/inventory-master/items', body, who.cookie); }

export function onlyChangedMembership(before, after, who) {
  const expected = { ...before, memberships: before.memberships.map(row => row._id === who.membershipId ? { ...row, roles: [] } : row) };
  assert.deepEqual(after, expected, 'Refused mutation changed more than the separately committed role removal');
}

export async function prototypeFixture(h, createPermitPrototype, { hooks = {}, maximum = 8, clock = { value: Date.now() } } = {}) {
  const who = await principal(h), policy = roles();
  const candidate = createPermitPrototype({ db: h.db, foundation: h.runtime.foundation, roleActions: policy, now: () => new Date(clock.value), maxPermitsPerTenant: maximum, hooks });
  await candidate.initialize();
  const scope = await candidate.authenticate(who.token), issueKey = randomUUID();
  const issued = await atomic(h.client, session => candidate.issuePermit(scope, { plantId: who.plantId, actions: [action], ttlMs: 60000, commandKey: issueKey }, { session }));
  return { who, policy, candidate, scope, issued, issueKey, clock };
}
