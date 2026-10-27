import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';
import { complaintThroughApi, resolveThroughApi } from './support/automation-fixtures.mjs';

test('Automation Center supported operator journey over HTTP and owned MongoDB', { timeout: 900000 }, async t => {
  const h = await startOwned(t, { automation: { slaMinutes: 0 } });
  const post = (path, body = {}, key = randomUUID(), cookie = h.alpha, headers = {}) => h.send(`/cs/automation${path}`, { body, cookie, headers: { 'idempotency-key': key, ...headers } });
  const fixture = await complaintThroughApi(h);
  let current, draft;

  await t.test('current workflow state is observed and SLA due time is derived from stored complaint', async () => {
    const status = await h.send('/cs/automation/status');
    assert.equal(status.status, 200);
    assert.equal(status.data.policy.label, 'Demo SLA');
    assert.ok(status.data.workflows.every(w => w.state === 'NOT_OBSERVED'));
    const due = await h.send('/cs/automation/sla-breaches');
    assert.equal(due.status, 200); assert.equal(due.data.totalBreached, 1);
    assert.equal(due.data.items[0].ticketId, fixture.ticket.ticketId);
    const stored = await h.db.collection('automation_tasks').findOne({ ticketId: fixture.ticket.ticketId });
    assert.equal(stored.policyMinutes, 0);
    assert.equal(new Date(stored.dueAt).getTime(), new Date(due.data.items[0].createdAt).getTime());
  });
  await t.test('one escalation records internal domain history and preserves unassigned NEW stage', async () => {
    const body = { ticketId: fixture.ticket.ticketId, expectedVersion: 1, reason: 'Synthetic zero-minute Demo SLA occurrence' }, occurrence = randomUUID();
    const result = await post('/escalate', body, occurrence);
    assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.data.stage, 'NEW');
    assert.equal(result.data.isEscalated, true);
    const repeated = await post('/escalate', body, occurrence);
    assert.equal(repeated.status, 200); assert.equal(repeated.data.replayed, true);
    const ticket = await h.send(`/cs/tickets/${fixture.ticket.ticketId}`);
    assert.equal(ticket.data.stage, 'NEW'); assert.equal(ticket.data.assigneeId, null);
    assert.equal(ticket.data.history.filter(e => e.kind === 'SLA_ESCALATED').length, 1);
    assert.ok(!ticket.data.history.some(e => e.toStage === 'ASSIGNED'));
    const stale = await post('/escalate', { ...body, expectedVersion: 2 });
    assert.equal(stale.status, 409);
  });
  await t.test('operator resolves through domain transition before preparing a notification', async () => {
    const unresolved = await post('/resolution-draft', { ticketId: fixture.ticket.ticketId, expectedTicketVersion: 2, channel: 'SIMULATED', recipient: 'synthetic@iems.local', proposedResolution: 'Synthetic issue repaired and inspected.' });
    assert.equal(unresolved.status, 409);
    current = await resolveThroughApi(h, fixture.ticket.ticketId);
    const result = await post('/resolution-draft', { ticketId: current.ticketId, expectedTicketVersion: current.version, channel: 'SIMULATED', recipient: 'synthetic@iems.local', proposedResolution: 'Synthetic issue repaired and inspected.' });
    assert.equal(result.status, 201, JSON.stringify(result)); draft = result.data;
    assert.equal(draft.status, 'PENDING_APPROVAL'); assert.equal(draft.recipientPolicy, 'SYNTHETIC_LOCAL_OPERATOR_APPROVAL');
  });
  await t.test('approval is versioned, dispatch overrides fail, preview never claims email acceptance', async () => {
    const path = `/resolution-drafts/${draft.draftId}`;
    assert.equal((await post(`${path}/dispatch`)).status, 409);
    assert.equal((await post(`${path}/approve`, { expectedVersion: 99 })).status, 409);
    const approved = await post(`${path}/approve`, { expectedVersion: draft.version });
    assert.equal(approved.status, 200, JSON.stringify(approved));
    assert.equal((await post(`${path}/dispatch`, { recipient: 'other@iems.local' })).status, 400);
    const occurrence = `resolution:${draft.draftId}`;
    const sent = await post(`${path}/dispatch`, {}, occurrence);
    assert.equal(sent.status, 200, JSON.stringify(sent)); assert.equal(sent.data.deliveryState, 'PREVIEWED');
    assert.equal(sent.data.sinkMessageId, null);
    const replay = await post(`${path}/dispatch`, {}, occurrence);
    assert.equal(replay.status, 200); assert.equal(replay.data.deliveryState, 'PREVIEWED');
    const after = (await h.send(`/cs/tickets/${current.ticketId}`)).data;
    assert.equal(after.stage, 'RESOLVED'); assert.equal(after.version, current.version);
  });
  await t.test('machine service credential has minimum grants and cannot become a human session', async () => {
    const issued = await post('/service-credentials', { label: 'Synthetic acceptance service', ttlMinutes: 10 });
    assert.equal(issued.status, 201, JSON.stringify(issued));
    const headers = { authorization: `Bearer ${issued.data.token}` };
    assert.equal((await h.send('/cs/automation/digest', { cookie: null, headers })).status, 200);
    assert.equal((await post(`/resolution-drafts/${draft.draftId}/approve`, { expectedVersion: 2 }, randomUUID(), null, headers)).status, 403);
    assert.equal((await h.send('/crm/accounts', { cookie: null, headers })).status, 401);
    assert.equal((await h.send('/cs/automation/digest', { cookie: `portfolio_session=${issued.data.token}` })).status, 401);
    assert.equal((await post(`/service-credentials/${issued.data.sessionId}/revoke`)).status, 200);
    assert.equal((await h.send('/cs/automation/digest', { cookie: null, headers })).status, 401);
  });
  await t.test('tenant-scoped inspector and digest no-data behavior do not fabricate success', async () => {
    const own = await h.send('/cs/automation/sink-messages');
    assert.deepEqual(own.data, []);
    assert.equal((await h.send(`/cs/automation/resolution-drafts/${draft.draftId}`, { cookie: h.beta })).status, 404);
    const digest = await h.send('/cs/automation/digest', { cookie: h.beta });
    assert.equal(digest.data.summary.currentlyOpenCount, 0);
    assert.equal(digest.data.summary.slaComplianceRatePercent, null);
    assert.ok(!digest.data.html.includes('Accepted by local mail sink'));
  });
  await t.test('fractional Demo SLA policy produces an occurrence key accepted by its mutation API', async () => {
    h.runtime.automation.slaMinutes = 1 / 60000;
    try {
      const next = await complaintThroughApi(h);
      await new Promise(resolve => setTimeout(resolve, 10));
      const due = await h.send('/cs/automation/sla-breaches');
      const occurrence = due.data.items.find(row => row.ticketId === next.ticket.ticketId);
      assert.ok(occurrence, JSON.stringify(due));
      assert.match(occurrence.occurrenceKey, /^[A-Za-z0-9:_-]{8,120}$/);
      const result = await post('/escalate', { ticketId: occurrence.ticketId, expectedVersion: occurrence.expectedVersion }, occurrence.occurrenceKey);
      assert.equal(result.status, 200, JSON.stringify(result));
    } finally { h.runtime.automation.slaMinutes = 0; }
  });
  await t.test('workflow observations retain each workflow and label scheduled domain evidence honestly', async () => {
    // These rows are status projection fixtures, not claims of an executed n8n engine.
    const s = { tenantId: h.seeded[0].tenantId, plantId: h.seeded[0].plantId };
    const earlier = new Date(Date.now() - 10000);
    await h.db.collection('automation_engine_runs').insertOne({ _id: randomUUID(), ...s, workflowId: 'wf-cs-weekly-digest', executionId: 'fixture-digest', state: 'ENGINE_ACKNOWLEDGED', observedAt: earlier, completedAt: earlier });
    await h.db.collection('automation_engine_runs').insertMany(Array.from({ length: 25 }, () => ({ _id: randomUUID(), ...s, workflowId: 'wf-sla-escalation', state: 'FAILED', observedAt: new Date(), completedAt: new Date() })));
    await h.db.collection('automation_audit_logs').insertOne({ _id: randomUUID(), ...s, workflowId: 'wf-approved-resolution', action: 'RESOLUTION_DELIVERY_RESULT', executionId: 'fixture-scheduled', status: 'UNKNOWN', result: { deliveryState: 'UNKNOWN' }, occurredAt: new Date() });
    const status = await h.send('/cs/automation/status');
    assert.equal(status.status, 200, JSON.stringify(status));
    assert.equal(status.data.workflows.find(w => w.id === 'wf-cs-weekly-digest').lastRun.executionId, 'fixture-digest');
    assert.equal(status.data.workflows.find(w => w.id === 'wf-approved-resolution').state, 'UNKNOWN');
    assert.equal(status.data.workflows.find(w => w.id === 'wf-approved-resolution').lastRun.observationSource, 'IEMS_DOMAIN_AUDIT');
    await h.db.collection('automation_audit_logs').insertOne({ _id: randomUUID(), ...s, workflowId: 'wf-approved-resolution', action: 'RESOLUTION_DELIVERY_RESULT', executionId: 'fixture-scheduled-success', status: 'SUCCESS', result: { deliveryState: 'ACCEPTED_LOCAL' }, occurredAt: new Date(Date.now() + 1) });
    const updated = await h.send('/cs/automation/status');
    assert.equal(updated.data.workflows.find(w => w.id === 'wf-approved-resolution').state, 'DOMAIN_EFFECT_RECORDED');
  });
});
