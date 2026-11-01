import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { boundedTransaction } from '../../../packages/tenant-foundation/commands.mjs';

const source = readFileSync(new URL('../../../apps/portfolio-api/src/operations.mjs', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('async function dashboardSnapshot('), source.indexOf('export function invoiceBalance'));
function harness(commit = async () => {}) {
  const waits = [];
  let transactions = 0, active = false;
  const client = { startSession: () => ({
    startTransaction: () => { transactions++; active = true; },
    commitTransaction: commit, inTransaction: () => active,
    abortTransaction: async () => { active = false; }, endSession: async () => {}
  }) };
  const read = runInNewContext(`${helper}; dashboardSnapshot`, {
    boundedTransaction, setTimeout: (resolve, ms) => { waits.push(ms); resolve(); }
  });
  return { run: fn => read({ client }, fn), waits, transactions: () => transactions };
}
const transient = () => Object.assign(new Error('synthetic transient'), { hasErrorLabel: label => label === 'TransientTransactionError' });

test('only labeled transient reads retry with bounded backoff', async () => {
  const h = harness(); let calls = 0;
  assert.equal(await h.run(async () => { if (++calls < 3) throw transient(); return 'snapshot'; }), 'snapshot');
  assert.equal(calls, 3); assert.deepEqual(h.waits, [50, 100]);
  const exhausted = harness();
  await assert.rejects(exhausted.run(async () => { throw transient(); }), /synthetic transient/);
  assert.equal(exhausted.transactions(), 5); assert.deepEqual(exhausted.waits, [50, 100, 200, 400]);
});

test('generic failures and ambiguous commits do not replay dashboard reads', async () => {
  const h = harness(); const error = new Error('ordinary failure');
  await assert.rejects(h.run(async () => { throw error; }), e => e === error);
  assert.equal(h.transactions(), 1); assert.deepEqual(h.waits, []);
  let commits = 0, reads = 0;
  const ambiguous = harness(async () => {
    commits++;
    throw Object.assign(new Error('synthetic unknown commit'), { hasErrorLabel: label => label === 'UnknownTransactionCommitResult' || label === 'TransientTransactionError' });
  });
  await assert.rejects(ambiguous.run(async () => { reads++; return 'snapshot'; }), { code: 'COMMIT_OUTCOME_UNKNOWN' });
  assert.equal(reads, 1); assert.equal(commits, 3); assert.equal(ambiguous.transactions(), 1); assert.deepEqual(ambiguous.waits, []);
});
