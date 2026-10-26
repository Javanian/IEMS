import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';
import { createSmtpSink } from '../../../ops/automation-lab/smtp-sink.mjs';
import {
  executeWorkflow1_SlaEscalation,
  executeWorkflow2_WhatsAppHandoff,
  executeWorkflow3_WeeklyDigest
} from '../../../ops/automation-lab/run-workflow.mjs';

const key = () => randomUUID();

test('IEMS Customer Service Automation End-to-End Demonstration', { timeout: 900000 }, async t => {
  // Start Local SMTP Sink on isolated test ports
  const smtpPort = 10255;
  const httpPort = 10805;
  const sink = createSmtpSink({ smtpPort, httpPort });
  await sink.start();

  const h = await startOwned(t);
  const { db, runtime, ok, alpha, beta, seeded, send, base: apiBase } = h;
  const [a] = seeded;

  // Insert initial fixtures
  const ticketId = randomUUID();
  const convId = randomUUID();
  const resolvedTicketId = randomUUID();

  await db.collection('cs_tickets').insertMany([
    {
      _id: ticketId,
      draftId: randomUUID(),
      tenantId: a.tenantId,
      plantId: a.plantId,
      ticketNumber: 2001,
      customerId: randomUUID(),
      bindingId: randomUUID(),
      stage: 'NEW',
      version: 1,
      requiresHuman: false,
      createdAt: new Date(Date.now() - 25 * 60 * 1000), // 25m ago (breached SLA)
      updatedAt: new Date(Date.now() - 25 * 60 * 1000)
    },
    {
      _id: resolvedTicketId,
      draftId: randomUUID(),
      tenantId: a.tenantId,
      plantId: a.plantId,
      ticketNumber: 2002,
      customerId: randomUUID(),
      bindingId: randomUUID(),
      stage: 'RESOLVED',
      version: 3,
      requiresHuman: false,
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      resolvedAt: new Date(Date.now() - 10 * 60 * 1000),
      updatedAt: new Date(Date.now() - 10 * 60 * 1000)
    }
  ]);

  await db.collection('cs_conversations').insertOne({
    _id: convId,
    tenantId: a.tenantId,
    plantId: a.plantId,
    customerId: randomUUID(),
    bindingId: randomUUID(),
    mode: 'BOT',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const cookie = alpha;

  await t.test('Workflow 1: SLA Monitor & Re-check Escalation with Local SMTP Sink', async () => {
    const result = await executeWorkflow1_SlaEscalation({
      apiBase,
      cookie,
      ticketId,
      expectedVersion: 1,
      smtpPort
    });

    assert.equal(result.eligible, true);
    assert.equal(result.escalation.previousStage, 'NEW');
    assert.equal(result.escalation.newStage, 'TRIAGED');
    assert.equal(result.escalation.version, 2);

    // Verify local mail sink received the escalation alert
    const emailsRes = await fetch(`http://127.0.0.1:${httpPort}/api/emails`);
    const emailsJson = await emailsRes.json();
    assert.ok(emailsJson.data.length >= 1);
    const alertEmail = emailsJson.data.find(e => e.subject.includes('[SLA BREACH ALERT]'));
    assert.ok(alertEmail, 'Escalation alert email captured by sink');
    assert.equal(alertEmail.receiptStatus, 'Accepted by local mail sink');
  });

  await t.test('Workflow 1 Guard: Race condition / Stale trigger is gracefully rejected', async () => {
    // Ticket is now at stage TRIAGED, version 2. If a workflow runs with old expectedVersion 1:
    const staleResult = await executeWorkflow1_SlaEscalation({
      apiBase,
      cookie,
      ticketId,
      expectedVersion: 1,
      smtpPort
    });

    assert.equal(staleResult.eligible, false);
    assert.equal(staleResult.recheck.status, 'STALE_VERSION');

    // And if ticket is already RESOLVED:
    const resolvedResult = await executeWorkflow1_SlaEscalation({
      apiBase,
      cookie,
      ticketId: resolvedTicketId,
      expectedVersion: 3,
      smtpPort
    });

    assert.equal(resolvedResult.eligible, false);
    assert.equal(resolvedResult.recheck.status, 'INELIGIBLE_STAGE');
  });

  await t.test('Workflow 2: WhatsApp Approval & Hand-off Sync (PREVIEWED Guarantee)', async () => {
    const handoff = await executeWorkflow2_WhatsAppHandoff({
      apiBase,
      cookie,
      conversationId: convId,
      ticketId
    });

    assert.equal(handoff.whatsappState, 'PREVIEWED');
    assert.equal(handoff.mode, 'HUMAN_TAKEN_OVER');
    assert.match(handoff.disclaimer, /Preview only/);

    const conv = await db.collection('cs_conversations').findOne({ _id: convId });
    assert.equal(conv.mode, 'HUMAN_TAKEN_OVER');
  });

  await t.test('Workflow 3: Weekly Operations Digest dispatched to SMTP sink', async () => {
    const digest = await executeWorkflow3_WeeklyDigest({
      apiBase,
      cookie,
      smtpPort
    });

    assert.ok(digest._id);
    assert.equal(digest.receiptStatus, 'Accepted by local mail sink');

    // Verify sink captured digest email
    const emailsRes = await fetch(`http://127.0.0.1:${httpPort}/api/emails`);
    const emailsJson = await emailsRes.json();
    const digestEmail = emailsJson.data.find(e => e.subject.includes('Weekly CS Operations Digest'));
    assert.ok(digestEmail, 'Digest email captured by sink');
    assert.equal(digestEmail.to, 'reports@iems.local');
    assert.equal(digestEmail.receiptStatus, 'Accepted by local mail sink');
  });

  await t.test('Durable Reconciliation Check', async () => {
    const recRes = await fetch(`${apiBase}/api/cs/automation/reconcile`, {
      method: 'POST',
      headers: { origin: 'http://localhost:4173', Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const rec = await recRes.json();
    assert.equal(recRes.status, 200);
    assert.ok(rec.data.reconciledAt);
  });

  await sink.stop();
});
