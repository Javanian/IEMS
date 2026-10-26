import express from 'express';
import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { createTenantFoundation, resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { installCommercial, initializeCommercial, roleActions } from './commercial.mjs';
import { installProcurement, initializeProcurement, procurementRoles, procurementActions } from './procurement.mjs';
import { installWarehouse, initializeWarehouse, warehouseRoles, warehouseActions } from './warehouse.mjs';
import { installManufacturing, initializeManufacturing, manufacturingRoles, manufacturingActions } from './manufacturing.mjs';
import { installFulfillment, initializeFulfillment, fulfillmentRoles, fulfillmentActions } from './fulfillment.mjs';
import { installCustomerService, initializeCustomerService, customerServiceRoles, customerServiceOwnerActions } from './customer-service.mjs';
import { installRepair, initializeRepair, repairRoles, repairActions } from './repair.mjs';
import { installDocuments, initializeDocuments, documentRoles, documentActions } from './documents.mjs';
import { initializeInternalPlanning, installInternalPlanning, internalPlanningActions, internalPlanningRoles } from './internal-production.mjs';
import { initializeCatalogProcurement, installCatalogProcurement, catalogActions, catalogRoles } from './catalog-procurement.mjs';
import { initializeCatalogDisposition, installCatalogDisposition, catalogDispositionActions, catalogDispositionRoles } from './catalog-disposition.mjs';
import { initializeDelivery, installDelivery, deliveryActions, deliveryRoles } from './delivery.mjs';
import { initializeCatalogStock, installCatalogStock, catalogStockActions, catalogStockRoles } from './catalog-stock.mjs';
import { initializeInternalExecution, installInternalExecution, internalExecutionActions, internalExecutionRoles } from './internal-execution.mjs';
import { initializeCompanyStock, installCompanyStock, companyStockActions, companyStockRoles } from './company-stock.mjs';
import { initializePurchasedFulfillment, installPurchasedFulfillment, purchasedFulfillmentActions, purchasedFulfillmentRoles } from './purchased-fulfillment.mjs';
import { bindBusinessClock, businessNow } from './business-clock.mjs';
Object.assign(roleActions, documentRoles, repairRoles, procurementRoles, warehouseRoles, manufacturingRoles, fulfillmentRoles, customerServiceRoles);
Object.assign(roleActions, internalPlanningRoles);
Object.assign(roleActions, catalogRoles);
Object.assign(roleActions, catalogDispositionRoles);
Object.assign(roleActions, deliveryRoles);
Object.assign(roleActions, catalogStockRoles);
Object.assign(roleActions, internalExecutionRoles);
Object.assign(roleActions, companyStockRoles);
Object.assign(roleActions, purchasedFulfillmentRoles);
roleActions.owner.push(...documentActions, ...repairActions, ...procurementActions, ...warehouseActions, ...manufacturingActions, ...fulfillmentActions, ...customerServiceOwnerActions);
roleActions.owner.push(...internalPlanningActions);
roleActions.owner.push(...catalogActions);
roleActions.owner.push(...catalogDispositionActions);
roleActions.owner.push(...deliveryActions);
roleActions.owner.push(...catalogStockActions);
roleActions.owner.push(...internalExecutionActions);
roleActions.owner.push(...companyStockActions);
roleActions.owner.push(...purchasedFulfillmentActions);
const scrypt = promisify(scryptCallback);
const actions = ['crm.read', 'crm.write'];
export const fail = (status, code, message = code) => { throw Object.assign(new Error(message), { status, code }); };
const hash = value => createHash('sha256').update(value).digest('hex');
const c = (runtime, name) => runtime.db.collection(name);
export async function initialize({ client, db, customerService = {}, businessClock, ownedRunMarker }) {
  const runtime = { client, db };
  await bindBusinessClock(runtime, businessClock, ownedRunMarker);
  const foundation = createTenantFoundation({ client, db, roleActions });
  await foundation.initialize();
  await initializeCommercial(db);
  await initializeProcurement(db);
  await initializeWarehouse(db);
  await initializeManufacturing(db);
  await initializeInternalPlanning(db);
  await initializeCatalogProcurement(db);
  await initializeCatalogDisposition(db);
  await initializeRepair(db);
  await initializeFulfillment(db);
  await initializeDelivery(db);
  await initializeCatalogStock(db);
  await initializeInternalExecution(db);
  await initializeCompanyStock(db);
  await initializePurchasedFulfillment(db);
  await db.collection('credentials').createIndex({ username: 1 }, { unique: true });
  runtime.foundation = foundation;
  runtime.documents = await initializeDocuments(runtime);
  runtime.customerService = await initializeCustomerService(runtime, customerService);
  return runtime;
}
export async function seedSynthetic(runtime, { password, e01Operators = false }) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) fail(400, 'PASSWORD_POLICY');
  if (!/^portfolio_(owned|test)_/.test(runtime.db.databaseName)) fail(403, 'OWNED_DATABASE_REQUIRED');
  if (await c(runtime, 'credentials').countDocuments()) fail(409, 'ALREADY_SEEDED');
  const result = [];
  for (const name of ['alpha', 'beta']) {
    const tenantId = randomUUID(), userId = randomUUID(), legalEntityId = randomUUID(), plantId = randomUUID(), membershipId = randomUUID();
    const f = runtime.foundation;
    await f.provisionTenant({ id: tenantId });
    await f.provisionUser({ id: userId, tenantId });
    await f.provisionLegalEntity({ id: legalEntityId, tenantId });
    await f.provisionPlant({ id: plantId, tenantId, legalEntityId });
    await f.provisionMembership({ id: membershipId, tenantId, userId, legalEntityIds: [legalEntityId], plantIds: [plantId], roles: [{ role: 'owner', plantIds: [plantId] }] });
    const salt = randomBytes(16).toString('hex');
    const digest = (await scrypt(password, salt, 64)).toString('hex');
    await c(runtime, 'credentials').insertOne({ _id: userId, username: `${name}.owner`, salt, digest, tenantId, plantId });
    result.push({ username: `${name}.owner`, tenantId, plantId, userId, membershipId, roles: ['owner'] });
  }
  // Wave 4f separation-of-duties users (alpha tenant/plant only): apply-only, apply+release, read-only.
  const alpha = result[0], legalEntityId = (await c(runtime, 'plants').findOne({ _id: alpha.plantId })).legalEntityId;
  for (const [username, roles] of [['alpha.inspector', ['warehouseHoldApply']], ['alpha.quality', ['warehouseQuality']], ['alpha.viewer', ['warehouseRead']], ...(e01Operators ? [['alpha.operator.cnc', ['manufacturingRecord']], ['alpha.operator.assembly', ['manufacturingRecord']]] : [])]) {
    const userId = randomUUID(), membershipId = randomUUID();
    await runtime.foundation.provisionUser({ id: userId, tenantId: alpha.tenantId });
    await runtime.foundation.provisionMembership({ id: membershipId, tenantId: alpha.tenantId, userId, legalEntityIds: [legalEntityId], plantIds: [alpha.plantId], roles: roles.map(role => ({ role, plantIds: [alpha.plantId] })) });
    const salt = randomBytes(16).toString('hex');
    const digest = (await scrypt(password, salt, 64)).toString('hex');
    await c(runtime, 'credentials').insertOne({ _id: userId, username, salt, digest, tenantId: alpha.tenantId, plantId: alpha.plantId });
    result.push({ username, tenantId: alpha.tenantId, plantId: alpha.plantId, userId, membershipId, roles });
  }
  return result;
}
function tokenFrom(req) {
  const tokens = (req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith('portfolio_session='));
  if (tokens.length !== 1) fail(401, 'UNAUTHENTICATED');
  return tokens[0].slice('portfolio_session='.length);
}
export function createApp(runtime, { origins, secureCookie = false } = {}) {
  if (!Array.isArray(origins) || !origins.length || origins.some(o => new URL(o).origin !== o)) throw new Error('exact origins required');
  const app = express();
  app.disable('x-powered-by');
  app.enable('case sensitive routing');
  app.enable('strict routing');
  app.use((req, res, next) => {
    if (req.headers.origin && !origins.includes(req.headers.origin)) return next(Object.assign(new Error('Origin denied'), { status: 403, code: 'ORIGIN_DENIED' }));
    if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin'); }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (!origins.includes(req.headers.origin) || req.headers['sec-fetch-site'] === 'cross-site' || !req.is('application/json'))) return next(Object.assign(new Error('Mutation requires trusted Origin and JSON'), { status: 403, code: 'MUTATION_DENIED' }));
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key'); return res.sendStatus(204); }
    next();
  });
  app.use(express.json({ limit: '32kb', strict: true }));
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: secureCookie, path: '/', maxAge: 3600000 };
  app.post('/api/session/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 100 || password.length > 256) fail(401, 'INVALID_CREDENTIALS');
    const record = await c(runtime, 'credentials').findOne({ username });
    const digest = await scrypt(password, record?.salt || 'nonexistent-user-salt', 64);
    if (!record || !timingSafeEqual(digest, Buffer.from(record.digest, 'hex'))) fail(401, 'INVALID_CREDENTIALS');
    const session = await runtime.foundation.issueSession({ userId: record._id, tenantId: record.tenantId, selectedPlantId: record.plantId, ttlMs: 3600000 });
    const scope = await runtime.foundation.authenticate(session.token);
    res.cookie('portfolio_session', session.token, cookieOptions).json({ data: identity(scope, record.username) });
  });
  app.use('/api', async (req, res, next) => {
    try { req.token = tokenFrom(req); req.scope = await runtime.foundation.authenticate(req.token); next(); }
    catch { fail(401, 'UNAUTHENTICATED'); }
  });
  app.get('/api/session/me', async (req, res) => {
    const credential = await c(runtime, 'credentials').findOne({ _id: req.scope.userId });
    const membership = await c(runtime, 'memberships').findOne({ _id: req.scope.membershipId, tenantId: req.scope.tenantId, active: true });
    const permissions = [...new Set((membership?.roles || []).filter(g => g.tenantWide || g.plantIds.includes(req.scope.selectedPlantId)).flatMap(g => roleActions[g.role] || []))].sort();
    res.json({ data: { ...identity(req.scope, credential?.username), permissions, ...(runtime.businessClock ? { fixtureReplay: { mode: runtime.businessClockMode, businessTime: businessNow(runtime).toISOString(), recordedAt: new Date().toISOString() } } : {}) } });
  });
  app.post('/api/session/logout', async (req, res) => {
    const session = await c(runtime, 'sessions').findOne({ tokenHash: hash(req.token) });
    await runtime.foundation.revokeSession({ tenantId: req.scope.tenantId, sessionId: session._id });
    res.clearCookie('portfolio_session', { ...cookieOptions, maxAge: undefined }).json({ data: { loggedOut: true } });
  });
  installCrm(app, runtime);
  installDocuments(app, runtime, { fail, guard, id });
  installCommercial(app, runtime, { fail, guard, id, fields });
  installProcurement(app, runtime, { fail, guard, id, fields });
  installWarehouse(app, runtime, { fail, guard, id, fields });
  installManufacturing(app, runtime, { fail, guard, id, fields });
  installInternalPlanning(app, runtime, { fail, guard, id, fields });
  installCatalogProcurement(app, runtime, { fail, guard, id, fields });
  installCatalogDisposition(app, runtime, { fail, guard, id, fields });
  installRepair(app, runtime, { fail, guard, id, fields });
  installFulfillment(app, runtime, { fail, guard, id, fields });
  installDelivery(app, runtime, { guard, id, fields });
  installCatalogStock(app, runtime, { id });
  installInternalExecution(app, runtime, { guard, fields, id });
  installCompanyStock(app, runtime, { guard, fields, id });
  installPurchasedFulfillment(app, runtime, { guard, fields, id });
  installCustomerService(app, runtime, { fail, id, fields });
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } }));
  app.use((error, req, res, next) => {
    const status = error.status || (error.code === 'SCOPE_DENIED' ? 403 : 500);
    res.status(status).json({ error: { code: status === 500 ? 'INTERNAL_ERROR' : error.code || 'INVALID_REQUEST', message: status === 500 ? 'Internal error' : error.message, ...(status !== 500 && Number.isSafeInteger(error.currentVersion) ? { currentVersion: error.currentVersion } : {}) } });
  });
  return app;
}
function identity(scope, username) { return { user: { id: scope.userId, username }, scope: { tenantId: scope.tenantId, plantId: scope.selectedPlantId }, capabilities: actions }; }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = value => { if (typeof value !== 'string' || !uuidPattern.test(value)) fail(400, 'INVALID_ID'); return value; };
const text = (value, max = 200) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, 'INVALID_TEXT'); return value.trim(); };
const stages = ['NEW', 'QUALIFIED', 'QUOTING', 'WON', 'LOST'];
const scales = { USD: 2, EUR: 2, GBP: 2, IDR: 2, JPY: 0, KWD: 3 };
function money(amount, currency) {
  const scale = Object.hasOwn(scales, currency) ? scales[currency] : undefined;
  if (scale === undefined || typeof amount !== 'string' || !new RegExp(`^(0|[1-9][0-9]{0,27})${scale ? `\\.[0-9]{${scale}}` : ''}$`).test(amount)) fail(400, 'INVALID_MONEY');
  return amount;
}
function fields(body, allowed) {
  if (!body || Array.isArray(body) || Object.keys(body).some(k => ![...allowed, 'tenantId', 'tenant_id', 'plantId', 'plant_id', 'x-tenant-id', 'x-plant-id'].includes(k))) fail(400, 'UNKNOWN_FIELD');
}
async function guard(runtime, req, session, action = 'crm.write') {
  const s = req.scope;
  const opts = { session };
  const current = await c(runtime, 'sessions').findOneAndUpdate({ tokenHash: hash(req.token), revoked: false, expiresAt: { $gt: new Date() }, membershipVersion: s.membershipVersion }, { $inc: { crmFence: 1 } }, opts);
  if (!current) fail(401, 'UNAUTHENTICATED');
  const m = await c(runtime, 'memberships').findOneAndUpdate({ _id: s.membershipId, tenantId: s.tenantId, userId: s.userId, active: true, version: s.membershipVersion }, { $inc: { crmFence: 1 } }, opts);
  if (!m || (!m.tenantWide && !m.plantIds.includes(s.selectedPlantId)) || !m.roles.some(g => (g.tenantWide || g.plantIds.includes(s.selectedPlantId)) && roleActions[g.role]?.includes(action))) fail(403, 'SCOPE_DENIED');
  for (const [name, filter] of [['users', { _id: s.userId }], ['tenants', { _id: s.tenantId }], ['plants', { _id: s.selectedPlantId, tenantId: s.tenantId }]]) {
    const row = await c(runtime, name).findOneAndUpdate({ ...filter, active: true }, { $inc: { crmFence: 1 } }, opts);
    if (!row) fail(403, 'SCOPE_DENIED');
    if (name === 'plants') {
      const entity = await c(runtime, 'legalEntities').findOneAndUpdate({ _id: row.legalEntityId, tenantId: s.tenantId, active: true }, { $inc: { crmFence: 1 } }, opts);
      if (!entity || (!m.tenantWide && !m.legalEntityIds.includes(entity._id))) fail(403, 'SCOPE_DENIED');
    }
  }
}
function installCrm(app, runtime) {
  app.use('/api/crm', async (req, res, next) => {
    const aliases = { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId };
    const scope = resolveScopeAliases({ body: { ...aliases, ...(req.body || {}) }, query: req.query, headers: req.headers });
    await runtime.foundation.authorize(req.scope, { ...scope, action: req.method === 'GET' ? 'crm.read' : 'crm.write' });
    if (scope.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    req.filter = { tenantId: scope.tenantId, plantId: scope.plantId };
    next();
  });
  const find = async (name, req, key, session) => {
    const row = await c(runtime, name).findOne({ ...req.filter, _id: id(key) }, { session });
    if (!row) fail(404, 'NOT_FOUND');
    return row;
  };
  const transaction = async (req, kind, effect) => {
    const session = runtime.client.startSession();
    try {
      return await session.withTransaction(async () => {
        await guard(runtime, req, session);
        const result = await effect(session);
        await c(runtime, 'crmAudit').insertOne({ _id: randomUUID(), ...req.filter, userId: req.scope.userId, kind, subjectId: result._id, version: result.version, occurredAt: new Date() }, { session });
        return result;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    } finally { await session.endSession(); }
  };
  const list = async (name, req, res, extra = {}) => {
    const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
    const predicate = { ...req.filter, ...extra };
    if (req.query.cursor !== undefined) predicate._id = { $gt: id(req.query.cursor) };
    const rows = await c(runtime, name).find(predicate).sort({ _id: 1 }).limit(limit + 1).toArray();
    const more = rows.length > limit; const data = rows.slice(0, limit);
    res.json({ data, page: { limit, nextCursor: more ? data.at(-1)._id : null } });
  };
  const base = req => ({ _id: randomUUID(), ...req.filter, ownerId: req.scope.userId, version: 1, createdAt: new Date(), updatedAt: new Date() });
  app.get('/api/crm/accounts', (req, res) => list('accounts', req, res));
  app.get('/api/crm/accounts/:id', async (req, res) => res.json({ data: await find('accounts', req, req.params.id) }));
  app.post('/api/crm/accounts', async (req, res) => {
    fields(req.body, ['name']); const name = text(req.body.name);
    const data = await transaction(req, 'account.created', async session => {
      const row = { ...base(req), name }; await c(runtime, 'accounts').insertOne(row, { session }); return row;
    }); res.status(201).json({ data });
  });
  app.get('/api/crm/accounts/:id/contacts', async (req, res) => { await find('accounts', req, req.params.id); await list('contacts', req, res, { accountId: req.params.id }); });
  app.post('/api/crm/accounts/:id/contacts', async (req, res) => {
    fields(req.body, ['name', 'email', 'accountId']);
    if (req.body.accountId !== undefined && req.body.accountId !== req.params.id) fail(400, 'ACCOUNT_CONFLICT');
    const name = text(req.body.name), email = text(req.body.email, 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'INVALID_EMAIL');
    const data = await transaction(req, 'contact.created', async session => {
      await find('accounts', req, req.params.id, session);
      const row = { ...base(req), accountId: req.params.id, name, email };
      await c(runtime, 'contacts').insertOne(row, { session }); return row;
    }); res.status(201).json({ data });
  });
  app.get('/api/crm/opportunities', (req, res) => list('opportunities', req, res));
  app.get('/api/crm/opportunities/:id', async (req, res) => res.json({ data: await find('opportunities', req, req.params.id) }));
  app.post('/api/crm/opportunities', async (req, res) => {
    fields(req.body, ['accountId', 'ownerId', 'amount', 'currency', 'name']);
    const accountId = id(req.body.accountId), amount = money(req.body.amount, req.body.currency);
    if (req.body.ownerId !== undefined && req.body.ownerId !== req.scope.userId) fail(403, 'OWNER_DENIED');
    const data = await transaction(req, 'opportunity.created', async session => {
      await find('accounts', req, accountId, session);
      const row = { ...base(req), accountId, amount, currency: req.body.currency, stage: 'NEW', history: [{ stage: 'NEW', version: 1, reason: 'Created', userId: req.scope.userId, at: new Date() }] };
      if (req.body.name !== undefined) row.name = text(req.body.name);
      await c(runtime, 'opportunities').insertOne(row, { session }); return row;
    }); res.status(201).json({ data });
  });
  app.post('/api/crm/opportunities/:id/stage', async (req, res) => {
    fields(req.body, ['expectedVersion', 'stage', 'reason']);
    const { expectedVersion, stage } = req.body; const reason = text(req.body.reason, 1000);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !stages.includes(stage)) fail(400, 'INVALID_STAGE');
    const data = await transaction(req, 'opportunity.stage', async session => {
      const current = await find('opportunities', req, req.params.id, session);
      await find('accounts', req, current.accountId, session);
      if (current.version !== expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (current.stage === stage || ['WON', 'LOST'].includes(current.stage)) fail(409, 'STAGE_CONFLICT');
      const updatedAt = new Date();
      const row = await c(runtime, 'opportunities').findOneAndUpdate({ ...req.filter, _id: current._id, version: expectedVersion }, { $set: { stage, updatedAt }, $inc: { version: 1 }, $push: { history: { stage, version: expectedVersion + 1, reason, at: updatedAt, userId: req.scope.userId } } }, { session, returnDocument: 'after' });
      if (!row) fail(409, 'VERSION_CONFLICT'); return row;
    }); res.json({ data });
  });
}
