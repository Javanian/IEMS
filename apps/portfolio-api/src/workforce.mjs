import { createHmac, randomBytes, randomUUID, scrypt as rawScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { boundedTransaction, contentHash } from '../../../packages/tenant-foundation/commands.mjs';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { businessNow } from './business-clock.mjs';
import { exactUtc, reject } from './operations.mjs';

const scrypt = promisify(rawScrypt), purpose = 'ATTENDANCE_VERIFICATION';
export const workforceActions = ['workforce.read', 'workforce.configure', 'workforce.consent', 'workforce.challenge', 'workforce.verify'];
export const workforceRoles = { workforceSelf: ['workforce.read', 'workforce.configure', 'workforce.consent'], workforceKiosk: ['workforce.read', 'workforce.challenge', 'workforce.verify'] };
const publicProfile = p => ({ resourceId: p.resourceId, version: p.version, consent: p.consent, pinConfigured: Boolean(p.pinConfigured), nfcConfigured: Boolean(p.nfcConfigured), updatedAt: p.updatedAt ?? null });
const empty = (filter, resourceId) => ({ _id: randomUUID(), ...filter, resourceId, version: 0, consent: { active: false, purpose }, pinConfigured: false, nfcConfigured: false });
async function subject(runtime, filter, operatorId, session) {
  const user = await runtime.db.collection('users').findOneAndUpdate({ _id: operatorId, active: true }, { $inc: { workforceFence: 1 } }, { session, returnDocument: 'after' });
  const plant = await runtime.db.collection('plants').findOne({ tenantId:filter.tenantId,_id:filter.plantId,active:true },{session});
  if(!plant)reject(403,'SCOPE_DENIED');
  const member = await runtime.db.collection('memberships').findOneAndUpdate({ tenantId: filter.tenantId, userId: operatorId, active: true, $or: [{ tenantWide: true }, { plantIds: filter.plantId,legalEntityIds:plant.legalEntityId }] }, { $inc: { workforceFence: 1 } }, { session, returnDocument: 'after' });
  if (!user || !member) reject(404, 'ACTIVE_OPERATOR_NOT_FOUND');
}
export async function initializeWorkforce(db) {
  for (const [name, keys] of [['workforceProfiles', { tenantId: 1, plantId: 1, resourceId: 1 }], ['workforceSecrets', { tenantId: 1, plantId: 1, resourceId: 1 }], ['workforceResults', { tenantId: 1, plantId: 1, actorId: 1, key: 1 }], ['workforceThrottle', { tenantId: 1, plantId: 1, resourceId: 1 }], ['workforceDevices', { tenantId: 1, plantId: 1, deviceId: 1 }]]) await db.collection(name).createIndex(keys, { unique: true });
  await db.collection('workforceChallenges').createIndex({ expiresAt: 1 });
  await db.collection('workforceSecrets').createIndex({tenantId:1,plantId:1,nfcHash:1},{unique:true,partialFilterExpression:{nfcHash:{$type:'string'}}});
}
export function installWorkforce(app, runtime, helpers, { pepper, devices = {}, assertionVerifier } = {}) {
  const root = '/api/workforce', { id, fields } = helpers, db = runtime.db;
  const configured = typeof pepper === 'string' && Buffer.byteLength(pepper) >= 32;
  const digest = v => { if (!configured) reject(503, 'WORKFORCE_SECRET_NOT_CONFIGURED'); return createHmac('sha256', pepper).update(v).digest('hex'); };
  app.use(root, async (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (req.filter.plantId !== req.scope.selectedPlantId) reject(403, 'SCOPE_DENIED');
    req.workforceAction = `workforce.${req.method === 'GET' ? 'read' : req.path.split('/').at(-1)}`;
    if (!workforceActions.includes(req.workforceAction)) reject(404, 'NOT_FOUND');
    await runtime.foundation.authorize(req.scope, { ...req.filter, action: req.workforceAction }); next();
  });
  const authorize = (req, session) => runtime.foundation.authorizeInTransaction(req.scope, { ...req.filter, action: req.workforceAction }, { session });
  async function profile(req, operatorId, session, fence = false) {
    const filter = { ...req.filter, resourceId: operatorId };
    if (fence) return db.collection('workforceProfiles').findOneAndUpdate(filter, { $setOnInsert: empty(req.filter, operatorId), $inc: { useFence: 1 } }, { upsert: true, session, returnDocument: 'after' });
    return await db.collection('workforceProfiles').findOne(filter, { session }) || empty(req.filter, operatorId);
  }
  async function device(req, session) {
    const registered = devices[req.body.deviceId];
    if (!registered || typeof registered.authorize !== 'function') reject(403, 'KIOSK_NOT_REGISTERED');
    await registered.authorize({ scope: req.scope, filter: req.filter, session });
  }
  async function command(req, effect, beforeReplay = async () => {}) {
    const b = req.body, operatorId = id(req.params.id);
    if (!Number.isSafeInteger(b.expectedVersion) || b.expectedVersion < 0 || typeof b.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(b.idempotencyKey)) reject(400, 'INVALID_COMMAND');
    const inputHash = digest(contentHash({ path: req.path, body: b }));
    return boundedTransaction(runtime.client, async session => {
      await authorize(req, session); await subject(runtime, req.filter, operatorId, session);
      await beforeReplay(session, operatorId);
      const key = { ...req.filter, actorId: req.scope.userId, key: b.idempotencyKey };
      const previous = await db.collection('workforceResults').findOne(key, { session });
      if (previous) { if (previous.inputHash !== inputHash) reject(409, 'IDEMPOTENCY_CONFLICT'); return previous.result; }
      const result = await effect(session, operatorId);
      await db.collection('workforceResults').insertOne({ _id: randomUUID(), ...key, inputHash, result }, { session });
      const event = { _id: randomUUID(), ...req.filter, action: req.workforceAction, resourceId: operatorId, actorId: req.scope.userId, occurredAt: businessNow(runtime).toISOString(), version: result.version, outcome: result.status ?? 'SAVED' };
      await db.collection('workforceAudit').insertOne(event, { session });
      await db.collection('workforceOutbox').insertOne({ ...event, _id: randomUUID(), publication: 'PRIVATE_OPERATIONAL_ONLY', publishedAt: null }, { session });
      return result;
    });
  }
  async function save(req, p, session) {
    const key = { ...req.filter, resourceId: p.resourceId, version: req.body.expectedVersion };
    p.version++; p.updatedAt = businessNow(runtime).toISOString();
    const r = await db.collection('workforceProfiles').replaceOne(key, p, { session });
    if (r.matchedCount !== 1) reject(409, 'VERSION_CONFLICT');
    await db.collection('workforceRevisions').insertOne({ _id: randomUUID(), ...req.filter, ...publicProfile(p) }, { session });
    return publicProfile(p);
  }
  app.get(`${root}/capabilities`, async (req, res) => res.json({ data: { configured, faceVerification: configured && typeof assertionVerifier?.verify === 'function', fallback: ['NFC', 'PIN'], biometricEnrollment: false, purpose } }));
  app.get(`${root}/operators/:id`, async (req, res) => {
    const operatorId = id(req.params.id);
    const data = await boundedTransaction(runtime.client, async session => { await authorize(req, session); await subject(runtime, req.filter, operatorId, session); return publicProfile(await profile(req, operatorId, session)); }); res.json({ data });
  });
  for (const action of ['configure', 'consent']) app.post(`${root}/operators/:id/${action}`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'idempotencyKey', ...(action === 'consent' ? ['active', 'expiresAt', 'purpose'] : ['pin', 'nfcToken'])]);
    if (req.scope.userId !== id(req.params.id)) reject(403, 'SUBJECT_SELF_SERVICE_REQUIRED');
    const b = req.body;
    if (action === 'consent') {
      if (typeof b.active !== 'boolean' || b.purpose !== purpose) reject(400, 'EXPLICIT_CONSENT_REQUIRED');
      if (b.active) { exactUtc(b.expiresAt); const until = Date.parse(b.expiresAt), now = businessNow(runtime).getTime(); if (until <= now || until - now > 366 * 86400000) reject(400, 'CONSENT_EXPIRY_INVALID'); }
    } else {
      if (!Object.hasOwn(b, 'pin') && !Object.hasOwn(b, 'nfcToken')) reject(400, 'CREDENTIAL_REQUIRED');
      if (Object.hasOwn(b, 'pin') && b.pin !== null && (typeof b.pin !== 'string' || !/^\d{8,12}$/.test(b.pin))) reject(400, 'PIN_REQUIRES_8_TO_12_DIGITS');
      if (Object.hasOwn(b, 'nfcToken') && b.nfcToken !== null && (typeof b.nfcToken !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(b.nfcToken))) reject(400, 'INVALID_NFC_TOKEN');
    }
    const data = await command(req, async (session, operatorId) => {
      const p = await profile(req, operatorId, session, true); if (p.version !== b.expectedVersion) reject(409, 'VERSION_CONFLICT');
      if (action === 'consent') p.consent = { active: b.active, purpose, recordedAt: businessNow(runtime).toISOString(), expiresAt: b.active ? b.expiresAt : null };
      else {
        const key = { ...req.filter, resourceId: operatorId }, secret = await db.collection('workforceSecrets').findOne(key, { session }) || { _id: randomUUID(), ...key };
        if (Object.hasOwn(b, 'pin')) {
          secret.pinSalt = b.pin ? randomBytes(32).toString('hex') : null;
          secret.pinHash = b.pin ? (await scrypt(digest(b.pin), secret.pinSalt, 64)).toString('hex') : null; p.pinConfigured = Boolean(b.pin);
        }
        if (Object.hasOwn(b, 'nfcToken')) { secret.nfcHash = b.nfcToken ? digest(b.nfcToken) : null; p.nfcConfigured = Boolean(b.nfcToken); }
        try {await db.collection('workforceSecrets').replaceOne(key, secret, { session, upsert: true });}
        catch(error){if(error.code===11000)reject(409,'NFC_CREDENTIAL_ALREADY_REGISTERED');throw error;}
      }
      return save(req, p, session);
    }); res.json({ data });
  });
  app.post(`${root}/operators/:id/challenge`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'idempotencyKey', 'deviceId', 'method']);
    const b = req.body; if (!['FACE', 'NFC', 'PIN'].includes(b.method)) reject(400, 'INVALID_METHOD');
    const data = await command(req, async (session, operatorId) => {
      const p = await profile(req, operatorId, session, true), now = businessNow(runtime);
      if (p.version !== b.expectedVersion) reject(409, 'VERSION_CONFLICT');
      if (b.method === 'FACE' && (!p.consent.active || p.consent.expiresAt <= now.toISOString())) reject(409, 'CONSENT_REQUIRED_USE_FALLBACK');
      if (b.method === 'FACE' && typeof assertionVerifier?.verify !== 'function') reject(503, 'VERIFIER_UNAVAILABLE_USE_FALLBACK');
      if (b.method !== 'FACE' && !p[`${b.method.toLowerCase()}Configured`]) reject(409, 'FALLBACK_NOT_CONFIGURED');
      const throttleKey = { ...req.filter, resourceId: operatorId }, previous = await db.collection('workforceThrottle').findOne(throttleKey, { session });
      if (previous?.lockedUntil > now.toISOString()) reject(429, 'VERIFICATION_COOLDOWN');
      const sameWindow = previous && now.getTime() - Date.parse(previous.windowAt) < 60000;
      if (sameWindow && previous.challenges >= 5) reject(429, 'CHALLENGE_RATE_LIMIT');
      await db.collection('workforceThrottle').updateOne(throttleKey, { $set: { windowAt: sameWindow ? previous.windowAt : now.toISOString(), challenges: sameWindow ? previous.challenges + 1 : 1, failed: previous?.failed ?? 0, lockedUntil: previous?.lockedUntil ?? null } }, { session, upsert: true });
      const row = { _id: randomUUID(), ...req.filter, resourceId: operatorId, version: 1, profileVersion: p.version, method: b.method, deviceId: b.deviceId, nonce: randomBytes(32).toString('base64url'), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60000).toISOString(), consumed: false };
      await db.collection('workforceChallenges').insertOne(row, { session });
      return { challengeId: row._id, resourceId: operatorId, version: 1, profileVersion: p.version, method: row.method, nonce: row.nonce, expiresAt: row.expiresAt };
    }, async (session, operatorId) => {
      await device(req, session);
      const p = await profile(req, operatorId, session, true);
      if (b.method === 'FACE' && (!p.consent.active || p.consent.expiresAt <= businessNow(runtime).toISOString() || typeof assertionVerifier?.verify !== 'function')) reject(409, 'CONSENT_OR_VERIFIER_UNAVAILABLE_USE_FALLBACK');
    }); res.json({ data });
  });
  app.post(`${root}/operators/:id/verify`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'idempotencyKey', 'deviceId', 'challengeId', 'proof']);
    const b = req.body; id(b.challengeId);
    if (b.expectedVersion !== 1 || typeof b.proof !== 'string' || !b.proof.length || b.proof.length > 512) reject(400, 'INVALID_VERIFICATION');
    const data = await command(req, async (session, operatorId) => {
      const key = { ...req.filter, _id: b.challengeId, resourceId: operatorId }, challenge = await db.collection('workforceChallenges').findOne(key, { session });
      const now = businessNow(runtime), p = await profile(req, operatorId, session, true);
      if (!challenge || challenge.consumed || challenge.deviceId !== b.deviceId || challenge.expiresAt <= now.toISOString() || challenge.profileVersion !== p.version) reject(409, 'CHALLENGE_EXPIRED_OR_CHANGED');
      const throttleKey = { ...req.filter, resourceId: operatorId }, throttle = await db.collection('workforceThrottle').findOne(throttleKey, { session });
      if (throttle?.lockedUntil > now.toISOString()) reject(429, 'VERIFICATION_COOLDOWN');
      let matched = false, reason = 'NO_MATCH';
      if (challenge.method === 'FACE') {
        if (!p.consent.active || p.consent.expiresAt <= now.toISOString()) reject(409, 'CONSENT_REQUIRED_USE_FALLBACK');
        if (typeof assertionVerifier?.verify !== 'function') reject(503, 'VERIFIER_UNAVAILABLE_USE_FALLBACK');
        // Adapter validates a signed, one-to-one assertion against this nonce and subject. It must perform no enrollment, external sends or template persistence.
        try { const v = await assertionVerifier.verify({ assertionId: b.proof, operatorId, challengeId: challenge._id, nonce: challenge.nonce, deviceId: challenge.deviceId, filter: req.filter, now: now.toISOString(), session }); matched = v?.matched === true && v?.live === true && v?.subjectId === operatorId && v?.challengeId === challenge._id; }
        catch { reason = 'VERIFIER_ERROR_USE_FALLBACK'; }
      } else {
        const secret = await db.collection('workforceSecrets').findOne({ ...req.filter, resourceId: operatorId }, { session });
        if (challenge.method === 'PIN' && /^\d{8,12}$/.test(b.proof) && secret?.pinHash) { const test = await scrypt(digest(b.proof), secret.pinSalt, 64); const stored = Buffer.from(secret.pinHash, 'hex'); matched = stored.length === test.length && timingSafeEqual(test, stored); }
        if (challenge.method === 'NFC' && secret?.nfcHash) { const test = Buffer.from(digest(b.proof), 'hex'), stored = Buffer.from(secret.nfcHash, 'hex'); matched = stored.length === test.length && timingSafeEqual(test, stored); }
      }
      const consumed = await db.collection('workforceChallenges').updateOne({ ...key, consumed: false }, { $set: { consumed: true, consumedAt: now.toISOString() } }, { session }); if (consumed.matchedCount !== 1) reject(409, 'CHALLENGE_ALREADY_CONSUMED');
      const failed = matched ? 0 : (throttle?.failed ?? 0) + 1;
      await db.collection('workforceThrottle').updateOne(throttleKey, { $set: { failed, lockedUntil: failed >= 5 ? new Date(now.getTime() + 300000).toISOString() : null } }, { session, upsert: true });
      const result = { resourceId: operatorId, version: 1, verificationId: randomUUID(), status: matched ? 'VERIFIED' : 'REJECTED', method: challenge.method, reason: matched ? 'MATCHED' : reason, verifiedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60000).toISOString() };
      await db.collection('workforceVerifications').insertOne({ _id: result.verificationId, ...req.filter, ...result }, { session }); return result;
    }, async (session, operatorId) => {
      await device(req, session);
      const challenge = await db.collection('workforceChallenges').findOne({ ...req.filter, _id: b.challengeId, resourceId: operatorId }, { session });
      if (!challenge || challenge.deviceId !== b.deviceId) reject(404, 'CHALLENGE_NOT_FOUND');
      const p = await profile(req, operatorId, session, true);
      if (challenge.profileVersion !== p.version || challenge.expiresAt <= businessNow(runtime).toISOString()) reject(409, 'CHALLENGE_EXPIRED_OR_CHANGED');
      if (challenge.method === 'FACE' && (!p.consent.active || p.consent.expiresAt <= businessNow(runtime).toISOString())) reject(409, 'CONSENT_REQUIRED_USE_FALLBACK');
    }); res.json({ data });
  });
}
