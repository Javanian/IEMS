import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSmtpSink } from './smtp-sink.mjs';
import { submitLocalMail } from '../../apps/portfolio-api/src/automation-transport.mjs';

test('private SMTP capture persists genuine task-bound transport evidence across restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'iems-smtp-owned-'));
  const token = randomUUID(), dataFile = join(directory, 'receipts.jsonl');
  const sink = createSmtpSink({ smtpPort: 0, httpPort: 0, token, dataFile });
  const ports = await sink.start();
  let restarted;
  t.after(async () => { await sink.stop(); if (restarted) await restarted.stop(); rmSync(directory, { recursive: true }); });
  const body = 'Synthetic evidence\n..Content retained without trimming';
  const delivery = { _id: randomUUID(), tenantId: randomUUID(), plantId: randomUUID(), recipient: 'customer@iems.local', subject: 'Synthetic acceptance', body, contentHash: createHash('sha256').update(body).digest('hex') };
  delivery.messageId = `<${delivery._id}@iems.local>`;
  const base = `http://127.0.0.1:${ports.httpPort}`;
  await t.test('HTTP cannot fabricate a receipt and private inspection requires authentication', async () => {
    assert.equal((await fetch(base + '/api/emails')).status, 401);
    assert.equal((await fetch(base + '/api/emails', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' })).status, 405);
    assert.equal(sink.emails.length, 0);
  });
  await t.test('real SMTP DATA creates one receipt with matching message/scope/content', async () => {
    await submitLocalMail(delivery, { smtpPort: ports.smtpPort });
    const response = await fetch(`${base}/api/emails?messageId=${encodeURIComponent(delivery.messageId)}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].headers['x-iems-delivery-id'], delivery._id);
    assert.deepEqual(data[0].envelopeTo, [delivery.recipient]);
    assert.equal(data[0].body.replaceAll('\r\n', '\n'), body);
    assert.equal(data[0].receiptStatus, 'Accepted by local mail sink');
  });
  await t.test('normal restart retains exactly the accepted receipt', async () => {
    await sink.stop();
    restarted = createSmtpSink({ smtpPort: 0, httpPort: 0, token, dataFile });
    await restarted.start();
    assert.equal(restarted.emails.length, 1);
    assert.equal(restarted.emails[0].headers['message-id'], delivery.messageId);
  });
});
