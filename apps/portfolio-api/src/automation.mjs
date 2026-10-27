import { randomUUID } from 'node:crypto';
import { submitLocalMail, verifiedSinkReceipt, localUrl, hashText } from './automation-transport.mjs';

export const automationRoles = {
  automationViewer: ['cs.automation.read'],
  automationOperator: ['cs.automation.read', 'cs.automation.execute'],
  automationAdmin: ['cs.automation.read', 'cs.automation.execute', 'cs.automation.admin'],
  automationService: ['cs.automation.read', 'cs.automation.execute']
};
export const automationActions = ['cs.automation.read', 'cs.automation.execute', 'cs.automation.admin'];
const c = (runtime, name) => runtime.db.collection(name);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const digest = value => hashText(JSON.stringify(canonical(value)));
const scope = req => ({ tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId });
const workflows = [
  { id: 'wf-sla-escalation', name: 'Unassigned ticket escalation', type: 'POLL_AND_RECHECK', path: 'iems-sla-escalation' },
  { id: 'wf-cs-weekly-digest', name: 'Weekly CS digest', type: 'SCHEDULED_DIGEST', path: 'iems-cs-weekly-digest' },
  { id: 'wf-approved-resolution', name: 'Approved resolution update', type: 'APPROVAL_GATE', path: 'iems-approved-resolution' }
];

