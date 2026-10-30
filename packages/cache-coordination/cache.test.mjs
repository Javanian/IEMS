import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCacheCoordination, createDurableRateLimiter, scopedKey, releaseScript } from './index.mjs';
const scope = Object.fromEntries(['tenantId', 'plantId', 'legalEntityId'].map(k => [k, randomUUID()]));
test('cache keys isolate all scope dimensions and revisions', () => {
  const input = { purpose: 'read', resourceId: 'a:b', revision: 1 };
  const key = scopedKey('local', scope, input);
  for (const field of Object.keys(scope)) assert.notEqual(scopedKey('local', { ...scope, [field]: randomUUID() }, input), key);
  assert.notEqual(scopedKey('local', scope, { ...input, revision: 2 }), key);
  assert.throws(() => scopedKey('bad:namespace', scope, input));
});
test('Redis failure falls back to authorized load; revoked cache hit cannot return', async () => {
  let loads = 0;
  const cache = createCacheCoordination({ namespace: 'local', sendCommand: async () => { throw new Error('offline'); } });
  const request = { scope, resourceId: 'job', revision: 3, authorize: async () => ({ ...scope, userId: 'user', revision: 3 }), load: async () => { loads++; return { status: 'QUEUED' }; } };
  assert.deepEqual((await cache.read(request)).data, { status: 'QUEUED' });
  await assert.rejects(cache.read({ ...request, authorize: async () => { throw new Error('revoked'); } }), /revoked/);
  assert.equal(loads, 1);
});
test('cache uses TTL and user identity and reauthorizes a warm hit', async () => {
  const store = new Map(); let auth = 0, loads = 0;
  const cache = createCacheCoordination({ namespace: 'local', sendCommand: async cmd => { if (cmd[0] === 'GET') return store.get(cmd[1]); assert.equal(cmd[3], 'PX'); store.set(cmd[1], cmd[2]); return 'OK'; } });
  const request = { scope, resourceId: 'job', revision: 1, authorize: async () => { auth++; return { ...scope, userId: 'user', revision: 1 }; }, load: async () => { loads++; return { status: 'DEAD' }; } };
  assert.equal((await cache.read(request)).cache, 'MISS'); assert.equal((await cache.read(request)).cache, 'HIT');
  assert.equal(auth, 2); assert.equal(loads, 1);
  store.clear(); assert.equal((await cache.read(request)).cache, 'MISS'); assert.equal(loads, 2);
});
test('advisory release compares ownership token and never grants authority', async () => {
  const commands = [];
  const cache = createCacheCoordination({ namespace: 'local', sendCommand: async cmd => { commands.push(cmd); return 'OK'; } });
  const lease = await cache.advisoryLease(scope, 'job'); await lease.release();
  assert.equal(lease.authoritative, false); assert.equal(commands[1][1], releaseScript);
  assert.equal(commands[0][2], commands[1][4]); assert.deepEqual(commands[0].slice(3), ['NX', 'PX', '5000']);
});
test('durable rate decision survives adapter recreation and never consults Redis', async () => {
  let row;
  const db = { collection: () => ({ async findOne() { return row; }, async insertOne(value) { row = value; }, async updateOne() { row.used++; return { matchedCount: 1 }; } }) };
  const client = { startSession: () => ({ startTransaction() {}, async commitTransaction() {}, async endSession() {}, inTransaction: () => true, async abortTransaction() {} }) };
  const config = { db, client, authorize: async () => ({ ...scope, userId: 'user' }), now: () => new Date('2026-10-30T12:00:00Z') };
  const policy = { subjectId: 'user', policy: 'job.request', limit: 1, windowMs: 60000 };
  assert.equal((await createDurableRateLimiter(config).consume(scope, policy)).allowed, true);
  assert.equal((await createDurableRateLimiter(config).consume(scope, policy)).allowed, false);
});
