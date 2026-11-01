import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';

test('owned fixture refuses missing and foreign teardown markers before dropping its database', { timeout: 120000 }, async t => {
  const hooks = [];
  const h = await startOwned({ after: fn => hooks.push(fn) });
  const marker = await h.db.collection('ownedRun').findOne();
  assert.ok(marker);
  const foreign = randomUUID();
  t.after(async () => {
    await h.db.collection('ownedRun').deleteMany({ _id: foreign });
    await h.db.collection('ownedRun').replaceOne({ _id: marker._id }, marker, { upsert: true });
    for (const cleanup of hooks) await cleanup();
  });
  assert.match(h.db.databaseName, /^portfolio_owned_iems_qa_security_[a-f0-9]{8}_[a-f0-9]{16}$/);
  await h.db.collection('ownedRun').deleteOne({ _id: marker._id });
  await assert.rejects(hooks[0](), { code: 'ERR_ASSERTION' });
  assert.ok(await h.db.collection('tenants').countDocuments());
  await h.db.collection('ownedRun').insertOne({ _id: foreign });
  await assert.rejects(hooks[0](), { code: 'ERR_ASSERTION' });
  assert.ok(await h.db.collection('tenants').countDocuments());
});