export async function initializeAutomation(db) {
  await db.collection('automation_audit_logs').createIndex({ tenantId: 1, plantId: 1, occurredAt: -1 });
  const indexes = await db.collection('automation_audit_logs').listIndexes().toArray().catch(() => []);
  const previous = indexes.find(x => x.name === 'tenantId_1_idempotencyKey_1' && x.sparse);
  if (previous) await db.collection('automation_audit_logs').dropIndex(previous.name);
  await db.collection('automation_audit_logs').createIndex({ tenantId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
  await db.collection('cs_resolution_drafts').createIndex({ tenantId: 1, plantId: 1, status: 1 });
  await db.collection('automation_tasks').createIndex({ tenantId: 1, plantId: 1, kind: 1, occurrence: 1 }, { unique: true });
  await db.collection('cs_outbox').createIndex({ tenantId: 1, origin: 1, plantId: 1, state: 1 });
}

export function installAutomation(app, runtime, { fail, id, fields }) {
  const cfg = () => runtime.automation || {};
  const auth = async (req, action = 'cs.automation.read', session) => session
    ? runtime.foundation.authorizeInTransaction(req.scope, { ...scope(req), action }, { session })
    : runtime.foundation.authorize(req.scope, { ...scope(req), action });
  const human = async (req, action = 'cs.ticket.write', session) => {
    if (req.automationService) fail(403, 'HUMAN_APPROVAL_REQUIRED');
    return auth(req, action, session);
  };
  const text = (value, max = 2000) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /\r/.test(value)) fail(400, 'INVALID_TEXT');
    return value.trim();
  };
  const recipient = value => {
    const out = text(value, 100).toLowerCase();
    if (!/^[a-z0-9._+-]+@iems\.local$/.test(out)) fail(400, 'SYNTHETIC_RECIPIENT_REQUIRED');
    return out;
  };
  const version = value => {
    if (!Number.isSafeInteger(value) || value < 1) fail(400, 'INVALID_VERSION');
    return value;
  };
  const key = req => {
    const value = req.headers['idempotency-key'];
    if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{8,120}$/.test(value)) fail(400, 'IDEMPOTENCY_KEY_REQUIRED');
    return value;
  };
  const tx = async (req, action, effect) => {
    const session = runtime.client.startSession();
    try { return await session.withTransaction(async () => { await auth(req, action, session); return effect(session); }); }
    finally { await session.endSession(); }
  };
  const audit = async (req, session, action, entityId, result, extra = {}) => {
    await cfg().beforeAudit?.({ action, entityId });
    const executionId = req.headers['x-iems-execution-id'];
    const status = action.endsWith('_DELIVERY_RESULT') && !['ACCEPTED_LOCAL', 'PREVIEWED'].includes(result.deliveryState) ? result.deliveryState : 'SUCCESS';
    const row = { _id: randomUUID(), ...scope(req), workflowId: action.startsWith('DIGEST') ? 'wf-cs-weekly-digest' : action.startsWith('RESOLUTION') ? 'wf-approved-resolution' : 'wf-sla-escalation', action, targetEntity: { type: 'AUTOMATION', id: entityId }, status, result, executionId: typeof executionId === 'string' ? executionId.slice(0, 100) : null, occurredAt: new Date(), reconciliationState: status === 'UNKNOWN' ? 'NEEDS_REVIEW' : 'CONFIRMED', ...extra };
    await c(runtime, 'automation_audit_logs').insertOne(row, { session });
    return row;
  };
  const replay = async (req, session, action, entityId, payload, idem) => {
    const row = await c(runtime, 'automation_audit_logs').findOne({ tenantId: req.scope.tenantId, idempotencyKey: idem }, { session });
    if (!row) return null;
    if (row.plantId !== req.scope.selectedPlantId || row.action !== action || row.targetEntity?.id !== entityId || row.payloadHash !== digest(payload)) fail(409, 'IDEMPOTENCY_CONFLICT', 'Key metadata is missing or does not match this operation');
    return { ...row.result, auditId: row._id, idempotencyKey: idem, replayed: true };
  };
  const operation = async (req, action, entityId, payload, effect, permission = 'cs.automation.execute') => {
    const idem = key(req);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await tx(req, permission, async session => {
          const previous = await replay(req, session, action, entityId, payload, idem);
          if (previous) return previous;
          const result = await effect(session);
          const row = await audit(req, session, action, entityId, result, { idempotencyKey: idem, payloadHash: digest(payload) });
          return { ...result, auditId: row._id, idempotencyKey: idem, replayed: false };
        });
      } catch (error) { if (error.code !== 11000 || attempt) throw error; }
    }
  };
  const policy = () => {
    const minutes = Number(cfg().slaMinutes ?? process.env.IEMS_AUTOMATION_SLA_MINUTES ?? 15);
    return { version: `UNASSIGNED_V1_${String(minutes).replaceAll('.', '_')}`, minutes };
  };
  const eligible = (ticket, at = new Date()) => !!ticket && ['NEW', 'TRIAGED'].includes(ticket.stage) && !ticket.assigneeId && !ticket.assignedUserId && !ticket.isEscalated && new Date(ticket.createdAt).getTime() + policy().minutes * 60000 <= at.getTime();
  const schedule = async req => {
    const p = policy();
    if (!(p.minutes >= 0 && p.minutes <= 1440)) fail(503, 'INVALID_SLA_POLICY');
    const tickets = await c(runtime, 'cs_tickets').find({ ...scope(req), stage: { $in: ['NEW', 'TRIAGED'] }, assigneeId: null, assignedUserId: null, isEscalated: { $ne: true } }).toArray();
    for (const ticket of tickets) {
      const occurrence = `${ticket._id}:${p.version}`;
      await c(runtime, 'automation_tasks').updateOne({ ...scope(req), kind: 'SLA', occurrence }, { $setOnInsert: { _id: randomUUID(), ...scope(req), kind: 'SLA', occurrence, ticketId: ticket._id, dueAt: new Date(new Date(ticket.createdAt).getTime() + p.minutes * 60000), policyVersion: p.version, policyMinutes: p.minutes, state: 'PENDING', createdAt: new Date() } }, { upsert: true });
    }
    return tickets.filter(t => eligible(t));
  };
  const getDraft = async (req, draftId, session) => {
    const draft = await c(runtime, 'cs_resolution_drafts').findOne({ ...scope(req), _id: id(draftId) }, { session });
    if (!draft) fail(404, 'NOT_FOUND');
    return draft;
  };
  const approvedHash = draft => digest({ ticketId: draft.ticketId, ticketVersion: draft.expectedTicketVersion, recipient: draft.recipient, channel: draft.channel, content: draft.proposedResolution, tenantId: draft.tenantId, plantId: draft.plantId, bindingId: draft.bindingId, bindingVersion: draft.bindingVersion, customerId: draft.customerId, recipientPolicy: draft.recipientPolicy, expiresAt: new Date(draft.expiresAt).toISOString() });
  const sourceBinding = async (req, ticket, session, expectedBindingVersion) => {
    const filter = { ...scope(req), _id: ticket.bindingId, customerId: ticket.customerId, synthetic: true, channelAccountId: 'SIMULATED', status: 'ACTIVE', ...(expectedBindingVersion === undefined ? {} : { version: expectedBindingVersion }), $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };
    const binding = await c(runtime, 'cs_contact_bindings').findOneAndUpdate(filter, { $inc: { automationFence: 1 } }, { session, returnDocument: 'after' });
    if (!binding) fail(409, 'SOURCE_BINDING_INELIGIBLE', 'An active synthetic binding matching the ticket customer is required');
    return binding;
  };
  const checkSource = async (req, draft, session, fence = false) => {
    if (new Date(draft.expiresAt) <= new Date()) fail(409, 'APPROVAL_EXPIRED');
    if (approvedHash(draft) !== draft.approvalHash) fail(409, 'APPROVAL_CONTENT_CHANGED');
    const filter = { ...scope(req), _id: draft.ticketId, stage: 'RESOLVED', version: draft.expectedTicketVersion };
    const ticket = fence ? await c(runtime, 'cs_tickets').findOneAndUpdate(filter, { $inc: { automationFence: 1 } }, { session, returnDocument: 'after' }) : await c(runtime, 'cs_tickets').findOne(filter, { session });
    if (!ticket) fail(409, 'STALE_DRAFT', 'Ticket must remain resolved at the approved source version');
    if (ticket.bindingId !== draft.bindingId || ticket.customerId !== draft.customerId) fail(409, 'SOURCE_BINDING_CHANGED');
    await sourceBinding(req, ticket, session, draft.bindingVersion);
    if (draft.status !== 'PENDING_APPROVAL') {
      const approvingMembership = await c(runtime, 'memberships').findOneAndUpdate({ _id: draft.approvedMembershipId, tenantId: draft.tenantId, userId: draft.approvedBy, active: true, version: draft.approvedMembershipVersion }, { $inc: { automationApprovalFence: 1 } }, { session, returnDocument: 'after' });
      const approvingUser = await c(runtime, 'users').findOneAndUpdate({ _id: draft.approvedBy, active: true }, { $inc: { automationApprovalFence: 1 } }, { session, returnDocument: 'after' });
      if (!approvingMembership || !approvingUser) fail(409, 'APPROVER_AUTHORITY_CHANGED');
    }
    return ticket;
  };
  const deliveryView = row => ({ deliveryId: row._id, draftId: row.draftId, ticketId: row.ticketId, kind: row.kind, recipient: row.recipient, subject: row.subject, body: row.body, state: row.state, deliveryState: row.deliveryState || row.state, receiptStatus: row.receiptStatus || null, sinkMessageId: row.providerMessageId || null, lastError: row.lastError || null, leaseUntil: row.leaseUntil, attempt: row.attempt, createdAt: row.createdAt, updatedAt: row.updatedAt });
  const enqueue = async (req, session, { actionKey, kind, draft, recipient: to, subject, body, summary }) => {
    const existing = await c(runtime, 'cs_outbox').findOne({ tenantId: req.scope.tenantId, actionKey }, { session });
    if (existing) return existing;
    const now = new Date(), deliveryId = randomUUID();
    const row = { _id: deliveryId, ...scope(req), actionKey, origin: 'AUTOMATION', kind, channelAccountId: 'IEMS_LOCAL_SMTP', conversationId: draft?.conversationId || deliveryId, bindingId: draft?.bindingId || null, draftId: draft?._id || null, ticketId: draft?.ticketId || null, recipient: to, subject, body: body.trim(), contentHash: hashText(body.trim()), summary, payload: { kind }, payloadHash: digest({ to, subject, body }), messageId: `<${deliveryId}@iems.local>`, state: 'QUEUED', deliveryState: 'QUEUED', attempt: 0, fence: 0, nextAttemptAt: now, leaseUntil: null, createdAt: now, updatedAt: now, history: [{ state: 'QUEUED', at: now }] };
    await c(runtime, 'cs_outbox').insertOne(row, { session });
    return row;
  };
  const finish = async (req, delivery, state, receipt = null, error = null) => tx(req, 'cs.automation.execute', async session => {
    const now = new Date(), display = state === 'SENT' ? 'ACCEPTED_LOCAL' : state;
    const update = await c(runtime, 'cs_outbox').updateOne({ ...scope(req), _id: delivery._id, origin: 'AUTOMATION', state: { $in: ['SENDING', 'UNKNOWN'] }, fence: delivery.fence }, { $set: { state, deliveryState: display, providerMessageId: receipt?.id || null, receiptStatus: receipt ? 'Accepted by local mail sink' : null, lastError: error, leaseUntil: null, updatedAt: now }, $push: { history: { state, at: now, reason: error, sinkMessageId: receipt?.id || null } } }, { session });
    if (update.matchedCount !== 1) fail(409, 'STALE_DELIVERY_FENCE');
    if (delivery.draftId) await c(runtime, 'cs_resolution_drafts').updateOne({ ...scope(req), _id: delivery.draftId }, { $set: { status: state === 'SENT' || state === 'PREVIEWED' ? 'DISPATCHED' : state, deliveryState: display, deliveryProof: receipt?.id || null, updatedAt: now }, $inc: { version: 1 } }, { session });
    await audit(req, session, delivery.kind === 'DIGEST' ? 'DIGEST_DELIVERY_RESULT' : 'RESOLUTION_DELIVERY_RESULT', delivery._id, { deliveryId: delivery._id, deliveryState: display, sinkMessageId: receipt?.id || null, error });
    return deliveryView(await c(runtime, 'cs_outbox').findOne({ _id: delivery._id }, { session }));
  });
  const dispatch = async (req, deliveryId) => {
    const delivery = await tx(req, 'cs.automation.execute', async session => {
      const d = await c(runtime, 'cs_outbox').findOne({ ...scope(req), _id: deliveryId, origin: 'AUTOMATION' }, { session });
      if (!d) fail(404, 'NOT_FOUND');
      if (!['QUEUED', 'FAILED'].includes(d.state)) return d;
      const settingId = `${req.scope.tenantId}:${req.scope.selectedPlantId}`;
      await c(runtime, 'automation_settings').updateOne({ _id: settingId }, { $setOnInsert: { ...scope(req), paused: false } }, { session, upsert: true });
      const setting = await c(runtime, 'automation_settings').findOneAndUpdate({ _id: settingId, paused: false }, { $inc: { dispatchFence: 1 } }, { session, returnDocument: 'after' });
      if (!setting) fail(409, 'AUTOMATION_PAUSED');
      if (d.draftId) {
        const draft = await getDraft(req, d.draftId, session);
        if (!['APPROVED', 'FAILED'].includes(draft.status)) fail(409, 'DRAFT_NOT_APPROVED');
        await checkSource(req, draft, session, true);
      }
      const at = new Date();
      const claimed = await c(runtime, 'cs_outbox').findOneAndUpdate({ _id: d._id, state: d.state, fence: d.fence }, { $set: { state: 'SENDING', deliveryState: 'SENDING', leaseOwner: req.scope.userId, leaseUntil: new Date(at.getTime() + Number(cfg().leaseMs || 30000)), updatedAt: at }, $inc: { attempt: 1, fence: 1 }, $push: { history: { state: 'SENDING', at } } }, { session, returnDocument: 'after' });
      if (!claimed) fail(409, 'DELIVERY_ALREADY_CLAIMED');
      return { ...claimed, claimed: true };
    });
    if (!delivery.claimed) return { ...deliveryView(delivery), replayed: true };
    if (delivery.kind === 'RESOLUTION_PREVIEW') return finish(req, delivery, 'PREVIEWED');
    let submitted = false;
    try {
      await (cfg().submitMail || submitLocalMail)(delivery, cfg());
      submitted = true;
      await cfg().afterTransport?.(delivery);
      const receipt = await (cfg().verifyReceipt || verifiedSinkReceipt)(delivery, cfg());
      if (!receipt) return finish(req, delivery, 'UNKNOWN', null, 'SINK_RECEIPT_NOT_VERIFIED');
      return finish(req, delivery, 'SENT', receipt);
    } catch (error) {
      return finish(req, delivery, submitted || error.submitted ? 'UNKNOWN' : 'FAILED', null, submitted || error.submitted ? 'SUBMISSION_UNCERTAIN' : 'SMTP_UNAVAILABLE');
    }
  };
  const buildDigest = async req => {
    const filter = scope(req), now = new Date(), from = new Date(now.getTime() - 7 * 86400000);
    const [created, resolved, escalations, count, unassigned, open] = await Promise.all([
      c(runtime, 'cs_tickets').countDocuments({ ...filter, createdAt: { $gte: from, $lt: now } }),
      c(runtime, 'cs_tickets').countDocuments({ ...filter, resolvedAt: { $gte: from, $lt: now } }),
      c(runtime, 'automation_audit_logs').countDocuments({ ...filter, action: 'TICKET_ESCALATE', occurredAt: { $gte: from, $lt: now } }),
      c(runtime, 'cs_tickets').countDocuments({ ...filter, stage: { $nin: ['RESOLVED', 'CLOSED', 'CANCELLED'] } }),
      c(runtime, 'cs_tickets').countDocuments({ ...filter, stage: { $in: ['NEW', 'TRIAGED'] }, assigneeId: null }),
      c(runtime, 'cs_tickets').find({ ...filter, stage: { $nin: ['RESOLVED', 'CLOSED', 'CANCELLED'] } }).sort({ createdAt: 1 }).limit(20).toArray()
    ]);
    const overdue = await c(runtime, 'cs_tickets').countDocuments({ ...filter, stage: { $in: ['NEW', 'TRIAGED'] }, assigneeId: null, createdAt: { $lte: new Date(now.getTime() - policy().minutes * 60000) } });
    const summary = { periodDays: 7, since: from.toISOString(), until: now.toISOString(), timezone: 'UTC', ticketsCreated: created, ticketsResolved: resolved, escalationsTriggered: escalations, currentlyOpenCount: count, unassignedCount: unassigned, overdueCount: overdue, previewCount: open.length, slaComplianceRatePercent: null, slaMetricState: 'NO_DATA', slaMetricDefinition: 'Compliance is not measured by escalation-to-created ratios' };
    const markdown = `# IEMS CS digest\nUTC window: ${summary.since} to ${summary.until}\nOpen: ${count}\nUnassigned: ${unassigned}\nOverdue: ${overdue}\nCreated: ${created}\nResolved: ${resolved}\nSLA compliance: Not measured\nPreview: first ${open.length} of ${count} open tickets\n${open.map(t => `Ticket #${t.ticketNumber}: ${t.stage}`).join('\n')}`;
    return { summary, markdown, html: `<pre>${markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>` };
  };
  const resolutionIntent = (req, draftId) => operation(req, 'RESOLUTION_DISPATCH_INTENT', draftId, { draftId }, async session => {
    const draft = await getDraft(req, draftId, session);
    if (draft.status !== 'APPROVED') fail(409, 'DRAFT_NOT_APPROVED');
    await checkSource(req, draft, session, true);
    const delivery = await enqueue(req, session, { actionKey: `automation:resolution:${draftId}`, kind: draft.channel === 'EMAIL' ? 'RESOLUTION' : 'RESOLUTION_PREVIEW', draft, recipient: draft.recipient, subject: `Resolution update for ticket ${draft.ticketId}`, body: draft.proposedResolution });
    return { draftId, deliveryId: delivery._id };
  });

  app.post('/api/cs/automation/service-credentials', async (req, res) => {
    await human(req, 'cs.automation.admin'); fields(req.body, ['label', 'ttlMinutes']);
    const label = text(req.body.label || 'n8n local orchestrator', 80), ttlMinutes = Number(req.body.ttlMinutes || 60);
    if (!Number.isSafeInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 1440) fail(400, 'INVALID_EXPIRY');
    const userId = randomUUID(), membershipId = randomUUID(), plant = await c(runtime, 'plants').findOne({ _id: req.scope.selectedPlantId, tenantId: req.scope.tenantId });
    await runtime.foundation.provisionUser({ id: userId, tenantId: req.scope.tenantId });
    await runtime.foundation.provisionMembership({ id: membershipId, tenantId: req.scope.tenantId, userId, legalEntityIds: [plant.legalEntityId], plantIds: [plant._id], roles: [{ role: 'automationService', plantIds: [plant._id] }] });
    const issued = await runtime.foundation.issueSession({ userId, tenantId: req.scope.tenantId, selectedPlantId: plant._id, ttlMs: ttlMinutes * 60000 });
    await c(runtime, 'sessions').updateOne({ _id: issued.sessionId }, { $set: { automationService: true, label } });
    res.status(201).json({ data: { ...issued, label, scope: scope(req), grants: ['cs.automation.read', 'cs.automation.execute'] } });
  });
  app.post('/api/cs/automation/service-credentials/:id/revoke', async (req, res) => {
    await human(req, 'cs.automation.admin'); fields(req.body, []);
    const row = await c(runtime, 'sessions').findOne({ _id: id(req.params.id), tenantId: req.scope.tenantId, selectedPlantId: req.scope.selectedPlantId, automationService: true });
    if (!row) fail(404, 'NOT_FOUND');
    await runtime.foundation.revokeSession({ tenantId: req.scope.tenantId, sessionId: row._id });
    res.json({ data: { sessionId: row._id, revoked: true } });
  });
  app.get('/api/cs/automation/status', async (req, res) => {
    await auth(req);
    const n8nUrl = localUrl(cfg().n8nUrl || process.env.IEMS_AUTOMATION_N8N_URL, 'http://127.0.0.1:5687');
    const sinkUrl = localUrl(cfg().sinkUrl || process.env.IEMS_AUTOMATION_SINK_URL, 'http://127.0.0.1:8027');
    const healthy = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(600) })).ok; } catch { return false; } };
    const [engineUp, sinkUp, audits, success, digests, open, pending] = await Promise.all([healthy(`${n8nUrl}/healthz`), healthy(`${sinkUrl}/health`), c(runtime, 'automation_audit_logs').countDocuments(scope(req)), c(runtime, 'automation_audit_logs').countDocuments({ ...scope(req), status: 'SUCCESS' }), c(runtime, 'cs_outbox').countDocuments({ ...scope(req), origin: 'AUTOMATION', kind: 'DIGEST', state: 'SENT' }), c(runtime, 'cs_tickets').countDocuments({ ...scope(req), stage: { $nin: ['RESOLVED', 'CLOSED', 'CANCELLED'] } }), c(runtime, 'cs_resolution_drafts').countDocuments({ ...scope(req), status: 'PENDING_APPROVAL' })]);
    const setting = await c(runtime, 'automation_settings').findOne({ _id: `${req.scope.tenantId}:${req.scope.selectedPlantId}` });
    const observed = await Promise.all(workflows.map(async workflow => {
      const [engineRun, domainEffect] = await Promise.all([
        c(runtime, 'automation_engine_runs').find({ ...scope(req), workflowId: workflow.id }).sort({ observedAt: -1, completedAt: -1, startedAt: -1 }).limit(1).next(),
        c(runtime, 'automation_audit_logs').find({ ...scope(req), workflowId: workflow.id, executionId: { $type: 'string' } }).sort({ occurredAt: -1 }).limit(1).next()
      ]);
      const engineAt = engineRun ? new Date(engineRun.observedAt || engineRun.completedAt || engineRun.startedAt).getTime() : 0;
      if (domainEffect && new Date(domainEffect.occurredAt).getTime() > engineAt) return { workflowId: workflow.id, executionId: domainEffect.executionId, state: ['FAILED', 'UNKNOWN'].includes(domainEffect.status) ? domainEffect.status : 'DOMAIN_EFFECT_RECORDED', completedAt: domainEffect.occurredAt, observationSource: 'IEMS_DOMAIN_AUDIT', result: domainEffect.result };
      return engineRun;
    }));
    const capturedCount = await c(runtime, 'cs_outbox').countDocuments({ ...scope(req), origin: 'AUTOMATION', state: 'SENT', deliveryState: 'ACCEPTED_LOCAL' });
    res.json({ data: { engine: { n8n: { status: engineUp ? 'HEALTHY' : 'DOWN', url: n8nUrl, mode: 'STANDALONE_SQLITE', loopbackOnly: true }, smtpSink: { status: sinkUp ? 'HEALTHY' : 'DOWN', port: Number(cfg().smtpPort || process.env.IEMS_AUTOMATION_SMTP_PORT || 2527), httpPort: Number(new URL(sinkUrl).port), capturedCount, receiptGuarantee: 'Accepted by local mail sink' } }, workflows: workflows.map(w => { const lastRun = observed.find(r => r?.workflowId === w.id) || null; return { ...w, state: setting?.paused ? 'PAUSED' : lastRun?.state || 'NOT_OBSERVED', lastRun }; }), paused: !!setting?.paused, policy: { ...policy(), label: policy().minutes < 15 ? 'Demo SLA' : 'Unassigned SLA' }, metrics: { openTicketsCount: open, totalAutomationsExecuted: audits, successfulAutomations: success, digestsGenerated: digests, pendingDraftsCount: pending } } });
  });
  app.post('/api/cs/automation/pause', async (req, res) => {
    await human(req, 'cs.automation.admin'); fields(req.body, ['paused']);
    if (typeof req.body.paused !== 'boolean') fail(400, 'INVALID_STATE');
    await tx(req, 'cs.automation.admin', session => c(runtime, 'automation_settings').updateOne({ _id: `${req.scope.tenantId}:${req.scope.selectedPlantId}` }, { $set: { ...scope(req), paused: req.body.paused, updatedAt: new Date() } }, { upsert: true, session }));
    res.json({ data: { paused: req.body.paused } });
  });
  app.get('/api/cs/automation/sla-breaches', async (req, res) => {
    await auth(req);
    const items = (await schedule(req)).map(t => ({ ticketId: t._id, ticketNumber: t.ticketNumber, stage: t.stage, expectedVersion: t.version, createdAt: t.createdAt, dueAt: new Date(new Date(t.createdAt).getTime() + policy().minutes * 60000), ageMinutes: Math.floor((Date.now() - new Date(t.createdAt)) / 60000), thresholdMinutes: policy().minutes, policyVersion: policy().version, occurrenceKey: `sla:${t._id}:${policy().version}`, assigneeId: null, slaStatus: 'BREACHED' }));
    res.json({ data: { totalBreached: items.length, thresholdMinutes: policy().minutes, items: items.slice(0, 100) } });
  });
  app.post('/api/cs/automation/recheck', async (req, res) => {
    await auth(req); fields(req.body, ['ticketId', 'expectedVersion', 'action']);
    const ticket = await c(runtime, 'cs_tickets').findOne({ ...scope(req), _id: id(req.body.ticketId) });
    const ready = eligible(ticket) && ticket.version === req.body.expectedVersion;
    res.json({ data: { ticketId: req.body.ticketId, eligible: ready, status: ready ? 'READY_FOR_EXECUTION' : ticket && ticket.version !== req.body.expectedVersion ? 'STALE_VERSION' : 'INELIGIBLE_STAGE', reason: ready ? 'SLA_BREACH_CONFIRMED_ELIGIBLE' : 'AUTHORITATIVE_ELIGIBILITY_FAILED', currentStage: ticket?.stage, currentVersion: ticket?.version } });
  });
  app.post('/api/cs/automation/escalate', async (req, res) => {
    fields(req.body, ['ticketId', 'expectedVersion', 'reason']);
    const ticketId = id(req.body.ticketId), expectedVersion = version(req.body.expectedVersion), reason = text(req.body.reason || 'Unassigned ticket SLA breached', 500);
    await auth(req, 'cs.automation.execute'); await schedule(req);
    const result = await operation(req, 'TICKET_ESCALATE', ticketId, { ticketId, expectedVersion, reason }, async session => {
      const task = await c(runtime, 'automation_tasks').findOne({ ...scope(req), kind: 'SLA', occurrence: `${ticketId}:${policy().version}`, state: 'PENDING', dueAt: { $lte: new Date() }, policyMinutes: policy().minutes }, { session });
      const ticket = await c(runtime, 'cs_tickets').findOne({ ...scope(req), _id: ticketId }, { session });
      if (!ticket) fail(404, 'NOT_FOUND');
      if (ticket.version !== expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (!task || !eligible(ticket)) fail(409, 'ELIGIBILITY_CHECK_FAILED');
      const at = new Date();
      const changed = await c(runtime, 'cs_tickets').updateOne({ ...scope(req), _id: ticketId, version: expectedVersion, stage: { $in: ['NEW', 'TRIAGED'] }, assigneeId: null, assignedUserId: null, isEscalated: { $ne: true } }, { $set: { priority: 'URGENT', isEscalated: true, escalatedAt: at, slaBreached: true, requiresHuman: true, updatedAt: at }, $inc: { version: 1 } }, { session });
      if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
      await c(runtime, 'automation_tasks').updateOne({ _id: task._id, state: 'PENDING' }, { $set: { state: 'COMPLETED', completedAt: at } }, { session });
      const noteId = randomUUID();
      await c(runtime, 'cs_internal_notes').insertOne({ _id: noteId, ...scope(req), ticketId, authorUserId: req.scope.userId, text: `[AUTOMATED SLA ESCALATION] ${reason}. Stage remains ${ticket.stage}.`, createdAt: at }, { session });
      await c(runtime, 'cs_ticket_events').insertOne({ _id: randomUUID(), ...scope(req), ticketId, kind: 'SLA_ESCALATED', visibility: 'INTERNAL', fromStage: ticket.stage, toStage: ticket.stage, version: expectedVersion + 1, actor: { type: 'AUTOMATION', userId: req.scope.userId }, reason, at }, { session });
      return { ticketId, ticketNumber: ticket.ticketNumber, previousStage: ticket.stage, newStage: ticket.stage, stage: ticket.stage, priority: 'URGENT', isEscalated: true, version: expectedVersion + 1, escalatedAt: at.toISOString(), noteId };
    });
    res.json({ data: result });
  });
  app.post('/api/cs/automation/resolution-draft', async (req, res) => {
    fields(req.body, ['ticketId', 'expectedTicketVersion', 'channel', 'recipient', 'proposedResolution']);
    const payload = { ticketId: id(req.body.ticketId), expectedTicketVersion: version(req.body.expectedTicketVersion), channel: req.body.channel, recipient: recipient(req.body.recipient), proposedResolution: text(req.body.proposedResolution) };
    if (!['EMAIL', 'SIMULATED'].includes(payload.channel)) fail(400, 'INVALID_CHANNEL');
    const out = await operation(req, 'RESOLUTION_DRAFT_CREATE', payload.ticketId, payload, async session => {
      const ticket = await c(runtime, 'cs_tickets').findOneAndUpdate({ ...scope(req), _id: payload.ticketId, stage: 'RESOLVED', version: payload.expectedTicketVersion }, { $inc: { automationFence: 1 } }, { session, returnDocument: 'after' });
      if (!ticket) fail(409, 'RESOLVED_TICKET_REQUIRED', 'Resolve the ticket through its domain transition before drafting a resolution update');
      const binding = await sourceBinding(req, ticket, session);
      const now = new Date(), row = { _id: randomUUID(), ...scope(req), ...payload, customerId: ticket.customerId, conversationId: ticket.conversationId || null, bindingId: binding._id, bindingVersion: binding.version, recipientPolicy: 'SYNTHETIC_LOCAL_OPERATOR_APPROVAL', version: 1, status: 'PENDING_APPROVAL', expiresAt: new Date(now.getTime() + 7200000), createdAt: now, updatedAt: now };
      row.approvalHash = approvedHash(row);
      await c(runtime, 'cs_resolution_drafts').insertOne(row, { session });
      return { ...row, draftId: row._id };
    });
    res.status(out.replayed ? 200 : 201).json({ data: out });
  });
  app.get('/api/cs/automation/resolution-drafts', async (req, res) => { await auth(req); res.json({ data: await c(runtime, 'cs_resolution_drafts').find(scope(req)).sort({ createdAt: -1 }).limit(100).toArray() }); });
  app.get('/api/cs/automation/resolution-drafts/:id', async (req, res) => { await auth(req); res.json({ data: await getDraft(req, req.params.id) }); });
  for (const decision of ['approve', 'reject', 'cancel']) app.post(`/api/cs/automation/resolution-drafts/:id/${decision}`, async (req, res) => {
    await human(req); fields(req.body, ['expectedVersion', 'reason']);
    const out = await tx(req, 'cs.ticket.write', async session => {
      await human(req, 'cs.ticket.write', session);
      const draft = await getDraft(req, req.params.id, session), expected = version(req.body.expectedVersion);
      if (draft.version !== expected) fail(409, 'VERSION_CONFLICT');
      if (decision === 'approve') { if (draft.status !== 'PENDING_APPROVAL') fail(409, 'DRAFT_NOT_PENDING'); await checkSource(req, draft, session, true); }
      else if (!['PENDING_APPROVAL', 'APPROVED', 'FAILED'].includes(draft.status)) fail(409, 'INVALID_DRAFT_STATUS');
      const status = { approve: 'APPROVED', reject: 'REJECTED', cancel: 'CANCELLED' }[decision], now = new Date();
      const changed = await c(runtime, 'cs_resolution_drafts').findOneAndUpdate({ _id: draft._id, version: expected, status: draft.status }, { $set: { status, approvedBy: decision === 'approve' ? req.scope.userId : null, approvedMembershipId: decision === 'approve' ? req.scope.membershipId : null, approvedMembershipVersion: decision === 'approve' ? req.scope.membershipVersion : null, approvedAt: decision === 'approve' ? now : null, decisionReason: req.body.reason ? text(req.body.reason, 300) : null, updatedAt: now }, $inc: { version: 1 } }, { session, returnDocument: 'after' });
      if (!changed) fail(409, 'VERSION_CONFLICT');
      if (decision !== 'approve') {
        const sending = await c(runtime, 'cs_outbox').findOne({ ...scope(req), draftId: draft._id, origin: 'AUTOMATION', state: { $in: ['SENDING', 'UNKNOWN', 'SENT'] } }, { session });
        if (sending) fail(409, 'DELIVERY_ALREADY_SUBMITTED', 'Reconcile the in-flight delivery before cancellation');
        await c(runtime, 'cs_outbox').updateMany({ ...scope(req), draftId: draft._id, origin: 'AUTOMATION', state: { $in: ['QUEUED', 'FAILED'] } }, { $set: { state: 'CANCELLED', deliveryState: 'CANCELLED', updatedAt: now } }, { session });
      }
      await audit(req, session, `RESOLUTION_DRAFT_${status}`, draft._id, { draftId: draft._id, status, version: changed.version });
      return { ...changed, draftId: changed._id };
    });
    res.json({ data: out });
  });
  app.post('/api/cs/automation/resolution-drafts/:id/dispatch', async (req, res) => {
    fields(req.body, []);
    const draftId = id(req.params.id);
    const result = await resolutionIntent(req, draftId);
    res.json({ data: { ...result, ...await dispatch(req, result.deliveryId) } });
  });
  app.get('/api/cs/automation/digest', async (req, res) => { await auth(req); res.json({ data: await buildDigest(req) }); });
  app.post('/api/cs/automation/digest/dispatch', async (req, res) => {
    fields(req.body, ['mode', 'periodKey']);
    const mode = req.body.mode || 'WEEKLY';
    if (!['WEEKLY', 'DEMO'].includes(mode)) fail(400, 'INVALID_DIGEST_MODE');
    const now = new Date(), week = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
    const periodKey = mode === 'WEEKLY' ? week : text(req.body.periodKey || key(req), 100);
    if (!/^[A-Za-z0-9:_-]{1,100}$/.test(periodKey)) fail(400, 'INVALID_PERIOD');
    if (mode === 'WEEKLY' && req.body.periodKey && req.body.periodKey !== week) fail(400, 'INVALID_PERIOD');
    const actionKey = `automation:digest:${req.scope.selectedPlantId}:${mode}:${periodKey}:reports@iems.local`;
    const result = await operation(req, 'DIGEST_DISPATCH_INTENT', actionKey, { mode, periodKey }, async session => {
      const content = await buildDigest(req);
      const delivery = await enqueue(req, session, { actionKey, kind: 'DIGEST', recipient: 'reports@iems.local', subject: `IEMS ${mode === 'DEMO' ? 'demo' : 'weekly'} CS digest ${periodKey}`, body: content.markdown, summary: content.summary });
      return { deliveryId: delivery._id, mode, periodKey };
    });
    res.json({ data: { ...result, ...await dispatch(req, result.deliveryId) } });
  });
  app.post('/api/cs/automation/digest/record', async (req, res) => { await auth(req, 'cs.automation.execute'); fail(400, 'CALLER_RECEIPT_NOT_TRUSTED', 'Use the authoritative digest dispatch operation'); });
  app.get('/api/cs/automation/deliveries', async (req, res) => { await auth(req); res.json({ data: (await c(runtime, 'cs_outbox').find({ ...scope(req), origin: 'AUTOMATION' }).sort({ createdAt: -1 }).limit(100).toArray()).map(deliveryView) }); });
  app.get('/api/cs/automation/sink-messages', async (req, res) => {
    await auth(req);
    const rows = await c(runtime, 'cs_outbox').find({ ...scope(req), origin: 'AUTOMATION', state: 'SENT', deliveryState: 'ACCEPTED_LOCAL' }).sort({ updatedAt: -1 }).limit(100).toArray();
    const verified = [];
    for (const row of rows) { try { const receipt = await (cfg().verifyReceipt || verifiedSinkReceipt)(row, cfg()); if (receipt) verified.push({ ...deliveryView(row), receiptId: receipt.id, receivedAt: receipt.receivedAt }); } catch {} }
    res.json({ data: verified });
  });
  app.get('/api/cs/automation/audit-logs', async (req, res) => {
    await auth(req); const filter = scope(req);
    for (const field of ['workflowId', 'action', 'status', 'idempotencyKey']) if (req.query[field]) filter[field] = String(req.query[field]);
    res.json({ data: await c(runtime, 'automation_audit_logs').find(filter).sort({ occurredAt: -1 }).limit(100).toArray() });
  });
  app.post('/api/cs/automation/reconcile', async (req, res) => {
    await auth(req, 'cs.automation.execute'); fields(req.body, []);
    const expired = await tx(req, 'cs.automation.execute', async session => {
      const rows = await c(runtime, 'cs_outbox').find({ ...scope(req), origin: 'AUTOMATION', state: 'SENDING', leaseUntil: { $lte: new Date() } }, { session }).toArray();
      for (const row of rows) {
        await c(runtime, 'cs_outbox').updateOne({ _id: row._id, state: 'SENDING', fence: row.fence }, { $set: { state: 'UNKNOWN', deliveryState: 'UNKNOWN', leaseUntil: null, lastError: 'LEASE_EXPIRED', updatedAt: new Date() }, $push: { history: { state: 'UNKNOWN', reason: 'LEASE_EXPIRED', at: new Date() } } }, { session });
        if (row.draftId) await c(runtime, 'cs_resolution_drafts').updateOne({ _id: row.draftId, ...scope(req) }, { $set: { status: 'UNKNOWN', deliveryState: 'UNKNOWN', updatedAt: new Date() } }, { session });
      }
      return rows.map(r => r._id);
    });
    const recovered = [], pending = await c(runtime, 'cs_outbox').find({ ...scope(req), origin: 'AUTOMATION', state: 'UNKNOWN' }).toArray();
    for (const row of pending) { try { const receipt = await (cfg().verifyReceipt || verifiedSinkReceipt)(row, cfg()); if (receipt) recovered.push(await finish(req, row, 'SENT', receipt)); } catch {} }
    const recoveryErrors = [];
    const approved = await c(runtime, 'cs_resolution_drafts').find({ ...scope(req), status: 'APPROVED' }).limit(100).toArray();
    for (const draft of approved) {
      try {
        const child = Object.create(req);
        child.headers = { ...req.headers, 'idempotency-key': `resolution:${draft._id}` };
        await resolutionIntent(child, draft._id);
      } catch (error) { recoveryErrors.push({ draftId: draft._id, code: error.status ? error.code : 'RECOVERY_FAILED' }); }
    }
    const safePending = await c(runtime, 'cs_outbox').find({ ...scope(req), origin: 'AUTOMATION', state: { $in: ['QUEUED', 'FAILED'] } }).limit(100).toArray();
    for (const row of safePending) {
      try { recovered.push(await dispatch(req, row._id)); }
      catch (error) { recoveryErrors.push({ deliveryId: row._id, code: error.status ? error.code : 'RECOVERY_FAILED' }); }
    }
    const due = await schedule(req), unreconciledCount = await c(runtime, 'cs_outbox').countDocuments({ ...scope(req), origin: 'AUTOMATION', state: 'UNKNOWN' });
    res.json({ data: { reconciledAt: new Date().toISOString(), expiredDeliveryIds: expired, recoveredDeliveries: recovered, recoveryErrors, recoveredEscalations: [], recoveredDrafts: recovered, dueEscalations: due.length, unreconciledCount, status: unreconciledCount || recoveryErrors.length ? 'NEEDS_REVIEW' : 'RECONCILED', message: unreconciledCount ? 'Unknown submissions require receipt reconciliation or an operator decision' : 'Receipt reconciliation complete; due SLA tasks remain available to n8n' } });
  });
  app.post('/api/cs/automation/deliveries/:id/review', async (req, res) => {
    await human(req, 'cs.automation.admin'); fields(req.body, ['decision', 'evidence']);
    if (!['ABANDON', 'CONFIRMED_NOT_SUBMITTED'].includes(req.body.decision)) fail(400, 'INVALID_DECISION');
    const evidence = text(req.body.evidence, 1000);
    const out = await tx(req, 'cs.automation.admin', async session => {
      const row = await c(runtime, 'cs_outbox').findOne({ ...scope(req), _id: id(req.params.id), origin: 'AUTOMATION', state: 'UNKNOWN' }, { session });
      if (!row) fail(409, 'UNKNOWN_DELIVERY_REQUIRED');
      const state = req.body.decision === 'ABANDON' ? 'CANCELLED' : 'FAILED';
      await c(runtime, 'cs_outbox').updateOne({ _id: row._id, state: 'UNKNOWN' }, { $set: { state, deliveryState: state, manualReview: { userId: req.scope.userId, decision: req.body.decision, evidence, at: new Date() } } }, { session });
      if (row.draftId) await c(runtime, 'cs_resolution_drafts').updateOne({ _id: row.draftId, ...scope(req) }, { $set: { status: state, deliveryState: state }, $inc: { version: 1 } }, { session });
      await audit(req, session, row.kind === 'DIGEST' ? 'DIGEST_UNKNOWN_REVIEW' : 'RESOLUTION_UNKNOWN_REVIEW', row._id, { deliveryId: row._id, state, decision: req.body.decision });
      return { deliveryId: row._id, state };
    });
    res.json({ data: out });
  });
  app.post('/api/cs/automation/run/:workflowId', async (req, res) => {
    await human(req, 'cs.automation.execute'); fields(req.body, ['draftId', 'mode', 'ticketId', 'periodKey']);
    const wf = [...workflows, { id: 'wf-automation-recovery', path: 'iems-automation-recovery' }].find(w => w.id === req.params.workflowId);
    if (!wf) fail(404, 'NOT_FOUND');
    const url = localUrl(cfg().n8nUrl || process.env.IEMS_AUTOMATION_N8N_URL, 'http://127.0.0.1:5687'), token = cfg().webhookToken || process.env.IEMS_AUTOMATION_WEBHOOK_TOKEN;
    if (!token) fail(503, 'ENGINE_NOT_CONFIGURED');
    const setting = await c(runtime, 'automation_settings').findOne({ _id: `${req.scope.tenantId}:${req.scope.selectedPlantId}` });
    if (setting?.paused) fail(409, 'AUTOMATION_PAUSED');
    const configured = cfg().serviceToken || process.env.IEMS_AUTOMATION_SERVICE_TOKEN;
    if (!configured) fail(503, 'ENGINE_SERVICE_NOT_CONFIGURED');
    let engineScope; try { engineScope = await runtime.foundation.authenticate(configured); } catch { fail(503, 'ENGINE_SERVICE_CREDENTIAL_EXPIRED'); }
    if (engineScope.tenantId !== req.scope.tenantId || engineScope.selectedPlantId !== req.scope.selectedPlantId) fail(403, 'ENGINE_SCOPE_DENIED');
    const engineSession = await c(runtime, 'sessions').findOne({ tokenHash: hashText(configured), automationService: true });
    if (!engineSession) fail(503, 'ENGINE_SERVICE_NOT_CONFIGURED');
    const row = { _id: randomUUID(), ...scope(req), workflowId: wf.id, executionId: null, startedAt: new Date(), observedAt: new Date(), state: 'IN_PROGRESS' };
    await c(runtime, 'automation_engine_runs').insertOne(row);
    let response;
    try { response = await fetch(`${url}/webhook/${wf.path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-iems-webhook-token': token }, body: JSON.stringify({ ...req.body, correlationId: row._id }), signal: AbortSignal.timeout(20000) }); }
    catch {
      await c(runtime, 'automation_engine_runs').updateOne({ _id: row._id }, { $set: { state: 'UNKNOWN', error: 'ENGINE_ACKNOWLEDGMENT_UNCERTAIN', completedAt: new Date(), observedAt: new Date() } });
      fail(503, 'ENGINE_UNAVAILABLE', 'n8n did not acknowledge the run; inspect Runs before retrying');
    }
    if (!response.ok) {
      await c(runtime, 'automation_engine_runs').updateOne({ _id: row._id }, { $set: { state: 'FAILED', error: 'ENGINE_RUN_FAILED', completedAt: new Date(), observedAt: new Date() } });
      fail(502, 'ENGINE_RUN_FAILED', 'Inspect n8n execution and reconcile delivery state');
    }
    const result = await response.json().catch(() => ({}));
    const observed = { executionId: result.n8nExecutionId || result.executionId || result.data?.executionId || null, result, completedAt: new Date(), observedAt: new Date(), state: 'ENGINE_ACKNOWLEDGED' };
    await c(runtime, 'automation_engine_runs').updateOne({ _id: row._id }, { $set: observed });
    res.json({ data: { ...row, ...observed } });
  });
  app.post('/api/cs/automation/engine-error', async (req, res) => {
    await auth(req, 'cs.automation.execute'); fields(req.body, ['workflowId', 'executionId', 'message']);
    if (!req.automationService) fail(403, 'SERVICE_IDENTITY_REQUIRED');
    const workflowId = text(req.body.workflowId, 100), executionId = text(String(req.body.executionId), 100);
    const row = { _id: randomUUID(), ...scope(req), workflowId, executionId, state: 'FAILED', error: 'N8N_EXECUTION_FAILED', completedAt: new Date(), observedAt: new Date() };
    await c(runtime, 'automation_engine_runs').insertOne(row);
    res.status(201).json({ data: { runId: row._id, workflowId, executionId, state: row.state } });
  });
  app.post('/api/cs/automation/whatsapp-handoff', async (req, res) => { await auth(req, 'cs.automation.execute'); fail(409, 'USE_AUTHORITATIVE_HANDOFF', 'Use the customer service conversation handoff operation; WhatsApp remains preview only'); });
}
