import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startOwned } from './support/owned-mongo.mjs';
import { createSmtpSink } from '../../../ops/automation-lab/smtp-sink.mjs';

// Direct DB inserts below are adversarial fixtures, not supported-API demo seed proof.
test('independent corrective acceptance: authoritative API with owned real MongoDB', { timeout: 900000 }, async t => {
  const h = await startOwned(t);
  const [a] = h.seeded;
  const post = (path, body = {}, key = randomUUID(), cookie = h.alpha) => h.send(`/cs/automation${path}`, { body, cookie, headers: { 'idempotency-key': key } });
  const ticket = async (overrides = {}) => {
    const row = { _id: randomUUID(), draftId: randomUUID(), tenantId: a.tenantId, plantId: a.plantId,
      ticketNumber: Math.floor(Math.random() * 1000000), customerId: randomUUID(), bindingId: randomUUID(),
      stage: 'NEW', version: 1, createdAt: new Date(Date.now() - 3600000), updatedAt: new Date(), ...overrides };
    await h.db.collection('cs_tickets').insertOne(row);
    await h.db.collection('cs_contact_bindings').insertOne({ _id: row.bindingId, tenantId: row.tenantId, plantId: row.plantId,
      customerId: row.customerId, synthetic: true, channelAccountId: 'SIMULATED', providerContactId: randomUUID(), status: 'ACTIVE', version: 1, expiresAt: new Date(Date.now() + 3600000) });
    return row;
  };
  const draft = row => post('/resolution-draft', { ticketId: row._id, expectedTicketVersion: row.version,
    channel: 'EMAIL', recipient: 'synthetic-qa@iems.local', proposedResolution: 'Synthetic resolution update approved for local testing.' });
  const rawApprovedDraft = async row => {
    const id = randomUUID();
    await h.db.collection('cs_resolution_drafts').insertOne({ _id: id, tenantId: a.tenantId, plantId: a.plantId,
      ticketId: row._id, ticketNumber: row.ticketNumber, expectedTicketVersion: row.version, version: 2,
      channel: 'EMAIL', recipient: 'synthetic-qa@iems.local', proposedResolution: 'Synthetic resolved update.',
      status: 'APPROVED', approvedBy: 'synthetic-operator', createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000) });
    return id;
  };

  await t.test('N05 assigned tickets cannot be escalated even with matching source version', async () => {
    const row = await ticket({ stage: 'ASSIGNED', assigneeId: randomUUID() });
    const r = await post('/escalate', { ticketId: row._id, expectedVersion: row.version });
    assert.equal(r.status, 409, JSON.stringify(r));
    assert.equal((await h.db.collection('cs_tickets').findOne({ _id: row._id })).version, row.version);
  });

  await t.test('N05 recent tickets cannot bypass authoritative SLA eligibility', async () => {
    const row = await ticket({ createdAt: new Date() });
    const r = await post('/escalate', { ticketId: row._id, expectedVersion: row.version });
    assert.equal(r.status, 409, JSON.stringify(r));
  });

  await t.test('N04 legacy replay lacking required metadata fails closed', async () => {
    const row = await ticket();
    const key = randomUUID();
    await h.db.collection('automation_audit_logs').insertOne({ _id: randomUUID(), tenantId: a.tenantId,
      idempotencyKey: key, action: 'TICKET_ESCALATE', result: { leakedHistoricalResult: true }, occurredAt: new Date() });
    const r = await post('/escalate', { ticketId: row._id, expectedVersion: row.version, reason: 'Changed payload' }, key);
    assert.equal(r.status, 409, JSON.stringify(r));
    assert.equal(r.data?.leakedHistoricalResult, undefined);
  });

  await t.test('N07 resolved ticket can produce resolution notification draft', async () => {
    const row = await ticket({ stage: 'RESOLVED', resolvedAt: new Date(), resolutionText: 'Synthetic resolution.' });
    const r = await draft(row);
    assert.equal(r.status, 201, JSON.stringify(r));
    assert.equal((await h.db.collection('cs_tickets').findOne({ _id: row._id })).stage, 'RESOLVED');
  });

  await t.test('N07 unresolved ticket cannot create resolution notification draft', async () => {
    const row = await ticket();
    const r = await draft(row);
    assert.equal(r.status, 409, JSON.stringify(r));
  });

  await t.test('N08 caller fabricated sink receipt is never accepted', async () => {
    const row = await ticket();
    const id = await rawApprovedDraft(row);
    const r = await post(`/resolution-drafts/${id}/dispatch`, { sinkMessageId: 'fabricated-proof-123456' });
    assert.ok(r.status >= 400, JSON.stringify(r));
    assert.notEqual(r.data?.deliveryState, 'DELIVERED');
    assert.equal((await h.db.collection('cs_tickets').findOne({ _id: row._id })).stage, 'NEW');
  });

  await t.test('N08 digest cannot record a non-existent sink receipt', async () => {
    const r = await post('/digest/record', { recipientEmail: 'synthetic-qa@iems.local', subject: 'Synthetic QA',
      summary: { currentlyOpenCount: 0 }, sinkMessageId: 'fabricated-digest-proof-123456' });
    assert.ok(r.status >= 400, JSON.stringify(r));
  });

  await t.test('N13 digest total exceeds paginated preview limit truthfully', async () => {
    await Promise.all(Array.from({ length: 25 }, () => ticket()));
    const expected = await h.db.collection('cs_tickets').countDocuments({ tenantId: a.tenantId, plantId: a.plantId, stage: { $nin: ['RESOLVED', 'CLOSED', 'CANCELLED'] } });
    const r = await h.send('/cs/automation/digest');
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.data.summary.currentlyOpenCount, expected, JSON.stringify(r.data.summary));
  });

  await t.test('N13 no-data SLA metric cannot claim 100 percent compliance', async () => {
    const r = await h.send('/cs/automation/digest', { cookie: h.beta });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.data.summary.slaComplianceRatePercent, null, JSON.stringify(r.data.summary));
  });
});

