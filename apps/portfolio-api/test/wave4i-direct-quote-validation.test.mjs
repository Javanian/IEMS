import test from 'node:test';
import assert from 'node:assert/strict';
import { startOwned } from './support/owned-mongo.mjs';

test('direct quote rejects malformed lines over HTTP without commercial writes', async t => {
  const h = await startOwned(t);
  const account = await h.ok('/crm/accounts', { name: 'Synthetic direct quote validation' }, 201);
  const payload = { accountId: account._id, expiresAt: new Date(Date.now() + 3600000).toISOString(), taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP' };
  const collections = ['quotes', 'commercialAudit', 'commercialOutbox'];
  const counts = () => Promise.all(collections.map(name => h.db.collection(name).countDocuments()));
  const before = await counts();
  for (const [name, lines] of [['object', {}], ['string', 'bad'], ['number', 42], ['null', null], ['missing', undefined], ['empty array', []]]) {
    await t.test(`${name} returns INVALID_LINES 400`, async () => {
      const response = await h.req('/commercial/quotes', { ...payload, ...(name === 'missing' ? {} : { lines }) }, h.alpha);
      assert.equal(response.status, 400, JSON.stringify(response));
      assert.equal(response.error.code, 'INVALID_LINES', JSON.stringify(response));
      assert.deepEqual(await counts(), before);
    });
  }
});
