import { randomUUID } from 'node:crypto';

export async function createRabbitTransport({ connection, queue = 'iems.jobs.v1', prefetch = 2, timeoutMs = 10000 }) {
  if (!/^[a-z0-9.-]{1,80}$/.test(queue) || !Number.isInteger(prefetch) || prefetch < 1 || prefetch > 16 || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new RangeError('Invalid transport bounds');
  const publisher = await connection.createConfirmChannel();
  const consumer = await connection.createChannel();
  const deadQueue = `${queue}.dead`, exchange = `${queue}.dlx`;
  for (const channel of [publisher, consumer]) {
    await channel.assertExchange(exchange, 'direct', { durable: true });
    await channel.assertQueue(deadQueue, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
    await channel.bindQueue(deadQueue, exchange, 'dead');
    await channel.assertQueue(queue, { durable: true, arguments: { 'x-queue-type': 'quorum', 'x-dead-letter-exchange': exchange, 'x-dead-letter-routing-key': 'dead', 'x-delivery-limit': 20 } });
  }
  await consumer.prefetch(prefetch);
  const pending = new Map();
  const failPending = error => { for (const item of pending.values()) item.reject(error); };
  publisher.on('return', message => pending.get(message.properties.messageId)?.reject(new Error('BROKER_UNROUTABLE')));
  publisher.on('error', failPending);
  publisher.on('close', () => failPending(new Error('BROKER_CHANNEL_CLOSED')));
  let consumerError;
  consumer.on('error', error => { consumerError = error; });
  const publish = (envelope, dead = false) => new Promise((resolve, reject) => {
    const messageId = randomUUID();
    const finish = error => { clearTimeout(timer); pending.delete(messageId); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(new Error('BROKER_CONFIRM_TIMEOUT')), timeoutMs);
    pending.set(messageId, { reject: finish });
    try { publisher.sendToQueue(dead ? deadQueue : queue, Buffer.from(JSON.stringify(envelope)), { persistent: true, mandatory: true, contentType: 'application/json', messageId, type: 'platform.job.v1' }, error => finish(error)); }
    catch (error) { finish(error); }
  });
  const inflight = new Set();
  let tag;
  return {
    publish,
    async consume(handle) {
      const result = await consumer.consume(queue, message => {
        if (!message) return;
        const task = (async () => {
          let envelope;
          try {
            if (message.content.length > 4096) throw new Error('INVALID_ENVELOPE');
            envelope = JSON.parse(message.content.toString('utf8'));
          } catch { consumer.nack(message, false, false); return; }
          try { await handle(envelope); consumer.ack(message); }
          catch (error) {
            if (['INVALID_JOB_SCOPE', 'INVALID_JOB_ENVELOPE', 'JOB_NOT_FOUND'].includes(error.code)) consumer.nack(message, false, false);
            else { consumerError = error; await consumer.close(); }
          }
        })();
        inflight.add(task);
        task.finally(() => inflight.delete(task)).catch(() => {});
      }, { noAck: false });
      tag = result.consumerTag;
    },
    assertHealthy() { if (consumerError) throw consumerError; },
    async close() {
      if (tag && !consumerError) await consumer.cancel(tag);
      await Promise.allSettled([...inflight]);
      await Promise.allSettled([consumer.close(), publisher.close()]);
    }
  };
}

export function createJobWorker({ jobs, transport }) {
  const envelope = job => ({ schemaVersion: 1, jobId: job._id, tenantId: job.tenantId, plantId: job.plantId, legalEntityId: job.legalEntityId });
  return {
    async dispatch(limit = 25) {
      transport.assertHealthy();
      const rows = await jobs.due(limit);
      for (const job of rows) {
        await transport.publish(envelope(job), job.status === 'DEAD');
        await jobs.dispatched(job, job.status === 'DEAD');
      }
      return rows.length;
    },
    async start() {
      await transport.consume(async message => {
        const { disposition, job } = await jobs.claim(message);
        if (disposition === 'CLAIMED') {
          try { await jobs.complete(job); }
          catch (error) {
            if (error.code === 'JOB_FENCE_LOST') return;
            const failed = await jobs.failed(job, error);
            if (failed.status === 'DEAD') { await transport.publish(envelope(failed), true); await jobs.dispatched(failed, true); }
          }
        } else if (disposition === 'DEAD' && !job.dlqConfirmedAt) {
          await transport.publish(envelope(job), true); await jobs.dispatched(job, true);
        }
      });
    },
    close: () => transport.close()
  };
}
