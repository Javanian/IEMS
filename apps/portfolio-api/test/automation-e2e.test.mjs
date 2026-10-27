import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';
import { complaintThroughApi, resolveThroughApi } from './support/automation-fixtures.mjs';
import { executeWorkflow1_SlaEscalation, executeWorkflow3_WeeklyDigest, executeWorkflow4_ApprovedResolution } from '../../../ops/automation-lab/run-workflow.mjs';

// Development helper HTTP integration only. These tests do not start or execute n8n.
test('development API helpers preserve authoritative escalation, approval and delivery state', { timeout: 900000 }, async t => {
  const h = await startOwned(t, { automation: { slaMinutes: 0, smtpPort: 1 } });
  const fixture = await complaintThroughApi(h);
  const options = { apiBase: h.base, cookie: h.alpha };
  const occurrence = `sla:${fixture.ticket.ticketId}:v1`;
  await t.test('SLA helper records only its authoritative internal effect and is replay-safe', async () => {
    const first = await executeWorkflow1_SlaEscalation({ ...options, ticketId: fixture.ticket.ticketId, expectedVersion: 1, idempotencyKey: occurrence });
    assert.equal(first.escalation.stage, 'NEW');
    assert.equal(first.escalation.isEscalated, true);
    assert.equal(await h.db.collection('cs_internal_notes').countDocuments({ ticketId: fixture.ticket.ticketId }), 1);
    assert.equal(await h.db.collection('cs_outbox').countDocuments({ origin: 'AUTOMATION' }), 0);
  });
  await t.test('digest helper cannot turn unavailable SMTP into accepted local delivery', async () => {
    const result = await executeWorkflow3_WeeklyDigest({ ...options, idempotencyKey: 'helper-digest-occurrence-001', mode: 'DEMO', periodKey: 'helper-occurrence-001' });
    const record = result.record || result;
    assert.equal(record.deliveryState, 'FAILED', JSON.stringify(result));
    assert.equal(record.sinkMessageId, null);
  });
  await t.test('resolution helper dispatches only a separately approved resolved-ticket draft', async () => {
    const ticket = await resolveThroughApi(h, fixture.ticket.ticketId);
    const created = await h.send('/cs/automation/resolution-draft', { body: { ticketId: ticket.ticketId, expectedTicketVersion: ticket.version, channel: 'SIMULATED', recipient: 'synthetic@iems.local', proposedResolution: 'Synthetic helper acceptance notification.' }, headers: { 'idempotency-key': randomUUID() } });
    assert.equal(created.status, 201, JSON.stringify(created));
    const draft = created.data;
    await assert.rejects(executeWorkflow4_ApprovedResolution({ ...options, draftId: draft.draftId }), /APPROVED|approved|409/);
    const approval = await h.send(`/cs/automation/resolution-drafts/${draft.draftId}/approve`, { body: { expectedVersion: draft.version } });
    assert.equal(approval.status, 200, JSON.stringify(approval));
    const result = await executeWorkflow4_ApprovedResolution({ ...options, draftId: draft.draftId });
    const delivery = result.dispatch || result;
    assert.equal(delivery.deliveryState, 'PREVIEWED', JSON.stringify(result));
    assert.equal((await h.send(`/cs/tickets/${ticket.ticketId}`)).data.version, ticket.version);
  });
});
