import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoClient } from 'mongodb';
import amqp from 'amqplib';
import { createClient } from 'redis';
import { initialize, createApp } from '../../apps/portfolio-api/src/app.mjs';
import { roleActions } from '../../apps/portfolio-api/src/commercial.mjs';
import { initializePlatformRuntime, installPlatform, platformActions, platformRoles } from '../../apps/portfolio-api/src/platform-runtime.mjs';
import { createRabbitTransport, createJobWorker } from '../../packages/durable-jobs/rabbitmq.mjs';

const requireApi = createRequire(new URL('../../apps/portfolio-api/package.json', import.meta.url));
const express = requireApi('express');
const env = process.env, owner = env.PLATFORM_OWNER, database = env.PLATFORM_DB;
if (!/^iems-tpr139-[a-f0-9]{12}$/.test(owner) || database !== `portfolio_owned_${owner.replaceAll('-', '_')}` || !/^[a-f0-9]{40}$/.test(env.PLATFORM_SOURCE_SHA)) throw new Error('Owned profile identity required');
const origin = env.PLATFORM_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin)) throw new Error('Loopback origin required');
const mongoHost = `${owner}-mongo:27017`;
if (env.PLATFORM_MONGO_URI !== `mongodb://${mongoHost}/?replicaSet=rs0`) throw new Error('Owned Mongo URI required');
const direct = new MongoClient(`mongodb://${mongoHost}/?directConnection=true`, { serverSelectionTimeoutMS: 2000 });
let client, rabbit, redis, worker, server, timer, stopping = false;
const deadline = Date.now() + 90000;
async function retry(effect) {
  for (;;) {
    try { return await effect(); }
    catch { if (Date.now() >= deadline) throw new Error('OWNED_STARTUP_TIMEOUT'); await delay(1000); }
  }
}
async function close(code = 0) {
  if (stopping) return;
  stopping = true; clearTimeout(timer);
  const hardStop = setTimeout(() => process.exit(code || 1), 10000);
  hardStop.unref();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  await worker?.close();
  await Promise.allSettled([rabbit?.close(), redis?.quit(), client?.close(), direct.close()]);
  clearTimeout(hardStop); process.exitCode = code;
}
process.once('SIGTERM', () => close().catch(() => process.exit(1)));
process.once('SIGINT', () => close().catch(() => process.exit(1)));
try {
  await retry(async () => {
    await direct.connect();
    try { await direct.db('admin').command({ replSetGetStatus: 1 }); }
    catch (error) {
      if (error.code !== 94) throw error;
      await direct.db('admin').command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: mongoHost }] } });
    }
  });
  await direct.close();
  client = new MongoClient(env.PLATFORM_MONGO_URI, { serverSelectionTimeoutMS: 3000, maxPoolSize: 8, socketTimeoutMS: 10000, connectTimeoutMS: 3000 });
  await retry(async () => { await client.connect(); await client.db('admin').command({ ping: 1 }); });
  const db = client.db(database);
  await db.collection('platformOwnership').updateOne({ _id: owner }, { $setOnInsert: { sourceSha: env.PLATFORM_SOURCE_SHA, createdAt: new Date() } }, { upsert: true });
  const marker = await db.collection('platformOwnership').findOne({ _id: owner });
  if (marker.sourceSha !== env.PLATFORM_SOURCE_SHA) throw new Error('OWNERSHIP_SOURCE_MISMATCH');
  Object.assign(roleActions, platformRoles);
  roleActions.owner.push(...platformActions);
  const runtime = await initialize({ client, db });
  const handlers = {
    'platform.persistence-probe': async ({ job, session }) => {
      if (!job.input || Object.keys(job.input).some(k => k !== 'value') || typeof job.input.value !== 'string' || job.input.value.length > 80) throw Object.assign(new Error('INVALID_PROBE'), { code: 'INVALID_PROBE', status: 422 });
      await db.collection('platformLocalProbes').insertOne({ _id: job._id, tenantId: job.tenantId, plantId: job.plantId, value: job.input.value }, { session });
      return { persisted: true };
    }
  };
  redis = createClient({ url: env.PLATFORM_REDIS_URL, socket: { reconnectStrategy: false, connectTimeout: 3000 }, disableOfflineQueue: true });
  redis.on('error', () => {});
  await retry(async () => { if (!redis.isOpen) await redis.connect(); });
  runtime.platform = await initializePlatformRuntime(runtime, { roleActions, handlers, redis: { namespace: owner, sendCommand: command => redis.sendCommand(command) } });
  rabbit = await retry(() => amqp.connect(env.PLATFORM_RABBIT_URL, { timeout: 3000 }));
  rabbit.on('error', () => { close(1).catch(() => process.exit(1)); });
  rabbit.on('close', () => { if (!stopping) close(1).catch(() => process.exit(1)); });
  const transport = await createRabbitTransport({ connection: rabbit, queue: `${owner}.jobs.v1` });
  worker = createJobWorker({ jobs: runtime.platform.jobs, transport });
  await worker.start();
  const dispatch = async () => {
    try { await worker.dispatch(25); if (!stopping) timer = setTimeout(dispatch, 1000); }
    catch { console.error(JSON.stringify({ code: 'PLATFORM_DISPATCH_FAILED', owner })); await close(1); }
  };
  await dispatch();
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', async (req, res) => {
    try {
      transport.assertHealthy(); await db.command({ ping: 1 });
      res.set('Cache-Control', 'no-store').json({ status: 'ok', owner, sourceSha: env.PLATFORM_SOURCE_SHA, database, redis: redis.isReady ? 'ready' : 'degraded-disposable' });
    } catch { res.status(503).json({ status: 'unavailable', owner }); }
  });
  app.use('/api/platform', express.json({ limit: '80kb' }), async (req, res, next) => {
    if ((req.method !== 'GET' && req.headers.origin !== origin) || (req.headers.origin && req.headers.origin !== origin)) return res.status(403).json({ error: { code: 'ORIGIN_DENIED' } });
    const tokens = (req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith('portfolio_session='));
    if (tokens.length !== 1) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
    req.token = tokens[0].slice('portfolio_session='.length);
    try { req.scope = await runtime.foundation.authenticate(req.token); next(); }
    catch { res.status(401).json({ error: { code: 'UNAUTHENTICATED' } }); }
  });
  installPlatform(app, runtime);
  app.use(createApp(runtime, { origins: [origin] }));
  app.use((error, req, res, next) => { res.status(error.status || 500).json({ error: { code: error.status ? error.code : 'INTERNAL_ERROR' } }); });
  server = app.listen(4313, '0.0.0.0');
  server.on('error', () => close(1).catch(() => process.exit(1)));
  console.log(JSON.stringify({ status: 'started', owner, sourceSha: env.PLATFORM_SOURCE_SHA }));
} catch {
  console.error(JSON.stringify({ code: 'PLATFORM_STARTUP_FAILED', owner }));
  await close(1);
}
