import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { createCustomerService, SIMULATED_CHANNEL_ACCOUNT } from '../../../packages/customer-service/index.mjs';
import { createOrderReader } from './order-reader.mjs';

export const customerServiceRoles = {
  csViewer: ['cs.ticket.read'],
  csAgent: ['cs.ticket.read', 'cs.ticket.write', 'cs.note.internal', 'cs.conversation.handoff', 'cs.reply'],
  csReviewer: ['cs.ticket.read', 'cs.delivery.review'],
  csFixtureAdmin: ['cs.fixture.admin'],
  // Wave 4f: trusted onboarding of synthetic bindings and the simulated inbound channel are separate grants.
  csBindingViewer: ['cs.binding.read'],
  csBindingAdmin: ['cs.binding.read', 'cs.binding.manage'],
  csSimulator: ['cs.ticket.read', 'cs.simulator.use'],
};
export const customerServiceOwnerActions = ['cs.ticket.read', 'cs.ticket.write', 'cs.note.internal', 'cs.conversation.handoff', 'cs.delivery.review', 'cs.ticket.reopen_closed', 'cs.reply', 'cs.binding.read', 'cs.binding.manage', 'cs.simulator.use'];
export async function initializeCustomerService(runtime, options = {}) {
  runtime.orderReader = createOrderReader(runtime);
  // CRM account/contact ownership is verified inside the package transaction (same session) before a binding exists.
  const partyDirectory = { async verifyCustomerContact({ tenantId, plantId, accountId, contactId }, { session }) {
    const account = await runtime.db.collection('accounts').findOne({ tenantId, plantId, _id: accountId }, { session });
    if (!account) return null;
    const contact = await runtime.db.collection('contacts').findOne({ tenantId, plantId, _id: contactId, accountId }, { session });
    return contact ? { accountLabel: account.name } : null;
  } };
  const shared = { client: runtime.client, db: runtime.db, ...options, partyDirectory, orderReader: options.allowSyntheticOrders ? undefined : { readCustomerOrder: input => runtime.orderReader.readCustomerOrder(input) }, foundation: { authorize: (...args) => runtime.foundation.authorize(...args), authorizeInTransaction: (...args) => runtime.foundation.authorizeInTransaction(...args) } };
  const service = createCustomerService({ ...shared, previewDispatcher: false });
  // Reader and foundation are late-bound so rotations are honoured by the package.
  await service.initialize();
  // Preview-only dispatcher for the SIMULATED channel account; it can record PREVIEWED, never SENT.
  runtime.customerServicePreview = createCustomerService({ ...shared, previewDispatcher: true });
  return service;
}
const STAGES = ['NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'REOPENED', 'CLOSED'];

// Operator surface only: dispatcher ports (claim/record/reconcile) and customer-principal ports are never routed.
export function installCustomerService(app, runtime, { fail, id, fields }) {
  const cs = () => runtime.customerService;
  app.use('/api/cs', (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (req.filter.tenantId !== req.scope.tenantId || req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    next();
  });
  const plantId = req => req.filter.plantId;
  const pagination = (req, extra = []) => {
    if (Object.keys(req.query).some(k => !['limit', 'cursor', 'tenantId', 'tenant_id', 'plantId', 'plant_id', ...extra].includes(k))) fail(400, 'UNKNOWN_FIELD');
    const { limit = '25', cursor } = req.query;
    if (typeof limit !== 'string' || !/^[0-9]{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 || (cursor !== undefined && (typeof cursor !== 'string' || !cursor || cursor.length > 512))) fail(400, 'INVALID_PAGINATION');
    return { limit: Number(limit), ...(cursor === undefined ? {} : { cursor }) };
  };
  app.get('/api/cs/tickets', async (req, res) => {
    const input = { plantId: plantId(req) };
    const { stage, assignee } = req.query;
    Object.assign(input, pagination(req, ['stage', 'assignee']));
    if (stage !== undefined) { if (!STAGES.includes(stage)) fail(400, 'INVALID_STAGE'); input.stage = stage; }
    if (assignee !== undefined) input.assigneeId = assignee === 'unassigned' ? null : id(assignee);
    const page = await cs().listTicketsPage(req.scope, input);
    res.json({ data: page.items, page: { limit: input.limit, nextCursor: page.nextCursor } });
  });
  app.get('/api/cs/conversations', async (req, res) => {
    const input = { plantId: plantId(req), ...pagination(req, ['mode']) };
    if (req.query.mode !== undefined) input.mode = req.query.mode;
    const page = await cs().listConversationsPage(req.scope, input);
    res.json({ data: page.items, page: { limit: input.limit, nextCursor: page.nextCursor } });
  });
  app.get('/api/cs/conversations/:id/thread', async (req, res) => {
    const input = { plantId: plantId(req), conversationId: id(req.params.id), ...pagination(req) };
    const page = await cs().getConversationThread(req.scope, input);
    res.json({ data: page.items, page: { limit: input.limit, nextCursor: page.nextCursor } });
  });
  app.post('/api/cs/conversations/:id/reply', async (req, res) => {
    fields(req.body, ['text', 'commandKey']);
    res.json({ data: await cs().operatorReply(req.scope, { plantId: plantId(req), conversationId: id(req.params.id), text: req.body.text, commandKey: req.body.commandKey }) });
  });
  app.post('/api/cs/tickets/:id/public-update', async (req, res) => {
    fields(req.body, ['expectedVersion', 'text', 'commandKey']);
    res.json({ data: await cs().addPublicUpdate(req.scope, { plantId: plantId(req), ticketId: id(req.params.id), expectedVersion: req.body.expectedVersion, text: req.body.text, commandKey: req.body.commandKey }) });
  });
  app.get('/api/cs/tickets/:id', async (req, res) => res.json({ data: await cs().getTicketForOperator(req.scope, { plantId: plantId(req), ticketId: id(req.params.id) }) }));
  app.post('/api/cs/tickets/:id/stage', async (req, res) => {
    fields(req.body, ['expectedVersion', 'toStage', 'reason', 'assigneeId', 'commandKey']);
    const { expectedVersion, toStage, reason, assigneeId, commandKey } = req.body;
    res.json({ data: await cs().transitionTicket(req.scope, { plantId: plantId(req), ticketId: id(req.params.id), expectedVersion, toStage, reason, commandKey, ...(assigneeId === undefined ? {} : { assigneeId }) }) });
  });
  app.get('/api/cs/tickets/:id/internal-notes', async (req, res) => res.json({ data: await cs().listInternalNotes(req.scope, { plantId: plantId(req), ticketId: id(req.params.id) }) }));
  app.post('/api/cs/tickets/:id/internal-notes', async (req, res) => {
    fields(req.body, ['text', 'commandKey']);
    res.status(201).json({ data: await cs().addInternalNote(req.scope, { plantId: plantId(req), ticketId: id(req.params.id), text: req.body.text, commandKey: req.body.commandKey }) });
  });
  // ---- Wave 4f onboarding, simulator, order status through a binding, metrics ----
  const contractErrors = async fn => { try { return await fn(); } catch (e) { if (e?.code === 'SCOPE_DENIED') fail(403, 'FORBIDDEN', 'Forbidden'); if (e?.code === 'INVALID_INPUT') fail(400, 'VALIDATION', 'Invalid input'); throw e; } };
  const idempotencyKey = req => { const k = req.headers['idempotency-key']; if (typeof k !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(k)) fail(400, 'VALIDATION', 'Idempotency-Key header (8..100 of A-Z a-z 0-9 _ -) is required'); return k; };
  const strict = (body, allowed) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'VALIDATION', 'JSON object body required');
    const unknown = Object.keys(body).filter(k => !allowed.includes(k) && !['tenantId', 'tenant_id', 'plantId', 'plant_id', 'x-tenant-id', 'x-plant-id'].includes(k));
    if (unknown.length) fail(400, 'VALIDATION', `Unknown field: ${unknown[0]}`);
  };
  const query = (req, allowed) => { const unknown = Object.keys(req.query).filter(k => !allowed.includes(k) && !['tenantId', 'tenant_id', 'plantId', 'plant_id'].includes(k)); if (unknown.length) fail(400, 'VALIDATION', `Unknown query parameter: ${unknown[0]}`); };
  app.get('/api/cs/bindings', async (req, res) => contractErrors(async () => {
    query(req, ['accountId', 'status', 'limit', 'cursor']);
    const { limit = '25', cursor, accountId, status } = req.query;
    if (typeof limit !== 'string' || !/^[0-9]{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 || (cursor !== undefined && (typeof cursor !== 'string' || !cursor || cursor.length > 512))) fail(400, 'VALIDATION', 'Invalid pagination');
    const page = await cs().listBindingsPage(req.scope, { plantId: plantId(req), limit: Number(limit), ...(cursor === undefined ? {} : { cursor }), ...(accountId === undefined ? {} : { accountId }), ...(status === undefined ? {} : { status }) });
    res.json({ data: { items: page.items, nextCursor: page.nextCursor } });
  }));
  app.post('/api/cs/bindings', async (req, res) => contractErrors(async () => {
    strict(req.body, ['accountId', 'contactId', 'channel', 'address', 'expiresAt']);
    const { accountId, contactId, channel, address, expiresAt = null } = req.body;
    res.status(201).json({ data: await cs().createBinding(req.scope, { plantId: plantId(req), accountId, contactId, channel, address, expiresAt, idempotencyKey: idempotencyKey(req) }) });
  }));
  app.post('/api/cs/bindings/:id/revoke', async (req, res) => contractErrors(async () => {
    strict(req.body, ['reason', 'expectedVersion']);
    res.json({ data: await cs().revokeBindingByOperator(req.scope, { plantId: plantId(req), bindingId: req.params.id, reason: req.body.reason, expectedVersion: req.body.expectedVersion, idempotencyKey: idempotencyKey(req) }) });
  }));
  app.get('/api/cs/bindings/:id/order-status', async (req, res) => contractErrors(async () => {
    query(req, ['orderNumber']);
    if (typeof req.query.orderNumber !== 'string') fail(400, 'VALIDATION', 'orderNumber is required');
    res.json({ data: await cs().getOrderStatusForBinding(req.scope, { plantId: plantId(req), bindingId: req.params.id, orderNumber: req.query.orderNumber }) });
  }));
  // Local preview dispatcher for the SIMULATED channel: claims QUEUED rows and records PREVIEWED (never SENT).
  const drainPreviews = async (tenantId, deliveryIds) => {
    const preview = runtime.customerServicePreview, done = [];
    for (let i = 0; i < 25; i++) {
      const claim = await preview.claimNextDelivery({ tenantId, channelAccountId: SIMULATED_CHANNEL_ACCOUNT, leaseOwner: 'portfolio-api.simulator', deliveryIds });
      if (!claim) break;
      await preview.recordDeliveryResult({ tenantId, deliveryId: claim.deliveryId, fence: claim.fence, outcome: 'PREVIEWED', error: 'PREVIEW_ONLY_NO_PROVIDER' });
      done.push(claim.deliveryId);
    }
    return done;
  };
  app.post('/api/cs/simulator/inbound', async (req, res) => contractErrors(async () => {
    strict(req.body, ['bindingId', 'inboundKey', 'text']);
    const { bindingId, inboundKey, text } = req.body;
    const out = await cs().simulateInbound(req.scope, { plantId: plantId(req), bindingId, inboundKey, text });
    const ids = out.result.deliveryIds || [];
    const previewed = await drainPreviews(req.scope.tenantId, ids);
    const messages = ids.length ? await cs().getOutboundMessages(req.scope, { plantId: plantId(req), deliveryIds: ids }) : [];
    const replyId = out.result.reply?.deliveryId ?? null;
    res.json({ data: {
      conversationId: out.conversationId, bindingId: out.bindingId, command: out.command,
      reply: replyId ? messages.find(m => m.messageId === replyId) ?? null : null,
      ...(out.result.reply?.state === 'SUPPRESSED' ? { suppressed: true, mode: out.result.mode } : {}),
      ...(out.result.error ? { error: out.result.error } : {}),
      ...(out.result.receipt ? { ticket: { ticketId: out.result.receipt.ticketId, ticketNumber: out.result.receipt.ticketNumber } } : {}),
      ...(out.result.draft ? { draft: { stage: out.result.draft.stage, version: out.result.draft.version } } : {}),
      deliveries: messages, previewedDeliveryIds: previewed,
    } });
  }));
  app.post('/api/cs/simulator/dispatch', async (req, res) => contractErrors(async () => {
    strict(req.body, []);
    await runtime.foundation.authorize(req.scope, { plantId: plantId(req), action: 'cs.simulator.use' });
    res.json({ data: { previewedDeliveryIds: await drainPreviews(req.scope.tenantId) } });
  }));
  app.get('/api/cs/metrics', async (req, res) => contractErrors(async () => {
    query(req, ['from', 'to']);
    const parse = (v, fallback) => { if (v === undefined) return fallback; if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail(400, 'VALIDATION', 'from/to must be ISO-8601 UTC timestamps'); return new Date(v); };
    const to = parse(req.query.to, new Date()), from = parse(req.query.from, new Date(to.getTime() - 7 * 24 * 3600000));
    res.json({ data: await cs().getMetrics(req.scope, { plantId: plantId(req), from, to }) });
  }));
  app.get('/api/cs/conversations/by-binding/:bindingId', async (req, res) => res.json({ data: await cs().findConversationByBinding(req.scope, { plantId: plantId(req), bindingId: id(req.params.bindingId) }) }));
  app.get('/api/cs/conversations/:id', async (req, res) => res.json({ data: await cs().getConversationForOperator(req.scope, { plantId: plantId(req), conversationId: id(req.params.id) }) }));
  app.post('/api/cs/conversations/:id/takeover', async (req, res) => {
    fields(req.body, ['expectedVersion', 'commandKey']);
    res.json({ data: await cs().takeOverConversation(req.scope, { plantId: plantId(req), conversationId: id(req.params.id), expectedVersion: req.body.expectedVersion, commandKey: req.body.commandKey }) });
  });
  app.post('/api/cs/conversations/:id/mode', async (req, res) => {
    fields(req.body, ['expectedVersion', 'toMode', 'reason', 'commandKey']);
    const { expectedVersion, toMode, reason, commandKey } = req.body;
    res.json({ data: await cs().setConversationMode(req.scope, { plantId: plantId(req), conversationId: id(req.params.id), expectedVersion, toMode, reason, commandKey }) });
  });
  app.post('/api/cs/deliveries/:id/resolve', async (req, res) => {
    fields(req.body, ['resolution', 'evidence', 'providerMessageId', 'commandKey']);
    const { resolution, evidence, providerMessageId, commandKey } = req.body;
    res.json({ data: await cs().resolveUnknownDelivery(req.scope, { plantId: plantId(req), deliveryId: id(req.params.id), resolution, evidence, commandKey, ...(providerMessageId === undefined ? {} : { providerMessageId }) }) });
  });
}
