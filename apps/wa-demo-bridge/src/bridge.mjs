import http from 'node:http';
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { createCustomerServicePort } from './customer-service-port.mjs';
import { SIMULATED_CHANNEL_ACCOUNT } from '@iems/customer-service';

export const contentHash = text => createHash('sha256').update(text).digest('hex');
export function signDelivery(claims, key) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const fail = (status, code) => { throw Object.assign(new Error(code), { status }); };
export async function createBridge({ db, tenant, account, serviceSecret, approvalKey, participants = [], receiveEnabled = false, liveEnabled = false, scopeAdapter, customerService, now = () => Date.now() }) {
  if (liveEnabled) fail(403, 'LIVE_POLICY_NOT_INTEGRATED');
  if (customerService && account !== SIMULATED_CHANNEL_ACCOUNT) throw new Error('Customer service preview requires the SIMULATED channel account');
  // customer-service keys tenants by UUID; a configured non-UUID tenant cannot be routed safely.
  if (customerService && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenant ?? '')) throw new Error('Invalid bridge configuration');
  if (!db || typeof serviceSecret !== 'string' || serviceSecret.length < 32 || typeof approvalKey !== 'string' || approvalKey.length < 32 || !tenant || !account) throw new Error('Invalid bridge configuration');
  const allowed = new Set(participants);
  const scope = { tenant, account };
  const sessions = db.collection('sessions'), outbox = db.collection('preview_outbox'), inbox = db.collection('preview_inbox'), policy = db.collection('policy');
  const bindings = db.collection('preview_bindings'), prompts = db.collection('preview_prompts');
  async function ownedPrompt(meta, s, session) {
    return prompts.findOne({ _id: meta.replyTo, ...scope, recipient: meta.recipient, sessionVersion: s.version, bindingVersion: s.bindingVersion, consumed: false, expiresAt: { $gt: now() } }, { session });
  }
  await bindings.createIndex({ tenant: 1, account: 1, recipient: 1 }, { unique: true });
  async function bindingFor(recipient, session) {
    return bindings.findOne({ ...scope, recipient, active: true, synthetic: true }, { session });
  }
  async function authorize(req, action, resource, session) {
    if (!scopeAdapter?.authenticate || !scopeAdapter?.authorize) fail(403, 'SCOPE_ADAPTER_REQUIRED');
    const actor = await scopeAdapter.authenticate(req, { session });
    if (!actor || await scopeAdapter.authorize(actor, `wa.preview.${action}`, { ...resource, ...scope }, { session }) !== true) fail(403, 'SCOPE_FORBIDDEN');
    return actor;
  }
  await outbox.createIndex({ tenant: 1, account: 1, key: 1 }, { unique: true });
  await outbox.createIndex({ tenant: 1, account: 1, nonce: 1 }, { unique: true });
  await inbox.createIndex({ tenant: 1, account: 1, eventId: 1 }, { unique: true });
  await sessions.createIndex({ tenant: 1, account: 1, recipient: 1 }, { unique: true });
  await policy.updateOne(scope, { $setOnInsert: { ...scope, paused: false } }, { upsert: true });
  async function transaction(work) {
    const session = db.client.startSession();
    try {
      return await session.withTransaction(async () => {
        // All authorization transitions contend on this scoped document.
        await policy.updateOne(scope, { $inc: { revision: 1 } }, { session });
        return work(session);
      });
    } finally { await session.endSession(); }
  }
  let ignored = 0;
  const publicMessage = m => ({ id: m._id, state: m.state, mode: 'PREVIEW_ONLY', providerMessageId: null, reason: m.reason ?? null });
  async function active(recipient, version, session) {
    const p = await policy.findOne(scope, { session });
    const s = await sessions.findOne({ ...scope, recipient }, { session });
    const binding = await bindingFor(recipient, session);
    return !!binding && binding.version === s?.bindingVersion && binding.customer === s?.customer && receiveEnabled && allowed.has(recipient) && !p.paused && s?.active === true && s.expiresAt > now() && s.lastActivity + 900000 > now() && (version === undefined || s.version === version);
  }
  async function cancel(recipient, reason, session) {
    await outbox.updateMany({ ...scope, ...(recipient ? { recipient } : {}), state: 'QUEUED' }, { $set: { state: 'CANCELLED', reason } }, { session });
  }
  async function recover() {
    // A remote submission cannot be disproved after a crash; never retry ambiguous work.
    await outbox.updateMany({ ...scope, state: 'SENDING' }, { $set: { state: 'UNKNOWN', reason: 'SIMULATOR_RECOVERY_AMBIGUOUS_NOT_LIVE' } });
    for (const m of await outbox.find({ ...scope, state: 'QUEUED' }).toArray()) {
      if (m.expiresAt <= now() || !await active(m.recipient, m.approvalVersion)) await cancelMessage(m._id);
    }
  }
  async function cancelMessage(id) { await outbox.updateOne({ ...scope, _id: id, state: 'QUEUED' }, { $set: { state: 'CANCELLED', reason: 'STALE_AUTHORIZATION' } }); }
  await recover();
  const csPort = customerService ? await createCustomerServicePort({ customerService, db, scope, transaction, active, isPaused: async () => (await policy.findOne(scope)).paused, now }) : null;
  // Customer-service commands run after the inbox commit; their own idempotency keys make retries safe.
  async function withCustomerService(meta, result) {
    if (!csPort || !(result.accepted || result.duplicate)) return result;
    const row = await inbox.findOne({ ...scope, eventId: meta.eventId });
    if (!row || row.recipient !== meta.recipient || row.promptId || !row.text.startsWith('IEMS ')) return result;
    return { ...result, cs: await csPort.handle(meta.recipient, meta.eventId, row.text, { duplicate: !!result.duplicate }) };
  }
  async function inbound(meta, readBody) {
    if (receiveEnabled && meta.tenant === tenant && meta.account === account && allowed.has(meta.recipient) && meta.kind === 'direct' && meta.fromMe === true && !meta.history && !meta.broadcast) {
      await transaction(async session => {
        await sessions.updateOne({ ...scope, recipient: meta.recipient }, { $set: { active: false }, $unset: { activationHash: '' }, $inc: { version: 1 } }, { session });
        await cancel(meta.recipient, 'UNKNOWN_MANUAL_OUTGOING', session);
      });
      ignored++;
      return { ignored: true, paused: true, requiresActivation: true };
    }
    if (!receiveEnabled || meta.tenant !== tenant || meta.account !== account || !allowed.has(meta.recipient) || meta.kind !== 'direct' || meta.history || meta.fromMe || meta.broadcast || !/^[A-Za-z0-9_-]{1,100}$/.test(meta.eventId ?? '')) { ignored++; return { ignored: true }; }
    const s = await sessions.findOne({ ...scope, recipient: meta.recipient });
    const binding = await bindingFor(meta.recipient);
    if (!binding || binding.version !== s?.bindingVersion || !s || s.expiresAt <= now() || s.lastActivity + 900000 <= now() || (await policy.findOne(scope)).paused) { ignored++; return { ignored: true }; }
    if (meta.replyTo !== undefined && (typeof meta.replyTo !== 'string' || !await ownedPrompt(meta, s))) { ignored++; return { ignored: true }; }
    const text = await readBody();
    if (typeof text !== 'string' || text.length > 4096) { ignored++; return { ignored: true }; }
    return withCustomerService(meta, await transaction(async session => {
      const current = await sessions.findOne({ ...scope, recipient: meta.recipient }, { session });
      const p = await policy.findOne(scope, { session });
      const currentBinding = await bindingFor(meta.recipient, session);
      if (!currentBinding || currentBinding.version !== current?.bindingVersion || p.paused || !current || current.version !== s.version || current.active !== s.active || current.expiresAt <= now() || current.lastActivity + 900000 <= now()) { ignored++; return { ignored: true }; }
      if (!current.active) {
        if (!equal(contentHash(text), current.activationHash)) { ignored++; return { ignored: true }; }
        await sessions.updateOne({ _id: current._id }, { $set: { active: true, lastActivity: now() }, $unset: { activationHash: '' } }, { session });
        return { activated: true, mode: 'PREVIEW_ONLY' };
      }
      if (text === 'IEMS STOP') {
        await sessions.updateOne({ _id: current._id }, { $set: { active: false }, $inc: { version: 1 } }, { session });
        await cancel(meta.recipient, 'STOP', session); return { stopped: true };
      }
      const prompt = meta.replyTo === undefined ? null : await ownedPrompt(meta, current, session);
      if ((meta.replyTo !== undefined && !prompt) || (!prompt && !text.startsWith('IEMS ')) || text.startsWith('IEMS DEMO ')) { ignored++; return { ignored: true }; }
      if (await inbox.findOne({ ...scope, eventId: meta.eventId }, { session })) return { duplicate: true };
      if (prompt) await prompts.updateOne({ _id: prompt._id }, { $set: { consumed: true } }, { session });
      await inbox.insertOne({ ...scope, eventId: meta.eventId, recipient: meta.recipient, customer: current.customer, bindingVersion: current.bindingVersion, sessionVersion: current.version, promptId: prompt?._id ?? null, text, receivedAt: now() }, { session });
      await sessions.updateOne({ _id: current._id }, { $set: { lastActivity: now() } }, { session });
      return { accepted: true, mode: 'PREVIEW_ONLY' };
    }));
  }
  function verify(token) {
    if (typeof token !== 'string' || token.length > 4096) fail(403, 'INVALID_APPROVAL');
    const parts = token.split('.');
    if (parts.length !== 2 || !equal(parts[1], createHmac('sha256', approvalKey).update(parts[0]).digest('base64url'))) fail(403, 'INVALID_APPROVAL');
    try {
      const claims = JSON.parse(Buffer.from(parts[0], 'base64url'));
      if (!claims || typeof claims !== 'object' || Array.isArray(claims)) fail(403, 'INVALID_APPROVAL');
      return claims;
    } catch { fail(403, 'INVALID_APPROVAL'); }
  }
  async function createMessage(b) {
    if ((b.tenant !== undefined && b.tenant !== tenant) || (b.account !== undefined && b.account !== account)) fail(403, 'SCOPE_OVERRIDE');
    const c = verify(b.authorization);
    if (typeof b.text !== 'string' || b.text.length > 4096 || !/^[A-Za-z0-9_-]{1,100}$/.test(b.key ?? '') || !allowed.has(b.recipient)) fail(400, 'INVALID_MESSAGE');
    if (c.kind !== 'operator-approved-preview' || c.tenant !== tenant || c.account !== account || c.recipient !== b.recipient || c.contentHash !== contentHash(b.text) || c.key !== b.key || typeof c.nonce !== 'string' || !c.nonce || !Number.isInteger(c.approvalVersion) || !Number.isFinite(c.expiresAt) || c.expiresAt <= now() || c.expiresAt > now() + 300000) fail(403, 'APPROVAL_SCOPE_OR_EXPIRY');
    const fingerprint = contentHash(JSON.stringify([b.recipient, b.text, c.approvalVersion]));
    const previous = await outbox.findOne({ ...scope, key: b.key });
    if (previous) { if (previous.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_PAYLOAD_CONFLICT'); return publicMessage(previous); }
    const m = { _id: randomUUID(), ...scope, key: b.key, nonce: c.nonce, recipient: b.recipient, text: b.text, fingerprint, contentHash: c.contentHash, approvalVersion: c.approvalVersion, expiresAt: c.expiresAt, state: 'QUEUED', createdAt: now() };
    try {
      await transaction(async session => {
        const existing = await outbox.findOne({ ...scope, key: b.key }, { session });
        if (existing) { if (existing.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_PAYLOAD_CONFLICT'); return; }
        if (c.expiresAt <= now() || !await active(b.recipient, c.approvalVersion, session)) fail(403, 'INACTIVE_OR_STALE_SESSION');
        const binding = await bindingFor(b.recipient, session);
        m.bindingVersion = binding.version; m.customer = binding.customer;
        await outbox.insertOne(m, { session });
      });
    } catch (e) {
      if (e.code !== 11000) throw e;
      const duplicate = await outbox.findOne({ ...scope, key: b.key });
      if (!duplicate || duplicate.fingerprint !== fingerprint) fail(409, 'REPLAY_OR_PAYLOAD_CONFLICT');
      return publicMessage(duplicate);
    }
    return publicMessage(await outbox.findOne({ ...scope, key: b.key }));
  }
  async function dispatch(id, simulation = 'preview') {
    if (!['preview', 'ambiguous'].includes(simulation)) fail(400, 'INVALID_SIMULATION');
    return transaction(async session => {
      const m = await outbox.findOne({ ...scope, _id: id }, { session });
      if (!m) fail(404, 'NOT_FOUND');
      if (m.state !== 'QUEUED') return publicMessage(m);
      const binding = await bindingFor(m.recipient, session);
      const stale = !binding || binding.version !== m.bindingVersion || binding.customer !== m.customer || m.expiresAt <= now() || !await active(m.recipient, m.approvalVersion, session);
      // No adapter exists here: PREVIEWED records local preparation, never delivery.
      await outbox.updateOne({ ...scope, _id: id, state: 'QUEUED' }, { $set: stale
        ? { state: 'CANCELLED', reason: 'STALE_AUTHORIZATION' }
        : { state: simulation === 'ambiguous' ? 'UNKNOWN' : 'PREVIEWED', reason: simulation === 'ambiguous' ? 'SIMULATED_PROVIDER_TIMEOUT_NOT_LIVE' : 'LOCAL_PREVIEW_NO_PROVIDER_CALL' } }, { session });
      return publicMessage(await outbox.findOne({ ...scope, _id: id }, { session }));
    });
  }
  const server = http.createServer(async (req, res) => {
    const respond = (status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      if (req.url === '/health' && req.method === 'GET') { await db.command({ ping: 1 }); return respond(200, { healthy: true, mode: 'PREVIEW_ONLY' }); }
      const operatorRoute = req.method === 'POST' && ['/bindings', '/bindings/revoke', '/prompts', '/session', '/session/pause', '/session/resume'].includes(req.url);
      if (!operatorRoute && !equal(req.headers.authorization, `Bearer ${serviceSecret}`)) fail(401, 'UNAUTHORIZED');
      if (req.url === '/status' && req.method === 'GET') return respond(200, { ...scope, mode: 'PREVIEW_ONLY', liveEnabled: false, receiveEnabled, ignored, paused: (await policy.findOne(scope)).paused, queued: await outbox.countDocuments({ ...scope, state: 'QUEUED' }) });
      if (req.method === 'GET' && req.url === '/session') return respond(200, { mode: 'PREVIEW_ONLY', paused: (await policy.findOne(scope)).paused, sessions: (await sessions.find(scope, { projection: { recipient: 1, active: 1, version: 1, expiresAt: 1 } }).toArray()).map(s => ({ recipient: s.recipient, active: s.active && s.expiresAt > now(), version: s.version, expiresAt: s.expiresAt })) });
      if (req.method === 'GET' && req.url.startsWith('/messages/')) {
        await recover();
        const m = await outbox.findOne({ ...scope, _id: req.url.slice(10) });
        if (!m) fail(404, 'NOT_FOUND'); return respond(200, publicMessage(m));
      }
      if (req.method !== 'POST') fail(404, 'NOT_FOUND');
      if (req.url === '/session/live') fail(403, 'LIVE_POLICY_NOT_INTEGRATED');
      let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16384) fail(413, 'TOO_LARGE'); }
      let b; try { b = JSON.parse(raw); } catch { fail(400, 'INVALID_JSON'); }
      if (!b || typeof b !== 'object' || Array.isArray(b)) fail(400, 'INVALID_JSON');
      req.operatorBody = b;
      if ((b.tenant !== undefined && b.tenant !== tenant) || (b.account !== undefined && b.account !== account)) fail(403, 'SCOPE_OVERRIDE');
      if (req.url === '/prompts') {
        const result = await transaction(async session => {
          await authorize(req, 'prompt.create', { recipient: b.recipient }, session);
          if (!Number.isInteger(b.sessionVersion) || !await active(b.recipient, b.sessionVersion, session) || !Number.isFinite(b.expiresAt) || b.expiresAt <= now() || b.expiresAt > now() + 300000) fail(403, 'INVALID_PROMPT_SCOPE');
          const s = await sessions.findOne({ ...scope, recipient: b.recipient }, { session });
          const id = randomUUID();
          await prompts.insertOne({ _id: id, ...scope, recipient: b.recipient, sessionVersion: s.version, bindingVersion: s.bindingVersion, expiresAt: Math.min(b.expiresAt, s.expiresAt), consumed: false }, { session });
          return { id, mode: 'PREVIEW_ONLY', providerMessageId: null };
        });
        return respond(200, result);
      }
      if (req.url === '/bindings' || req.url === '/bindings/revoke') {
        const result = await transaction(async session => {
          const actor = await authorize(req, req.url === '/bindings' ? 'binding.create' : 'binding.revoke', { recipient: b.recipient, customer: b.customer }, session);
          if (!allowed.has(b.recipient) || !Number.isInteger(b.expectedVersion)) fail(400, 'INVALID_BINDING');
          const previous = await bindings.findOne({ ...scope, recipient: b.recipient }, { session });
          if ((previous?.version ?? 0) !== b.expectedVersion) fail(409, 'BINDING_VERSION_CONFLICT');
          if (req.url === '/bindings') {
            if (previous) fail(409, 'BINDING_IMMUTABLE');
            if (b.synthetic !== true || !/^[A-Za-z0-9_-]{1,100}$/.test(b.customer ?? '')) fail(400, 'SYNTHETIC_CUSTOMER_REQUIRED');
            await bindings.insertOne({ ...scope, recipient: b.recipient, customer: b.customer, synthetic: true, active: true, version: 1, verifiedBy: actor.id, verifiedAt: now() }, { session });
            return { version: 1, mode: 'PREVIEW_ONLY' };
          }
          if (!previous) fail(404, 'NOT_FOUND');
          await bindings.updateOne({ _id: previous._id }, { $set: { active: false, revokedAt: now() }, $inc: { version: 1 } }, { session });
          await sessions.updateOne({ ...scope, recipient: b.recipient }, { $set: { active: false }, $unset: { activationHash: '' }, $inc: { version: 1 } }, { session });
          await cancel(b.recipient, 'BINDING_REVOKED', session);
          return { version: previous.version + 1, revoked: true };
        });
        return respond(200, result);
      }
      if (req.url === '/session') {
        if ((await policy.findOne(scope)).paused) fail(403, 'GLOBAL_PAUSE');
        if (!receiveEnabled || !allowed.has(b.recipient) || typeof b.code !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(b.code) || !Number.isFinite(b.expiresAt) || b.expiresAt <= now() || b.expiresAt > now() + 7200000) fail(400, 'INVALID_SESSION');
        await transaction(async session => {
          if ((await policy.findOne(scope, { session })).paused) fail(403, 'GLOBAL_PAUSE');
          await authorize(req, 'session.create', { recipient: b.recipient }, session);
          const binding = await bindingFor(b.recipient, session);
          if (!binding) fail(403, 'TRUSTED_BINDING_REQUIRED');
          await cancel(b.recipient, 'SESSION_REPLACED', session);
          await sessions.updateOne({ ...scope, recipient: b.recipient }, { $set: { bindingVersion: binding.version, customer: binding.customer, active: false, activationHash: contentHash(`IEMS DEMO ${b.code}`), expiresAt: b.expiresAt, lastActivity: now() }, $inc: { version: 1 } }, { upsert: true, session });
        });
        const s = await sessions.findOne({ ...scope, recipient: b.recipient }); return respond(200, { version: s.version, active: false, mode: 'PREVIEW_ONLY' });
      }
      if (req.url === '/session/pause') {
        await transaction(async session => {
          await authorize(req, 'policy.pause', {}, session);
          await policy.updateOne(scope, { $set: { paused: true } }, { session });
          await sessions.updateMany(scope, { $set: { active: false }, $inc: { version: 1 } }, { session });
          await cancel(null, 'GLOBAL_PAUSE', session);
        });
        return respond(200, { paused: true });
      }
      if (req.url === '/session/resume') {
        await transaction(async session => {
          await authorize(req, 'policy.resume', {}, session);
          await policy.updateOne(scope, { $set: { paused: false } }, { session });
        });
        return respond(200, { paused: false, requiresActivation: true });
      }
      if (req.url === '/cs/dispatch') {
        if (!csPort) fail(404, 'NOT_FOUND');
        // Tenant, channel account, lease owner and simulation are fixed by bridge config; callers supply nothing.
        if (Object.keys(b).length || ['x-tenant-id', 'x-plant-id', 'x-channel-account', 'x-account'].some(h => req.headers[h] !== undefined)) fail(403, 'CALLER_SCOPE_FORBIDDEN');
        return respond(200, { mode: 'PREVIEW_ONLY', delivery: await csPort.dispatch('preview') });
      }
      if (req.url === '/inbound') return respond(200, await inbound(b.metadata ?? {}, () => b.text));
      if (req.url === '/messages') return respond(200, await createMessage(b));
      const match = /^\/messages\/([a-f0-9-]+)\/preview$/.exec(req.url);
      if (match) return respond(200, await dispatch(match[1]));
      fail(404, 'NOT_FOUND');
    } catch (e) { respond(e.status ?? 503, { error: e.status ? e.message : 'UNAVAILABLE' }); }
  });
  return { server, inbound, dispatch, recover, ...(csPort ? { dispatchCustomerService: csPort.dispatch } : {}) };
}