test('independent corrective acceptance: concurrency, service authority and real SMTP failure recovery', { timeout: 900000 }, async t => {
  const sinkToken = randomUUID();
  const ownedRoot = process.platform === 'win32' ? 'D:/IEMS-Automation-Lab/qa-owned-tests' : join(tmpdir(), 'iems-qa-owned-tests');
  await mkdir(ownedRoot, { recursive: true });
  const dataDir = await mkdtemp(join(ownedRoot, 'corrective-'));
  let sink = createSmtpSink({ smtpPort: 0, httpPort: 0, token: sinkToken, dataFile: join(dataDir, 'smtp.jsonl') });
  const ports = await sink.start();
  t.after(async () => { if (sink) await sink.stop(); });
  const h = await startOwned(t);
  const [a, b] = h.seeded;
  const cfg = h.runtime.automation ||= {};
  Object.assign(cfg, { smtpPort: ports.smtpPort, sinkUrl: `http://127.0.0.1:${ports.httpPort}`, sinkToken, leaseMs: 1000 });
  const post = (path, body = {}, key = randomUUID(), cookie = h.alpha, headers = {}) => h.send(`/cs/automation${path}`, { body, cookie, headers: { 'idempotency-key': key, ...headers } });
  let number = 700000;
  const ticket = async (overrides = {}) => {
    const row = { _id: randomUUID(), draftId: randomUUID(), tenantId: a.tenantId, plantId: a.plantId,
      ticketNumber: ++number, customerId: randomUUID(), bindingId: randomUUID(), stage: 'NEW', version: 1,
      createdAt: new Date(Date.now() - 3600000), updatedAt: new Date(), ...overrides };
    await h.db.collection('cs_tickets').insertOne(row);
    await h.db.collection('cs_contact_bindings').insertOne({ _id: row.bindingId, tenantId: row.tenantId, plantId: row.plantId,
      customerId: row.customerId, synthetic: true, channelAccountId: 'SIMULATED', providerContactId: randomUUID(), status: 'ACTIVE', version: 1, expiresAt: new Date(Date.now() + 3600000) });
    return row;
  };
  const resolved = () => ticket({ stage: 'RESOLVED', resolvedAt: new Date(), resolutionText: 'Synthetic issue resolved.' });
  const createDraft = async (row, key = randomUUID(), overrides = {}) => {
    const r = await post('/resolution-draft', { ticketId: row._id, expectedTicketVersion: row.version,
      channel: 'EMAIL', recipient: 'synthetic-qa@iems.local', proposedResolution: 'Synthetic resolved notification for local receipt verification.', ...overrides }, key);
    assert.equal(r.status, 201, JSON.stringify(r));
    return r.data;
  };
  const draftId = d => d.draftId || d._id;
  const approve = async d => {
    const r = await post(`/resolution-drafts/${draftId(d)}/approve`, { expectedVersion: d.version });
    assert.equal(r.status, 200, JSON.stringify(r));
    return r.data;
  };
  const approved = async () => { const row = await resolved(); const d = await createDraft(row); await approve(d); return { row, d, id: draftId(d) }; };
  const accepted = r => {
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.data.deliveryState, 'ACCEPTED_LOCAL', JSON.stringify(r));
  };

  await t.test('N03 concurrent same-key SLA requests converge on one atomic effect', async () => {
    const row = await ticket(); const key = randomUUID();
    const body = { ticketId: row._id, expectedVersion: row.version, reason: 'Concurrent synthetic SLA occurrence' };
    const responses = await Promise.all([post('/escalate', body, key), post('/escalate', body, key)]);
    assert.deepEqual(responses.map(r => r.status), [200, 200], JSON.stringify(responses));
    assert.equal(await h.db.collection('automation_audit_logs').countDocuments({ tenantId: a.tenantId, idempotencyKey: key }), 1);
    assert.equal(await h.db.collection('cs_internal_notes').countDocuments({ ticketId: row._id }), 1);
    const current = await h.db.collection('cs_tickets').findOne({ _id: row._id });
    assert.equal(current.version, 2); assert.equal(current.stage, 'NEW');
  });

  await t.test('N04 reused occurrence key rejects changed payload, entity and scope', async () => {
    const row = await ticket(); const other = await ticket(); const key = randomUUID();
    const body = { ticketId: row._id, expectedVersion: 1, reason: 'Synthetic original occurrence' };
    assert.equal((await post('/escalate', body, key)).status, 200);
    assert.equal((await post('/escalate', { ...body, reason: 'Changed reason' }, key)).status, 409);
    assert.equal((await post('/escalate', { ...body, ticketId: other._id }, key)).status, 409);
    const changedAction = await post('/resolution-draft', { ticketId: row._id, expectedTicketVersion: 1,
      channel: 'EMAIL', recipient: 'synthetic-qa@iems.local', proposedResolution: 'Synthetic action cannot reuse escalation key.' }, key);
    assert.equal(changedAction.status, 409, JSON.stringify(changedAction));
    const cross = await post('/escalate', { ...body, plantId: b.plantId }, key);
    assert.equal(cross.status, 403, JSON.stringify(cross));
    const denied = await post('/escalate', body, key, h.beta);
    assert.ok(denied.status >= 400, JSON.stringify(denied));
    assert.equal(denied.data?.auditId, undefined);
  });

  await t.test('N03 audit failure rolls back SLA ticket and required history', async () => {
    const row = await ticket(); const key = randomUUID();
    cfg.beforeAudit = async ({ action }) => { if (action === 'TICKET_ESCALATE') throw new Error('Synthetic QA audit unavailable'); };
    try {
      const r = await post('/escalate', { ticketId: row._id, expectedVersion: 1 }, key);
      assert.ok(r.status >= 500, JSON.stringify(r));
      assert.equal((await h.db.collection('cs_tickets').findOne({ _id: row._id })).version, 1);
      assert.equal(await h.db.collection('cs_internal_notes').countDocuments({ ticketId: row._id }), 0);
      assert.equal(await h.db.collection('automation_audit_logs').countDocuments({ idempotencyKey: key }), 0);
    } finally { delete cfg.beforeAudit; }
  });

  await t.test('N05 earlier recheck never authorizes a subsequently assigned or version-changed ticket', async () => {
    const row = await ticket();
    const checked = await post('/recheck', { ticketId: row._id, expectedVersion: 1, action: 'ESCALATE' });
    assert.equal(checked.data.eligible, true, JSON.stringify(checked));
    await h.db.collection('cs_tickets').updateOne({ _id: row._id }, { $set: { stage: 'ASSIGNED', assigneeId: a.userId }, $inc: { version: 1 } });
    const r = await post('/escalate', { ticketId: row._id, expectedVersion: 1 });
    assert.equal(r.status, 409, JSON.stringify(r));
    assert.equal(await h.db.collection('cs_internal_notes').countDocuments({ ticketId: row._id }), 0);
  });

  await t.test('N05 concurrent assignment and SLA writer cannot both commit from one source version', async () => {
    const row = await ticket();
    const [escalation, assignment] = await Promise.all([
      post('/escalate', { ticketId: row._id, expectedVersion: 1 }),
      h.send(`/cs/tickets/${row._id}/stage`, { body: { expectedVersion: 1, toStage: 'ASSIGNED', assigneeId: a.userId,
        reason: 'Synthetic operator wins or loses optimistic race', commandKey: randomUUID() } })
    ]);
    assert.deepEqual([escalation.status, assignment.status].sort(), [200, 409], JSON.stringify({ escalation, assignment }));
    const current = await h.db.collection('cs_tickets').findOne({ _id: row._id });
    assert.equal(current.version, 2);
    if (assignment.status === 200) {
      assert.equal(current.stage, 'ASSIGNED'); assert.notEqual(current.isEscalated, true);
      assert.equal(await h.db.collection('cs_internal_notes').countDocuments({ ticketId: row._id }), 0);
    } else { assert.equal(current.stage, 'NEW'); assert.equal(current.isEscalated, true); }
  });

  await t.test('N03 concurrent draft creation and failed draft audit leave no orphan effects', async () => {
    const row = await resolved(); const key = randomUUID();
    const payload = { ticketId: row._id, expectedTicketVersion: 1, channel: 'EMAIL', recipient: 'synthetic-qa@iems.local', proposedResolution: 'Synthetic concurrent draft content.' };
    const responses = await Promise.all([post('/resolution-draft', payload, key), post('/resolution-draft', payload, key)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 201], JSON.stringify(responses));
    assert.equal(await h.db.collection('cs_resolution_drafts').countDocuments({ ticketId: row._id }), 1);
    const failing = await resolved(); const failKey = randomUUID();
    cfg.beforeAudit = async ({ action }) => { if (action === 'RESOLUTION_DRAFT_CREATE') throw new Error('Synthetic QA draft audit unavailable'); };
    try {
      const r = await post('/resolution-draft', { ...payload, ticketId: failing._id }, failKey);
      assert.ok(r.status >= 500, JSON.stringify(r));
      assert.equal(await h.db.collection('cs_resolution_drafts').countDocuments({ ticketId: failing._id }), 0);
      assert.equal(await h.db.collection('automation_audit_logs').countDocuments({ idempotencyKey: failKey }), 0);
    } finally { delete cfg.beforeAudit; }
  });

  await t.test('N06 pending and rejected drafts never dispatch', async () => {
    const d = await createDraft(await resolved());
    assert.ok((await post(`/resolution-drafts/${draftId(d)}/dispatch`)).status >= 400);
    const rejected = await post(`/resolution-drafts/${draftId(d)}/reject`, { expectedVersion: d.version, reason: 'Synthetic operator rejection' });
    assert.equal(rejected.status, 200, JSON.stringify(rejected));
    assert.ok((await post(`/resolution-drafts/${draftId(d)}/dispatch`)).status >= 400);
  });

  await t.test('N06 unauthorized human, expired draft and cancelled approval cannot dispatch', async () => {
    const d = await createDraft(await resolved());
    const viewer = await h.login('alpha.viewer');
    const denied = await post(`/resolution-drafts/${draftId(d)}/approve`, { expectedVersion: d.version }, randomUUID(), viewer);
    assert.equal(denied.status, 403, JSON.stringify(denied));
    await h.db.collection('cs_resolution_drafts').updateOne({ _id: draftId(d) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await post(`/resolution-drafts/${draftId(d)}/approve`, { expectedVersion: d.version });
    assert.equal(expired.status, 409, JSON.stringify(expired));
    const active = await approved();
    const current = await h.send(`/cs/automation/resolution-drafts/${active.id}`);
    const cancel = await post(`/resolution-drafts/${active.id}/cancel`, { expectedVersion: current.data.version });
    assert.equal(cancel.status, 200, JSON.stringify(cancel));
    assert.ok((await post(`/resolution-drafts/${active.id}/dispatch`)).status >= 400);
  });

  await t.test('N06 approved expiry and changed source invalidate dispatch', async () => {
    const expired = await approved();
    await h.db.collection('cs_resolution_drafts').updateOne({ _id: expired.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.ok((await post(`/resolution-drafts/${expired.id}/dispatch`)).status >= 400);
    const stale = await approved();
    await h.db.collection('cs_tickets').updateOne({ _id: stale.row._id }, { $inc: { version: 1 } });
    assert.ok((await post(`/resolution-drafts/${stale.id}/dispatch`)).status >= 400);
  });

  await t.test('N06 recipient and content cannot be overridden by dispatcher', async () => {
    const { id } = await approved(); const before = sink.emails.length;
    for (const body of [{ recipient: 'other@iems.local' }, { proposedResolution: 'Changed approved content' }, { channel: 'SIMULATED' }]) {
      assert.ok((await post(`/resolution-drafts/${id}/dispatch`, body)).status >= 400, JSON.stringify(body));
    }
    assert.equal(sink.emails.length, before);
  });

  await t.test('N06 changed binding consent, version, expiry and customer invalidate approval', async () => {
    for (const change of [{ status: 'REVOKED' }, { version: 2 }, { expiresAt: new Date(Date.now() - 1000) }, { customerId: randomUUID() }]) {
      const { row, id } = await approved();
      await h.db.collection('cs_contact_bindings').updateOne({ _id: row.bindingId }, { $set: change });
      const before = sink.emails.length;
      const r = await post(`/resolution-drafts/${id}/dispatch`);
      assert.equal(r.status, 409, `${JSON.stringify(change)} ${JSON.stringify(r)}`);
      assert.equal(sink.emails.length, before);
    }
    const row = await resolved();
    await h.db.collection('cs_contact_bindings').deleteOne({ _id: row.bindingId });
    const missing = await post('/resolution-draft', { ticketId: row._id, expectedTicketVersion: 1, channel: 'EMAIL', recipient: 'synthetic-qa@iems.local', proposedResolution: 'Synthetic missing binding must fail closed.' });
    assert.equal(missing.status, 409, JSON.stringify(missing));
  });

  await t.test('N06 approval cannot survive revocation of the approving human membership', async () => {
    const reviewer = h.seeded.find(member => member.username === 'alpha.quality');
    const restoreRoles = await h.setRoles(reviewer, ['csAgent']);
    const reviewerCookie = await h.login(reviewer.username);
    const d = await createDraft(await resolved());
    const response = await post(`/resolution-drafts/${draftId(d)}/approve`, { expectedVersion: d.version }, randomUUID(), reviewerCookie);
    assert.equal(response.status, 200, JSON.stringify(response));
    await h.db.collection('memberships').updateOne({ _id: reviewer.membershipId }, { $set: { active: false } });
    try {
      const r = await post(`/resolution-drafts/${draftId(d)}/dispatch`);
      assert.equal(r.status, 409, JSON.stringify(r));
    } finally {
      await h.db.collection('memberships').updateOne({ _id: reviewer.membershipId }, { $set: { active: true } });
      await restoreRoles();
    }
  });

  await t.test('N06 edited stored recipient or content invalidates immutable approval', async () => {
    for (const changed of [{ recipient: 'changed@iems.local' }, { proposedResolution: 'Synthetic changed stored approved content' }]) {
      const { id } = await approved(); const before = sink.emails.length;
      await h.db.collection('cs_resolution_drafts').updateOne({ _id: id }, { $set: changed });
      const r = await post(`/resolution-drafts/${id}/dispatch`);
      assert.equal(r.status, 409, JSON.stringify(r));
      assert.equal(sink.emails.length, before);
    }
  });

  await t.test('N10 pause orders before new transport and resume uses the durable intended delivery', async () => {
    const { id } = await approved(); const key = randomUUID(); const before = sink.emails.length;
    let queued;
    assert.equal((await post('/pause', { paused: true })).status, 200);
    try {
      const paused = await post(`/resolution-drafts/${id}/dispatch`, {}, key);
      assert.equal(paused.status, 409, JSON.stringify(paused));
      assert.equal(sink.emails.length, before);
      queued = await h.db.collection('cs_outbox').findOne({ draftId: id, origin: 'AUTOMATION' });
      assert.equal(queued.state, 'QUEUED', 'Intent must survive a pre-submit pause as durable queued work');
    } finally { assert.equal((await post('/pause', { paused: false })).status, 200); }
    const recovered = await post('/reconcile');
    assert.equal(recovered.status, 200, JSON.stringify(recovered));
    assert.ok(recovered.data.recoveredDeliveries.some(row => row.deliveryId === queued._id), JSON.stringify(recovered));
    accepted(await post(`/resolution-drafts/${id}/dispatch`, {}, key));
    assert.equal(sink.emails.filter(email => email.headers['x-iems-delivery-id'] === queued._id).length, 1);
  });

  await t.test('N03 N07 N08 real SMTP acceptance, concurrent retry and resolved source stay truthful', async () => {
    const { row, id } = await approved(); const before = sink.emails.length; const key = randomUUID();
    const responses = await Promise.all([post(`/resolution-drafts/${id}/dispatch`, {}, key), post(`/resolution-drafts/${id}/dispatch`, {}, key)]);
    for (const response of responses) {
      assert.equal(response.status, 200, JSON.stringify(response));
      assert.ok(['ACCEPTED_LOCAL', 'SENDING'].includes(response.data.deliveryState), JSON.stringify(response));
    }
    accepted(await post(`/resolution-drafts/${id}/dispatch`, {}, key));
    assert.equal(sink.emails.length, before + 1);
    const current = await h.db.collection('cs_tickets').findOne({ _id: row._id });
    assert.equal(current.stage, 'RESOLVED'); assert.equal(current.version, row.version);
    assert.equal(sink.emails.at(-1).envelopeTo[0], 'synthetic-qa@iems.local');
    assert.match(sink.emails.at(-1).body, /Synthetic resolved notification/);
  });

  await t.test('N12 inspector denies direct unauthenticated read and all HTTP send mutations', async () => {
    const base = `http://127.0.0.1:${ports.httpPort}`;
    assert.equal((await fetch(`${base}/api/emails`)).status, 401);
    assert.equal((await fetch(`${base}/api/emails`, { method: 'POST', headers: { authorization: `Bearer ${sinkToken}` } })).status, 405);
  });

  await t.test('N09 post-submit crash remains UNKNOWN until correlated receipt reconciliation; no resend', async () => {
    const { id } = await approved(); const before = sink.emails.length;
    cfg.afterTransport = async () => { throw new Error('Synthetic QA crash after transport acceptance'); };
    let first;
    try { first = await post(`/resolution-drafts/${id}/dispatch`); } finally { delete cfg.afterTransport; }
    assert.equal(sink.emails.length, before + 1, JSON.stringify(first));
    const listed = await h.send(`/cs/automation/resolution-drafts/${id}`);
    assert.equal(listed.data.deliveryState, 'UNKNOWN', JSON.stringify(listed));
    const uncertainAudit = await h.db.collection('automation_audit_logs').findOne({ 'targetEntity.id': first.data.deliveryId, action: 'RESOLUTION_DELIVERY_RESULT' });
    assert.equal(uncertainAudit.status, 'UNKNOWN');
    assert.equal(uncertainAudit.reconciliationState, 'NEEDS_REVIEW');
    const retry = await post(`/resolution-drafts/${id}/dispatch`);
    assert.ok(retry.status >= 400 || retry.data?.deliveryState === 'UNKNOWN', JSON.stringify(retry));
    assert.equal(sink.emails.length, before + 1);
    const reconciled = await post('/reconcile');
    assert.equal(reconciled.status, 200, JSON.stringify(reconciled));
    const final = await h.send(`/cs/automation/resolution-drafts/${id}`);
    assert.equal(final.data.deliveryState, 'ACCEPTED_LOCAL', JSON.stringify(final));
    assert.equal(sink.emails.filter(email => email.headers['x-iems-delivery-id'] === first.data.deliveryId).length, 1,
      'Reconciliation may recover other approved intents, but must never resend this UNKNOWN occurrence');
  });

  await t.test('N08 unrelated scope, content, message and recipient receipt cannot reconcile UNKNOWN', async () => {
    const { id } = await approved();
    cfg.afterTransport = async () => { throw new Error('Synthetic ambiguous acceptance for receipt binding probes'); };
    try { await post(`/resolution-drafts/${id}/dispatch`); } finally { delete cfg.afterTransport; }
    const receipt = sink.emails.at(-1); const original = structuredClone(receipt);
    const mutations = [
      row => { row.headers['x-iems-tenant-id'] = b.tenantId; },
      row => { row.headers['x-iems-plant-id'] = b.plantId; },
      row => { row.headers['x-iems-delivery-id'] = randomUUID(); },
      row => { row.headers['message-id'] = `<${randomUUID()}@iems.local>`; },
      row => { row.body = 'Synthetic unrelated content'; },
      row => { row.body += ' '; },
      row => { row.envelopeTo = ['other@iems.local']; }
    ];
    for (const mutate of mutations) {
      Object.assign(receipt, structuredClone(original)); mutate(receipt);
      const r = await post('/reconcile'); assert.equal(r.status, 200, JSON.stringify(r));
      const current = await h.send(`/cs/automation/resolution-drafts/${id}`);
      assert.equal(current.data.deliveryState, 'UNKNOWN', JSON.stringify(current));
    }
    Object.assign(receipt, original);
    await post('/reconcile');
    assert.equal((await h.send(`/cs/automation/resolution-drafts/${id}`)).data.deliveryState, 'ACCEPTED_LOCAL');
  });

  await t.test('N10 expired durable SENDING lease reconciles existing receipt without transport repetition', async () => {
    const { id } = await approved();
    const sent = await post(`/resolution-drafts/${id}/dispatch`); accepted(sent);
    const before = sink.emails.length;
    await h.db.collection('cs_outbox').updateOne({ _id: sent.data.deliveryId }, { $set: { state: 'SENDING', deliveryState: 'SENDING', leaseUntil: new Date(Date.now() - 1000), providerMessageId: null } });
    await h.db.collection('cs_resolution_drafts').updateOne({ _id: id }, { $set: { status: 'APPROVED', deliveryState: 'SENDING' } });
    const r = await post('/reconcile'); assert.equal(r.status, 200, JSON.stringify(r));
    assert.ok(r.data.expiredDeliveryIds.includes(sent.data.deliveryId), JSON.stringify(r));
    assert.equal((await h.send(`/cs/automation/resolution-drafts/${id}`)).data.deliveryState, 'ACCEPTED_LOCAL');
    assert.equal(sink.emails.length, before);
  });

  await t.test('N08 SMTP outage fails before submit and sink restart permits one safe known-failure retry', async () => {
    const { id } = await approved(); const key = randomUUID(); const before = sink.emails.length;
    await sink.stop(); sink = null;
    const r = await post(`/resolution-drafts/${id}/dispatch`, {}, key);
    assert.equal(r.data.deliveryState, 'FAILED', JSON.stringify(r));
    assert.equal(r.data.sinkMessageId, null);
    const failedAudit = await h.db.collection('automation_audit_logs').findOne({ 'targetEntity.id': r.data.deliveryId, action: 'RESOLUTION_DELIVERY_RESULT' });
    assert.equal(failedAudit.status, 'FAILED');
    sink = createSmtpSink({ smtpPort: ports.smtpPort, httpPort: ports.httpPort, token: sinkToken, dataFile: join(dataDir, 'smtp.jsonl') });
    await sink.start();
    assert.equal(sink.emails.length, before, 'Normal sink restart reloads durable accepted receipts');
    accepted(await post(`/resolution-drafts/${id}/dispatch`, {}, key));
    assert.equal(sink.emails.length, before + 1);
    accepted(await post(`/resolution-drafts/${id}/dispatch`, {}, key));
    assert.equal(sink.emails.length, before + 1);
  });

  await t.test('N04 N06 revoked and expired restricted service credentials cannot approve or replay', async () => {
    const created = await post('/service-credentials', { label: 'Independent synthetic QA worker', ttlMinutes: 5 });
    assert.equal(created.status, 201, JSON.stringify(created));
    const token = created.data.token;
    assert.ok(token);
    const headers = { authorization: `Bearer ${token}` };
    assert.equal((await h.send('/cs/automation/digest', { cookie: null, headers })).status, 200);
    const domain = await h.send('/crm/accounts', { cookie: null, headers });
    assert.ok(domain.status >= 400, JSON.stringify(domain));
    const d = await createDraft(await resolved());
    const machineApprove = await post(`/resolution-drafts/${draftId(d)}/approve`, { expectedVersion: d.version }, randomUUID(), null, headers);
    assert.equal(machineApprove.status, 403, JSON.stringify(machineApprove));
    const revoked = await post(`/service-credentials/${created.data.sessionId}/revoke`);
    assert.equal(revoked.status, 200, JSON.stringify(revoked));
    assert.equal((await h.send('/cs/automation/digest', { cookie: null, headers })).status, 401);
    const another = await post('/service-credentials', { label: 'Independent expiry fixture', ttlMinutes: 5 });
    assert.equal(another.status, 201, JSON.stringify(another));
    await h.db.collection('sessions').updateOne({ _id: another.data.sessionId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await h.send('/cs/automation/digest', { cookie: null, headers: { authorization: `Bearer ${another.data.token}` } });
    assert.equal(expired.status, 401, JSON.stringify(expired));
  });

  await t.test('N12 N13 scoped captured count includes resolution receipts and inspector cannot expose other tenants', async () => {
    const expected = await h.db.collection('cs_outbox').countDocuments({ tenantId: a.tenantId, plantId: a.plantId, origin: 'AUTOMATION', state: 'SENT', deliveryState: 'ACCEPTED_LOCAL' });
    assert.ok(expected > 0, 'Earlier real SMTP assertions must have created accepted receipts');
    const status = await h.send('/cs/automation/status');
    assert.equal(status.status, 200, JSON.stringify(status));
    assert.equal(status.data.engine.smtpSink.capturedCount, expected);
    const other = await h.send('/cs/automation/sink-messages', { cookie: h.beta });
    assert.equal(other.status, 200, JSON.stringify(other));
    assert.deepEqual(other.data, []);
  });

  await t.test('N08 digest occurrence key cannot inject SMTP headers', async () => {
    const before = sink.emails.length;
    const r = await post('/digest/dispatch', { mode: 'DEMO', periodKey: 'synthetic\nBcc: other@iems.local' });
    assert.equal(r.status, 400, JSON.stringify(r));
    assert.equal(sink.emails.length, before);
  });
});
