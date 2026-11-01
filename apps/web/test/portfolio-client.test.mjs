import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { portfolioRequest, errorMessage, validMoney, displayMoney } from '../src/features/portfolio/client.mjs';
import { utcInstant } from '../src/features/portfolio/operator.mjs';

test('portfolio requests use real HTTP JSON envelopes and expose conflict status', async () => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization, type: req.headers['content-type'] });
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/stage')) { res.statusCode = 409; res.end(JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'Refresh version' } })); }
    else res.end(JSON.stringify({ data: [{ _id: 'real-http' }], page: { nextCursor: null } }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await portfolioRequest('/api/crm/accounts', { base })).data[0]._id, 'real-http');
    await assert.rejects(portfolioRequest('/api/crm/opportunities/id/stage', { base, body: { expectedVersion: 1 } }), e => e.status === 409 && e.code === 'VERSION_CONFLICT');
    assert.equal(requests[1].type, 'application/json');
    assert.ok(requests.every(r => !r.authorization));
  } finally { await new Promise(r => server.close(r)); }
});

test('money stays a canonical decimal string at the currency scale', () => {
  assert.equal(validMoney('9999999999999999999999999999.99', 'USD'), true);
  for (const amount of ['1', '01.00', '-1.00', '1.001', '1e3', 1.00]) assert.equal(validMoney(amount, 'USD'), false);
  assert.equal(validMoney('12', 'JPY'), true);
  assert.equal(validMoney('12.123', 'KWD'), true);
  assert.equal(validMoney('12.00', 'XXX'), false);
  assert.equal(displayMoney('9999999999999999999999999999.99'), '9,999,999,999,999,999,999,999,999,999.99');
});

test('recovery messages distinguish expired, forbidden, conflict and uncertain writes', () => {
  assert.match(errorMessage({ status: 401 }), /expired|Sign in/i);
  assert.match(errorMessage({ status: 403 }), /permission|denied/i);
  const conflict=errorMessage({ status: 409 });
  assert.match(conflict,/Review the record and its history.*reconcile.*before starting a new one/i);
  for(const code of ['COMMAND_SCOPE_CHANGED','COMMAND_RECONCILIATION_REQUIRED'])assert.equal(errorMessage({status:409,code,message:'Reconcile the retained attempt'}),'Reconcile the retained attempt');
  assert.match(errorMessage({ status: 0 }, true), /check|before/i);
});
test('UTC display normalizes offsets without losing the instant or source subsecond precision',()=>{
  for(const [input,expected] of [
    ['2026-11-01T14:13:19.303115+07:00','2026-11-01T07:13:19.303115Z'],
    ['2026-11-01T00:15:00.000001+07:00','2026-10-31T17:15:00.000001Z'],
    ['2026-11-01T23:30:00-02:00','2026-11-02T01:30:00.000Z'],
    ['2026-11-01T07:13:19.303115Z','2026-11-01T07:13:19.303115Z'],
  ]){assert.equal(utcInstant(input),expected);assert.equal(Date.parse(utcInstant(input)),Date.parse(input));}
  for(const invalid of [null,undefined,'not a date','2026-11-01T07:13:19','2026-99-99T00:00:00Z'])assert.equal(utcInstant(invalid),null);
});
