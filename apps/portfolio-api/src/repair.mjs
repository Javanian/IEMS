import { randomUUID, createHash } from 'node:crypto';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';

const verbs = ['read', 'intake', 'diagnostic-authorize', 'teardown', 'scope', 'decide', 'deposit', 'start', 'execute', 'test', 'rework', 'qc', 'hold', 'return', 'bill', 'settle'];
export const repairActions = verbs.map(v => `repair.${v}`);
export const repairRoles = Object.fromEntries(verbs.map(v => [`repair${v.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('')}`, [...new Set(['repair.read', `repair.${v}`])]]));
// Public customer-facing repair number: stable, unique per tenant+plant, never the raw case UUID.
export const repairNumberFor = ({ tenantId, plantId }, caseId) => `RP-${createHash('sha256').update(`repair:${tenantId}:${plantId}:${caseId}`).digest('hex').slice(0, 16).toUpperCase()}`;
export async function initializeRepair(db) {
  await db.collection('repairCases').createIndex({ tenantId: 1, plantId: 1, caseNumber: 1 }, { unique: true, partialFilterExpression: { caseNumber: { $type: 'string' } } });
  await db.collection('repairInvoices').createIndex({ tenantId: 1, plantId: 1, caseId: 1, kind: 1 }, { unique: true });
  await db.collection('repairPayments').createIndex({ tenantId: 1, plantId: 1, reference: 1 }, { unique: true });
  await db.collection('repairKeys').createIndex({ tenantId: 1, plantId: 1, key: 1 }, { unique: true });
}
export function installRepair(app, runtime, { fail, guard, id, fields }) {
  const c = name => runtime.db.collection(name);
  const text = value => { if (typeof value !== 'string' || !value.trim() || value.length > 1000) fail(400, 'INVALID_TEXT'); return value.trim(); };
  const base = req => ({ _id: randomUUID(), ...req.filter, version: 1, createdBy: req.scope.userId, createdAt: new Date() });
  const evidence = (req, kind, value) => ({ kind, evidence: text(value), recordedBy: req.scope.userId, recordedAt: new Date(), source: 'OPERATOR_RECORDED' });
  const find = async (name, req, key, session) => {
    const filter = { ...req.filter, _id: id(key) };
    const row = name === 'quotes' && session ? await c(name).findOneAndUpdate(filter, { $inc: { repairFence: 1 } }, { session, returnDocument: 'after' }) : await c(name).findOne(filter, { session });
    if (!row) fail(404, 'NOT_FOUND'); return row;
  };
  app.use('/api/repair', async (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    req.repairAction = `repair.${req.method === 'GET' ? 'read' : req.path === '/cases' ? 'intake' : req.path.split('/').at(-1)}`;
    await runtime.foundation.authorize(req.scope, { ...req.filter, action: req.repairAction }); next();
  });
  const tx = async (req, kind, effect) => {
    const { idempotencyKey: key, ...body } = req.body;
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
    const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
    const payloadHash = createHash('sha256').update(JSON.stringify(canonical({ kind, id: req.params.id || null, body }))).digest('hex');
    const session = runtime.client.startSession();
    try { return await session.withTransaction(async () => {
      await guard(runtime, req, session, req.repairAction);
      const prior = await c('repairKeys').findOne({ ...req.filter, key }, { session });
      if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT'); return prior.result; }
      const result = await effect(session);
      const event = { ...base(req), kind, subjectId: result._id, subjectVersion: result.version };
      await c('repairAudit').insertOne(event, { session });
      await c('repairOutbox').insertOne({ ...event, _id: randomUUID(), state: 'PENDING' }, { session });
      await c('repairKeys').insertOne({ ...base(req), key, payloadHash, result }, { session });
      return result;
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' }); }
    finally { await session.endSession(); }
  };
  const scale = currency => ({ USD: 2, EUR: 2, GBP: 2, IDR: 2, JPY: 0, KWD: 3 })[currency];
  const money = (value, currency) => {
    const n = scale(currency);
    if (typeof value !== 'string' || !new RegExp(`^(0|[1-9][0-9]{0,27})${n ? `\\.[0-9]{${n}}` : ''}$`).test(value)) fail(400, 'INVALID_AMOUNT');
    return BigInt(value.replace('.', ''));
  };
  const decimal = (value, currency) => { const n = scale(currency), s = value.toString().padStart(n + 1, '0'); return n ? `${s.slice(0, -n)}.${s.slice(-n)}` : s; };
  const dispositions = values => {
    if (!Array.isArray(values) || !values.length || values.length > 100) fail(400, 'INVALID_DISPOSITIONS');
    const rows = values.map(v => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(400, 'INVALID_DISPOSITIONS'); fields(v, ['component', 'disposition']); if (!['REPAIR', 'REPLACE', 'REUSE', 'SCRAP'].includes(v.disposition)) fail(400, 'INVALID_DISPOSITIONS'); return { component: text(v.component), disposition: v.disposition }; });
    if (new Set(rows.map(v => v.component)).size !== rows.length) fail(400, 'INVALID_DISPOSITIONS'); return rows;
  };
  for (const action of verbs.filter(v => !['read', 'intake', 'settle'].includes(v))) app.post(`/api/repair/cases/:id/${action}`, async (req, res) => {
    const allowed = { 'diagnostic-authorize': ['feeCap', 'evidence'], teardown: ['findings', 'evidence'], scope: ['quoteId', 'revision', 'depositRequired', 'evidence'], decide: ['decision', 'revision', 'diagnosticFee', 'evidence'], deposit: ['amount', 'currency', 'reference'], start: [], execute: ['dispositions', 'evidence'], test: ['result', 'evidence'], rework: ['evidence'], qc: ['evidence'], hold: ['active', 'evidence'], return: ['evidence'], bill: [] }[action];
    fields(req.body, ['expectedVersion', 'idempotencyKey', ...allowed]);
    const b = req.body;
    if (!Number.isSafeInteger(b.expectedVersion) || b.expectedVersion < 1) fail(400, 'INVALID_VERSION');
    if (allowed.includes('evidence')) text(b.evidence);
    const data = await tx(req, `repair.${action}`, async session => {
      const row = await find('repairCases', req, req.params.id, session);
      if (row.version !== b.expectedVersion) fail(409, 'VERSION_CONFLICT');
      const requireState = (...states) => { if (!states.includes(row.status)) fail(409, 'STATE_CONFLICT'); };
      if (row.decision?.decision === 'ACCEPT') {
        const deposits = await c('repairDeposits').find({ ...req.filter, caseId: row._id, accountId: row.ownerAccountId, currency: row.currency }, { session }).toArray();
        if (deposits.reduce((sum, d) => sum + money(d.amount, row.currency), 0n) > money(row.scopes.at(-1).snapshot.total, row.currency)) fail(409, 'DEPOSIT_EXCEEDED');
      }
      const record = kind => evidence(req, kind, b.evidence);
      if (action === 'diagnostic-authorize') {
        requireState('INTAKE'); money(b.feeCap, row.currency);
        row.diagnosticAuthorization = { ...record('DIAGNOSTIC_AUTHORIZED'), feeCap: b.feeCap }; row.status = 'DIAGNOSIS_AUTHORIZED';
      } else if (action === 'teardown') {
        requireState('DIAGNOSIS_AUTHORIZED'); row.findings = dispositions(b.findings); row.teardown = record('TEARDOWN'); row.status = 'TEARDOWN'; row.custody.push(record('DISASSEMBLED'));
      } else if (action === 'scope') {
        requireState('TEARDOWN', 'SCOPE_QUOTED');
        const quote = await find('quotes', req, b.quoteId, session), latest = quote.revisions.at(-1);
        const approval = quote.approvals?.find(a => a.revision === b.revision);
        if (!Number.isSafeInteger(b.revision) || b.revision !== latest.number || !approval || !['APPROVED', 'ACCEPTED'].includes(quote.status) || quote.accountId !== row.ownerAccountId || latest.currency !== row.currency || new Date(latest.expiresAt) <= new Date()) fail(409, 'SCOPE_CONFLICT');
        if (latest.taxPolicy !== 'NO_TAX' || approval.snapshot.taxPolicy !== 'NO_TAX') fail(409, 'TAX_POLICY_UNSUPPORTED');
        if (money(b.depositRequired, row.currency) > money(latest.total, row.currency)) fail(409, 'DEPOSIT_EXCEEDED');
        row.scopes.push({ ...record('SCOPE_QUOTED'), revision: row.scopes.length + 1, quoteId: quote._id, quoteRevision: b.revision, snapshot: structuredClone(approval.snapshot), depositRequired: b.depositRequired, findings: structuredClone(row.findings) }); row.status = 'SCOPE_QUOTED';
      } else if (action === 'decide') {
        requireState('SCOPE_QUOTED'); const scope = row.scopes.at(-1);
        if (b.revision !== scope.revision || !['ACCEPT', 'REJECT'].includes(b.decision)) fail(409, 'SCOPE_CONFLICT');
        const quote = await find('quotes', req, scope.quoteId, session);
        if (quote.revisions.at(-1).number !== scope.quoteRevision || !['APPROVED', 'ACCEPTED'].includes(quote.status) || new Date(scope.snapshot.expiresAt) <= new Date()) fail(409, 'SCOPE_CONFLICT');
        row.decision = { ...record(b.decision), revision: scope.revision, decision: b.decision };
        if (b.decision === 'ACCEPT') { if (b.diagnosticFee !== undefined) fail(400, 'UNKNOWN_FIELD'); row.status = 'AUTHORIZED'; }
        else {
          const amount = money(b.diagnosticFee, row.currency);
          if (amount > money(row.diagnosticAuthorization.feeCap, row.currency)) fail(409, 'DIAGNOSTIC_CAP_EXCEEDED');
          const invoice = { ...base(req), caseId: row._id, accountId: row.ownerAccountId, kind: 'DIAGNOSTIC', status: 'ISSUED', currency: row.currency, total: b.diagnosticFee, remaining: b.diagnosticFee, authorization: structuredClone(row.diagnosticAuthorization), snapshot: { currency: row.currency, total: b.diagnosticFee, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Authorized diagnostic inspection', quantity: '1', uom: 'EA', unitPrice: b.diagnosticFee, currency: row.currency }] } };
          await c('repairInvoices').insertOne(invoice, { session }); row.diagnosticInvoiceId = invoice._id;
          row.status = 'REJECTED'; row.custodyState = 'RELEASED_FOR_RETURN'; row.custody.push(record('RELEASED_UNREPAIRED'));
        }
      } else if (action === 'deposit') {
        requireState('AUTHORIZED'); if (b.currency !== row.currency) fail(409, 'CURRENCY_CONFLICT');
        const amount = money(b.amount, row.currency); if (!amount) fail(400, 'INVALID_AMOUNT');
        const deposits = await c('repairDeposits').find({ ...req.filter, caseId: row._id, accountId: row.ownerAccountId, currency: row.currency }, { session }).toArray();
        const funded = deposits.reduce((sum, d) => sum + money(d.amount, row.currency), 0n);
        if (funded + amount > money(row.scopes.at(-1).snapshot.total, row.currency)) fail(409, 'DEPOSIT_EXCEEDED');
        const reference = text(b.reference);
        if (row.deposits.some(d => d.reference === reference)) fail(409, 'DUPLICATE_REFERENCE');
        const deposit = { ...base(req), caseId: row._id, accountId: row.ownerAccountId, amount: b.amount, currency: row.currency, reference, source: 'OPERATOR_RECORDED' };
        await c('repairDeposits').insertOne(deposit, { session }); row.deposits.push(deposit);
      } else if (action === 'start') {
        requireState('AUTHORIZED');
        const deposits = await c('repairDeposits').find({ ...req.filter, caseId: row._id, accountId: row.ownerAccountId, currency: row.currency }, { session }).toArray();
        const funded = deposits.reduce((n, d) => n + money(d.amount, row.currency), 0n);
        if (funded > money(row.scopes.at(-1).snapshot.total, row.currency)) fail(409, 'DEPOSIT_EXCEEDED');
        if (funded < money(row.scopes.at(-1).depositRequired, row.currency)) fail(409, 'DEPOSIT_REQUIRED');
        row.depositVerified = decimal(funded, row.currency); row.status = 'IN_PROGRESS';
      } else if (action === 'execute') {
        requireState('IN_PROGRESS'); const actual = dispositions(b.dispositions);
        const sort = values => JSON.stringify([...values].sort((a, b) => a.component.localeCompare(b.component)));
        if (sort(actual) !== sort(row.scopes.at(-1).findings)) fail(409, 'DISPOSITION_CONFLICT');
        row.execution = { ...record('EXECUTED'), dispositions: actual }; row.status = 'TESTING';
      } else if (action === 'test') {
        requireState('TESTING'); if (!['PASS', 'FAIL'].includes(b.result)) fail(400, 'INVALID_TEST');
        row.tests.push({ ...record('TEST'), result: b.result, run: row.tests.length + 1 }); row.status = b.result === 'FAIL' ? 'REWORK' : 'TEST_PASSED';
      } else if (action === 'rework') {
        requireState('REWORK'); row.reworks.push({ ...record('REWORK'), failedRun: row.tests.at(-1).run }); row.status = 'TESTING';
      } else if (action === 'hold') {
        if (row.status === 'RETURNED' || typeof b.active !== 'boolean') fail(409, 'STATE_CONFLICT');
        row.holds.push({ ...record('HOLD'), active: b.active }); row.holdActive = b.active;
      } else if (action === 'qc') {
        requireState('TEST_PASSED'); if (row.holdActive || row.tests.at(-1)?.result !== 'PASS') fail(409, 'QC_BLOCKED');
        row.qc = { ...record('QC_RELEASED'), testRun: row.tests.at(-1).run }; row.status = 'READY_FOR_RETURN'; row.custodyState = 'RELEASED_FOR_RETURN'; row.custody.push(record('REASSEMBLED'));
      } else if (action === 'bill') {
        requireState('READY_FOR_RETURN', 'RETURNED');
        if (row.decision?.decision !== 'ACCEPT' || row.finalInvoiceId) fail(409, 'STATE_CONFLICT');
        const snapshot = structuredClone(row.scopes.at(-1).snapshot);
        const deposits = await c('repairDeposits').find({ ...req.filter, caseId: row._id, accountId: row.ownerAccountId, currency: row.currency }, { session }).toArray();
        const applied = deposits.reduce((sum, d) => sum + money(d.amount, row.currency), 0n), total = money(snapshot.total, row.currency);
        if (applied > total) fail(409, 'DEPOSIT_EXCEEDED');
        const invoice = { ...base(req), caseId: row._id, accountId: row.ownerAccountId, kind: 'FINAL', status: applied === total ? 'PAID' : 'ISSUED', currency: row.currency, total: snapshot.total, depositApplied: decimal(applied, row.currency), depositIds: deposits.map(d => d._id), paidAmount: decimal(applied, row.currency), remaining: decimal(total - applied, row.currency), snapshot };
        await c('repairInvoices').insertOne(invoice, { session });
        for (const deposit of deposits) {
          const used = await c('repairDeposits').updateOne({ ...req.filter, _id: deposit._id, appliedInvoiceId: { $exists: false } }, { $set: { appliedInvoiceId: invoice._id } }, { session });
          if (!used.matchedCount) fail(409, 'DEPOSIT_ALREADY_APPLIED');
        }
        row.finalInvoiceId = invoice._id;
      } else if (action === 'return') {
        requireState('READY_FOR_RETURN', 'REJECTED'); if (row.holdActive) fail(409, 'QC_BLOCKED');
        row.custodyState = row.status === 'REJECTED' ? 'RETURNED_UNREPAIRED_TO_CUSTOMER' : 'RETURNED_TO_CUSTOMER'; row.custody.push(record(row.custodyState)); row.status = 'RETURNED';
      }
      row.history.push({ ...base(req), action, fromVersion: row.version, status: row.status }); row.version++; row.updatedAt = new Date();
      const saved = await c('repairCases').replaceOne({ ...req.filter, _id: row._id, version: b.expectedVersion }, row, { session }); if (!saved.matchedCount) fail(409, 'VERSION_CONFLICT'); return row;
    }); res.json({ data });
  });
  app.post('/api/repair/invoices/:id/settle', async (req, res) => {
    fields(req.body, ['expectedVersion', 'idempotencyKey', 'amount', 'currency', 'reference']);
    const b = req.body;
    if (!Number.isSafeInteger(b.expectedVersion) || b.expectedVersion < 1) fail(400, 'INVALID_VERSION');
    const reference = text(b.reference);
    const data = await tx(req, 'repair.settle', async session => {
      const invoice = await find('repairInvoices', req, req.params.id, session);
      if (invoice.version !== b.expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (b.currency !== invoice.currency) fail(409, 'CURRENCY_CONFLICT');
      const paid = money(b.amount, invoice.currency), remaining = money(invoice.remaining, invoice.currency);
      if (!paid) fail(400, 'INVALID_AMOUNT');
      if (paid > remaining) fail(409, 'OVERPAYMENT');
      if (await c('repairPayments').findOne({ ...req.filter, reference }, { session })) fail(409, 'DUPLICATE_REFERENCE');
      const payment = { ...base(req), invoiceId: invoice._id, caseId: invoice.caseId, accountId: invoice.accountId, currency: invoice.currency, amount: b.amount, reference, source: 'OPERATOR_RECORDED' };
      try { await c('repairPayments').insertOne(payment, { session }); }
      catch (error) {
        if (error.code === 11000 && error.keyPattern?.tenantId === 1 && error.keyPattern?.plantId === 1 && error.keyPattern?.reference === 1) fail(409, 'DUPLICATE_REFERENCE');
        throw error;
      }
      invoice.remaining = decimal(remaining - paid, invoice.currency);
      invoice.paidAmount = decimal(money(invoice.total, invoice.currency) - remaining + paid, invoice.currency);
      invoice.status = remaining === paid ? 'PAID' : 'PARTIALLY_PAID';
      invoice.payments = [...(invoice.payments || []), payment]; invoice.version++;
      await c('repairInvoices').replaceOne({ ...req.filter, _id: invoice._id, version: b.expectedVersion }, invoice, { session });
      return invoice;
    });
    res.json({ data });
  });
  for (const [resource, collection] of [['cases', 'repairCases'], ['invoices', 'repairInvoices'], ['deposits', 'repairDeposits']]) {
  app.get(`/api/repair/${resource}/:id`, async (req, res) => res.json({ data: await find(collection, req, req.params.id) }));
  app.get(`/api/repair/${resource}`, async (req, res) => {
    const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
    const filter = { ...req.filter }; if (req.query.cursor !== undefined) filter._id = { $gt: id(req.query.cursor) };
    const rows = await c(collection).find(filter).sort({ _id: 1 }).limit(limit + 1).toArray(), data = rows.slice(0, limit);
    res.json({ data, page: { limit, nextCursor: rows.length > limit ? data.at(-1)._id : null } });
  });
  }
  app.post('/api/repair/cases', async (req, res) => {
    fields(req.body, ['accountId', 'serial', 'condition', 'currency', 'idempotencyKey']);
    const { accountId, serial, condition, currency } = req.body;
    if (!['USD', 'EUR', 'GBP', 'IDR', 'JPY', 'KWD'].includes(currency)) fail(400, 'INVALID_CURRENCY');
    text(serial); text(condition); id(accountId);
    const data = await tx(req, 'repair.intake', async session => {
      await find('accounts', req, accountId, session);
      const caseId = randomUUID();
      const row = { ...base(req), _id: caseId, caseNumber: repairNumberFor(req.filter, caseId), ownerAccountId: accountId, serial: text(serial), initialCondition: text(condition), currency, status: 'INTAKE', custodyState: 'IN_CUSTODY', custody: [evidence(req, 'RECEIVED', condition)], history: [], scopes: [], deposits: [], tests: [], reworks: [], holds: [] };
      await c('repairCases').insertOne(row, { session }); return row;
    }); res.status(201).json({ data });
  });
}
