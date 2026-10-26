import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';

const key = () => randomUUID();

test('IEMS Customer Service Automation Center API endpoints and contracts', { timeout: 900000 }, async t => {
  const h = await startOwned(t);
  const { db, runtime, ok, alpha, beta, seeded, send, setRoles } = h;
  const [a, b] = seeded;

  const post = (path, body, cookie = alpha, k = key()) =>
    send(path, { body, cookie, headers: k === null ? {} : { 'idempotency-key': k } });
  const get = (path, cookie = alpha) => send(path, { cookie });

  // Create an initial synthetic ticket for testing
  const now = new Date();
  const ticketId1 = randomUUID();
  const ticketId2 = randomUUID();
  const conversationId1 = randomUUID();

  await db.collection('cs_tickets').insertMany([
    {
      _id: ticketId1,
      draftId: randomUUID(),
      tenantId: a.tenantId,
      plantId: a.plantId,
      ticketNumber: 1001,
      customerId: randomUUID(),
      bindingId: randomUUID(),
      stage: 'NEW',
      version: 1,
      requiresHuman: false,
      createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 mins ago (breached SLA)
      updatedAt: new Date(Date.now() - 30 * 60 * 1000)
    },
    {
      _id: ticketId2,
      draftId: randomUUID(),
      tenantId: a.tenantId,
      plantId: a.plantId,
      ticketNumber: 1002,
      customerId: randomUUID(),
      bindingId: randomUUID(),
      stage: 'RESOLVED',
      version: 2,
      requiresHuman: false,
      createdAt: new Date(Date.now() - 40 * 60 * 1000),
      resolvedAt: new Date(Date.now() - 5 * 60 * 1000),
      updatedAt: new Date(Date.now() - 5 * 60 * 1000)
    }
  ]);

  await db.collection('cs_conversations').insertOne({
    _id: conversationId1,
    tenantId: a.tenantId,
    plantId: a.plantId,
    customerId: randomUUID(),
    bindingId: randomUUID(),
    mode: 'BOT',
    version: 1,
    createdAt: now,
    updatedAt: now
  });

  await t.test('1. GET /api/cs/automation/status returns engine and workflow status', async () => {
    const res = await get('/cs/automation/status');
    assert.equal(res.status, 200, JSON.stringify(res));
    assert.ok(res.data.engine);
    assert.equal(res.data.engine.n8n.loopbackOnly, true);
    assert.equal(res.data.engine.smtpSink.port, 1025);
    assert.equal(res.data.workflows.length, 3);
    assert.equal(res.data.workflows[0].id, 'wf-sla-escalation');
    assert.equal(res.data.workflows[1].id, 'wf-whatsapp-handoff');
    assert.equal(res.data.workflows[2].id, 'wf-cs-weekly-digest');
  });

  await t.test('2. GET /api/cs/automation/sla-breaches returns only open tickets older than threshold', async () => {
    const res = await get('/cs/automation/sla-breaches?thresholdMinutes=15');
    assert.equal(res.status, 200, JSON.stringify(res));
    assert.equal(res.data.totalBreached, 1);
    assert.equal(res.data.items[0].ticketId, ticketId1);
    assert.equal(res.data.items[0].stage, 'NEW');
    assert.equal(res.data.items[0].expectedVersion, 1);
    assert.ok(res.data.items[0].ageMinutes >= 30);
  });

  await t.test('3. POST /api/cs/automation/recheck provides anti-stale verification', async () => {
    // 3a. Eligible ticket
    const eligibleRes = await post('/cs/automation/recheck', {
      ticketId: ticketId1,
      expectedVersion: 1,
      action: 'ESCALATE'
    });
    assert.equal(eligibleRes.status, 200);
    assert.equal(eligibleRes.data.eligible, true);
    assert.equal(eligibleRes.data.status, 'READY_FOR_EXECUTION');

    // 3b. Already resolved ticket is flagged ineligible
    const resolvedRes = await post('/cs/automation/recheck', {
      ticketId: ticketId2,
      expectedVersion: 2,
      action: 'ESCALATE'
    });
    assert.equal(resolvedRes.status, 200);
    assert.equal(resolvedRes.data.eligible, false);
    assert.equal(resolvedRes.data.status, 'INELIGIBLE_STAGE');
    assert.equal(resolvedRes.data.reason, 'TICKET_ALREADY_RESOLVED_OR_CLOSED');

    // 3c. Version mismatch is flagged ineligible (concurrent modification)
    const mismatchRes = await post('/cs/automation/recheck', {
      ticketId: ticketId1,
      expectedVersion: 99,
      action: 'ESCALATE'
    });
    assert.equal(mismatchRes.status, 200);
    assert.equal(mismatchRes.data.eligible, false);
    assert.equal(mismatchRes.data.status, 'STALE_VERSION');
  });

  await t.test('4. POST /api/cs/automation/escalate executes atomic, idempotent escalation', async () => {
    // 4a. Missing Idempotency-Key is rejected
    const noKey = await post('/cs/automation/escalate', {
      ticketId: ticketId1,
      expectedVersion: 1,
      reason: 'SLA target exceeded'
    }, alpha, null);
    assert.equal(noKey.status, 400);

    // 4b. Successful escalation
    const idemKey = 'test-escalate-key-' + key().slice(0, 20);
    const escRes = await post('/cs/automation/escalate', {
      ticketId: ticketId1,
      expectedVersion: 1,
      reason: 'Response breached 15 minute limit'
    }, alpha, idemKey);

    assert.equal(escRes.status, 200, JSON.stringify(escRes));
    assert.equal(escRes.data.ticketId, ticketId1);
    assert.equal(escRes.data.previousStage, 'NEW');
    assert.equal(escRes.data.newStage, 'TRIAGED');
    assert.equal(escRes.data.version, 2);
    assert.equal(escRes.data.replayed, false);

    // Verify DB update and internal note
    const updatedTicket = await db.collection('cs_tickets').findOne({ _id: ticketId1 });
    assert.equal(updatedTicket.stage, 'TRIAGED');
    assert.equal(updatedTicket.version, 2);
    assert.equal(updatedTicket.requiresHuman, true);

    const note = await db.collection('cs_internal_notes').findOne({ ticketId: ticketId1 });
    assert.ok(note);
    assert.match(note.text, /AUTOMATED SLA ESCALATION/);

    // 4c. Idempotent replay with same key returns cached result without double execution
    const replayRes = await post('/cs/automation/escalate', {
      ticketId: ticketId1,
      expectedVersion: 1,
      reason: 'Response breached 15 minute limit'
    }, alpha, idemKey);

    assert.equal(replayRes.status, 200);
    assert.equal(replayRes.data.replayed, true);
    assert.equal(replayRes.data.version, 2);

    // Ensure version and note count did not change
    const checkTicket = await db.collection('cs_tickets').findOne({ _id: ticketId1 });
    assert.equal(checkTicket.version, 2);
    const noteCount = await db.collection('cs_internal_notes').countDocuments({ ticketId: ticketId1 });
    assert.equal(noteCount, 1);

    // 4d. Anti-stale guard: Trying to escalate resolved ticket fails
    const failRes = await post('/cs/automation/escalate', {
      ticketId: ticketId2,
      expectedVersion: 2,
      reason: 'Should fail'
    });
    assert.equal(failRes.status, 409);
    assert.equal(failRes.error.code, 'ELIGIBILITY_CHECK_FAILED');
  });

  await t.test('5. POST /api/cs/automation/whatsapp-handoff syncs handoff with strict PREVIEWED state', async () => {
    const handoffKey = 'handoff-key-' + key().slice(0, 20);
    const res = await post('/cs/automation/whatsapp-handoff', {
      conversationId: conversationId1,
      ticketId: ticketId1,
      bindingId: randomUUID(),
      operatorNote: 'Customer needs technical tier 2 support'
    }, alpha, handoffKey);

    assert.equal(res.status, 200, JSON.stringify(res));
    assert.equal(res.data.whatsappState, 'PREVIEWED');
    assert.equal(res.data.channelAccount, 'SIMULATED');
    assert.equal(res.data.mode, 'HUMAN_TAKEN_OVER');
    assert.equal(res.data.replayed, false);

    // Verify conversation updated
    const conv = await db.collection('cs_conversations').findOne({ _id: conversationId1 });
    assert.equal(conv.mode, 'HUMAN_TAKEN_OVER');

    // Replay with same key
    const replayHandoff = await post('/cs/automation/whatsapp-handoff', {
      conversationId: conversationId1,
      ticketId: ticketId1,
      bindingId: randomUUID(),
      operatorNote: 'Customer needs technical tier 2 support'
    }, alpha, handoffKey);

    assert.equal(replayHandoff.status, 200);
    assert.equal(replayHandoff.data.replayed, true);
    assert.equal(replayHandoff.data.whatsappState, 'PREVIEWED');
  });

  await t.test('6. GET /api/cs/automation/digest and POST /api/cs/automation/digest/record', async () => {
    const digestGet = await get('/cs/automation/digest?days=7');
    assert.equal(digestGet.status, 200);
    assert.ok(digestGet.data.summary);
    assert.ok(digestGet.data.markdown.includes('IEMS Customer Service Operations Digest'));
    assert.ok(digestGet.data.html.includes('Accepted by local mail sink'));

    const digestKey = 'digest-key-' + key().slice(0, 20);
    const digestPost = await post('/cs/automation/digest/record', {
      summary: digestGet.data.summary,
      recipientEmail: 'reports@iems.local',
      subject: 'Weekly CS Operations Digest',
      sinkMessageId: 'msg-' + key()
    }, alpha, digestKey);

    assert.equal(digestPost.status, 201);
    assert.equal(digestPost.data.receiptStatus, 'Accepted by local mail sink');
    assert.equal(digestPost.data.replayed, false);

    // Verify record in database
    const saved = await db.collection('automation_digests').findOne({ _id: digestPost.data._id });
    assert.ok(saved);
    assert.equal(saved.recipientEmail, 'reports@iems.local');
  });

  await t.test('7. GET /api/cs/automation/audit-logs returns complete history with filtering', async () => {
    const logs = await get('/cs/automation/audit-logs?workflowId=wf-sla-escalation');
    assert.equal(logs.status, 200);
    assert.ok(logs.data.length >= 1);
    assert.equal(logs.data[0].workflowId, 'wf-sla-escalation');
    assert.equal(logs.data[0].action, 'TICKET_ESCALATE');
    assert.equal(logs.data[0].status, 'SUCCESS');
    assert.equal(logs.data[0].reconciliationState, 'CONFIRMED');
  });

  await t.test('8. POST /api/cs/automation/reconcile identifies pending reconciliation', async () => {
    const rec = await post('/cs/automation/reconcile', {});
    assert.equal(rec.status, 200);
    assert.ok(rec.data.reconciledAt);
  });

  await t.test('9. Tenant isolation and permission checks', async () => {
    // Beta tenant cannot access Alpha automation status or tickets
    const betaStatus = await get('/cs/automation/status', beta);
    assert.equal(betaStatus.status, 200);
    // Beta has 0 tickets and 0 automations
    assert.equal(betaStatus.data.metrics.openTicketsCount, 0);
    assert.equal(betaStatus.data.metrics.totalAutomationsExecuted, 0);

    // Beta cannot escalate Alpha ticket
    const betaEsc = await post('/cs/automation/escalate', {
      ticketId: ticketId1,
      expectedVersion: 2,
      reason: 'Cross-tenant attack attempt'
    }, beta);
    assert.equal(betaEsc.status, 404);
  });
});
