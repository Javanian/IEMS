import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedTransaction, canonicalJson } from './commands.mjs';

function clientWith(commits) {
  const calls = { effects: 0, commits: 0, aborts: 0, ends: 0, starts: 0 };
  return { calls, startSession: () => ({
    startTransaction() { calls.starts++; }, inTransaction: () => true,
    async commitTransaction() { calls.commits++; const error = commits.shift(); if (error) throw error; },
    async abortTransaction() { calls.aborts++; }, async endSession() { calls.ends++; }
  }) };
}
const labelled = label => Object.assign(new Error(label), { errorLabels: [label] });
test('unknown commits retry only commit and never repeat effect', async () => {
  const client = clientWith(Array.from({ length: 3 }, () => labelled('UnknownTransactionCommitResult')));
  await assert.rejects(boundedTransaction(client, async () => ++client.calls.effects), { code: 'COMMIT_OUTCOME_UNKNOWN' });
  assert.deepEqual(client.calls, { effects: 1, commits: 3, aborts: 0, ends: 1, starts: 1 });
});
test('transient effects retry within bound and always end session', async () => {
  const client = clientWith([]);
  await assert.rejects(boundedTransaction(client, async () => { client.calls.effects++; throw labelled('TransientTransactionError'); }));
  assert.deepEqual(client.calls, { effects: 3, commits: 0, aborts: 3, ends: 1, starts: 3 });
});
test('successful commit retry returns original result', async () => {
  const client = clientWith([labelled('UnknownTransactionCommitResult')]);
  assert.equal(await boundedTransaction(client, async () => ++client.calls.effects), 1);
  assert.equal(client.calls.commits, 2);
});
test('command hashing is stable and rejects floating point payloads', () => {
  assert.equal(canonicalJson({ z: '0.01', a: 1 }), canonicalJson({ a: 1, z: '0.01' }));
  assert.throws(() => canonicalJson({ amount: 0.1 }), { code: 'INVALID_COMMAND_VALUE' });
});
