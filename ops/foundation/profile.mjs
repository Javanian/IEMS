import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

if (process.env.FOUNDATION_PROFILE !== 'owned-synthetic') throw new Error('Set FOUNDATION_PROFILE=owned-synthetic to start an isolated local profile');
const require = createRequire(new URL('../../apps/portfolio-api/package.json', import.meta.url));
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const runId = randomUUID(), started = performance.now();
let replica, client;
try {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', ...(process.env.MONGOMS_SYSTEM_BINARY ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY } : {}) }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const replicaReadyMs = performance.now() - started;
  client = await MongoClient.connect(replica.getUri(), { serverSelectionTimeoutMS: 5000, maxPoolSize: 10 });
  const admin = client.db('admin');
  const hello = await admin.command({ hello: 1 });
  const build = await admin.command({ buildInfo: 1 });
  const status = await admin.command({ serverStatus: 1 });
  if (!hello.setName || !hello.isWritablePrimary) throw new Error('Replica profile not writable');
  console.log(JSON.stringify({ schemaVersion: 1, runId, occurredAt: new Date().toISOString(), profile: 'owned-synthetic-idle-single-member', node: process.version, mongodb: build.version, replicaReadyMs, connectedMs: performance.now() - started, mongoResidentMiB: status.mem.resident, runnerRssBytes: process.memoryUsage().rss, acceptance: 'IMPLEMENTED_QA_PENDING', limitations: ['Idle startup only; no application workload, HA or stress acceptance', 'No legacy PostgreSQL access'] }, null, 2));
} finally {
  if (client) await client.close();
  if (replica) await replica.stop();
}
