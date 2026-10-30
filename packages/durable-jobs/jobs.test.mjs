import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createDurableJobs, validateJob } from './index.mjs';
import { createRabbitTransport, createJobWorker } from './rabbitmq.mjs';

const scope = () => Object.fromEntries(['tenantId', 'plantId', 'legalEntityId'].map(k => [k, randomUUID()]));
function database(collection) {
  return { db: { collection: () => collection }, client: { startSession: () => ({ startTransaction() {}, inTransaction: () => true, async commitTransaction() {}, async abortTransaction() {}, async endSession() {} }) } };
}
test('job contract requires UUID scopes and bounded attempts, rejects oversized inputs', () => {
  const input = { ...scope(), _id: randomUUID(), requestedBy: randomUUID(), authorizationSessionId: randomUUID(), kind: 'report.export', input: {}, maxAttempts: 5 };
  assert.equal(validateJob(input), input);
  for (const patch of [{ tenantId: 'other' }, { maxAttempts: 11 }, { input: { text: 'x'.repeat(66000) } }]) assert.throws(() => validateJob({ ...input, ...patch }));
});
test('lost or expired attempt cannot invoke authorization or effect', async () => {
  let calls = 0, predicate;
  const jobs = createDurableJobs({ ...database({ async findOneAndUpdate(filter) { predicate = filter; return null; } }), authorizeJob: async () => { calls++; }, handlers: { 'report.export': async () => { calls++; } } });
  const job = { ...scope(), _id: randomUUID(), kind: 'report.export', revision: 4, attemptToken: randomUUID() };
  await assert.rejects(jobs.complete(job), { code: 'JOB_FENCE_LOST' });
  assert.equal(calls, 0);
  assert.equal(predicate.attemptToken, job.attemptToken);
  assert.equal(predicate.revision, 4);
  assert.ok(predicate.leaseUntil.$gt instanceof Date);
});
test('ambiguous commit never schedules a new attempt', async () => {
  const jobs = createDurableJobs({ ...database({}), authorizeJob: async () => ({}) });
  await assert.rejects(jobs.failed({}, Object.assign(new Error(), { code: 'COMMIT_OUTCOME_UNKNOWN' })), { code: 'COMMIT_OUTCOME_UNKNOWN' });
});
function broker() {
  const pub = new EventEmitter(), sub = new EventEmitter(), calls = [];
  for (const channel of [pub, sub]) {
    for (const name of ['assertExchange', 'assertQueue', 'bindQueue', 'prefetch', 'close', 'cancel']) channel[name] = async (...args) => { calls.push([name, ...args]); };
  }
  sub.consume = async (queue, fn, options) => { sub.receive = fn; calls.push(['consume', options]); return { consumerTag: 'owned' }; };
  sub.ack = () => calls.push(['ack']); sub.nack = (...args) => calls.push(['nack', ...args]);
  pub.sendToQueue = (queue, body, options, callback) => { pub.sent = { queue, body, options, callback }; return true; };
  return { pub, sub, calls, connection: { createConfirmChannel: async () => pub, createChannel: async () => sub } };
}
test('persistent mandatory publish waits for confirm and rejects broker return', async () => {
  const b = broker(), transport = await createRabbitTransport({ connection: b.connection, timeoutMs: 100 });
  let resolved = false;
  const result = transport.publish({ jobId: 'job' }).then(() => { resolved = true; });
  await Promise.resolve(); assert.equal(resolved, false);
  assert.equal(b.pub.sent.options.persistent, true); assert.equal(b.pub.sent.options.mandatory, true);
  b.pub.sent.callback(null); await result;
  const returned = transport.publish({ jobId: 'job' });
  b.pub.emit('return', { properties: { messageId: b.pub.sent.options.messageId } });
  b.pub.sent.callback(null);
  await assert.rejects(returned, /BROKER_UNROUTABLE/);
  await transport.close();
});
test('consumer acknowledges only after handler completes and uses bounded manual acknowledgements', async () => {
  const b = broker(), transport = await createRabbitTransport({ connection: b.connection });
  let release;
  await transport.consume(() => new Promise(resolve => { release = resolve; }));
  b.sub.receive({ content: Buffer.from('{}') });
  assert.equal(b.calls.some(c => c[0] === 'ack'), false);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.calls.filter(c => c[0] === 'ack').length, 1);
  assert.deepEqual(b.calls.find(c => c[0] === 'consume')[1], { noAck: false });
  assert.equal(b.calls.find(c => c[0] === 'prefetch')[1], 2);
  await transport.close();
});
test('failed confirmation cannot mark durable dispatch or outbox published', async () => {
  let writes = 0;
  const worker = createJobWorker({ jobs: { due: async () => [{ _id: 'id' }], dispatched: async () => { writes++; } }, transport: { assertHealthy() {}, publish: async () => { throw new Error('offline'); } } });
  await assert.rejects(worker.dispatch(), /offline/); assert.equal(writes, 0);
});
