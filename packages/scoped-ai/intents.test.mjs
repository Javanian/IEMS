import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCustomerIntent } from './intents.mjs';

const plantId = randomUUID(), resourceId = randomUUID();
const citation = { resourceId, sourceRevision: 2, aclRevision: 3, indexRevision: 4, title: 'Returns policy',
  chunkIndex: 0, model: 'test', text: 'Approved returns are accepted within 30 days.', kind: 'DOCUMENT', trust: 'UNTRUSTED_SOURCE_CONTENT' };
function fixture({ provider = null, citations = [citation], retrieve = null, authorize = null, timeoutMs = 20 } = {}) {
  const calls = { auth: 0, retrieval: [], provider: [] };
  const service = createCustomerIntent({ timeoutMs, foundation: { async authorize(scope, target) {
    calls.auth++;
    if (authorize) await authorize(scope, target);
    return { tenantId: scope.tenantId, plantId: target.plantId };
  } }, rag: { async retrieve(scope, input) {
    calls.retrieval.push(input);
    return retrieve ? retrieve() : { schema: 'SCOPED_RETRIEVAL_V1', citations, asOf: new Date().toISOString(), coverage: 'BOUNDED_TOP_K' };
  } }, provider: provider && { async summarize(input) { calls.provider.push(input); return provider(input); } } });
  return { service, calls, scope: { tenantId: randomUUID(), userId: randomUUID() }, input: { plantId, message: 'What is the return policy?' } };
}

test('classifies one request, returns authorized citations, and does not persist history', async () => {
  const f = fixture();
  const result = await f.service.classify(f.scope, f.input);
  assert.equal(result.intent, 'FAQ');
  assert.equal(result.state, 'CLASSIFIED');
  assert.equal(result.generated, false);
  assert.equal(result.historyStored, false);
  assert.deepEqual(result.citations, [citation]);
  assert.equal(f.calls.auth, 2);
  assert.equal(f.calls.retrieval[0].limit, 5);
});

test('rejects oversized, malformed, unknown-field, and history-bearing requests before reads', async () => {
  const f = fixture();
  for (const input of [null, { ...f.input, message: 'x'.repeat(2001) }, { ...f.input, history: [] },
    { ...f.input, plantId: 'wrong' }, { ...f.input, message: 'x\0y' }]) {
    await assert.rejects(f.service.classify(f.scope, input), { code: 'AI_INVALID_INTENT_REQUEST' });
  }
  assert.equal(f.calls.retrieval.length, 0);
});

test('requires authorized evidence and abstains when retrieval has none', async () => {
  const f = fixture({ citations: [] });
  const result = await f.service.classify(f.scope, { ...f.input, message: 'My package is damaged' });
  assert.equal(result.intent, 'COMPLAINT');
  assert.equal(result.state, 'ABSTAIN');
  assert.equal(result.reason, 'NO_AUTHORIZED_EVIDENCE');
  assert.deepEqual(result.citations, []);
});

test('uses a deterministic bounded fallback when retrieval times out', async () => {
  const f = fixture({ retrieve: () => new Promise(() => {}), timeoutMs: 5 });
  const result = await f.service.classify(f.scope, { ...f.input, message: 'My item was damaged' });
  assert.equal(result.state, 'ABSTAIN');
  assert.equal(result.reason, 'EVIDENCE_UNAVAILABLE');
  assert.equal(result.intent, 'COMPLAINT');
});

test('provider receives only current message and scoped evidence; output citations are selected by index', async () => {
  const f = fixture({ provider: ({ intent, message, evidence, signal }) => {
    assert.equal(intent, 'FAQ');
    assert.equal(message, f.input.message);
    assert.equal(signal instanceof AbortSignal, true);
    assert.equal(evidence.length, 1);
    return { summary: 'The cited policy allows returns within 30 days.', citationIndexes: [0] };
  } });
  const result = await f.service.classify(f.scope, f.input);
  assert.equal(result.state, 'DRAFT');
  assert.equal(result.generated, true);
  assert.deepEqual(result.citations, [citation]);
  assert.equal(f.calls.provider.length, 1);
});

test('provider timeout returns deterministic summary and never retries', async () => {
  const f = fixture({ provider: () => new Promise(() => {}), timeoutMs: 5 });
  const result = await f.service.classify(f.scope, f.input);
  assert.equal(result.state, 'FALLBACK');
  assert.equal(result.generated, false);
  assert.equal(f.calls.provider.length, 1);
});

test('rejects ungrounded model output and rechecks access after a revoked in-flight read', async () => {
  const invalid = fixture({ provider: () => ({ summary: 'Ungrounded', citationIndexes: [] }) });
  await assert.rejects(invalid.service.classify(invalid.scope, invalid.input), { code: 'AI_MODEL_OUTPUT_INVALID' });
  let count = 0;
  const revoked = fixture({ authorize: () => { if (++count > 1) throw Object.assign(new Error('denied'), { status: 403 }); } });
  await assert.rejects(revoked.service.classify(revoked.scope, revoked.input), { status: 403 });
  assert.equal(revoked.calls.retrieval.length, 1);
});

test('rejects malformed citation projections before making a provider call', async () => {
  const f = fixture({ provider: () => ({ summary: 'response', citationIndexes: [0] }), citations: [{ ...citation, trust: 'TRUSTED' }] });
  await assert.rejects(f.service.classify(f.scope, f.input), { code: 'AI_SOURCE_INVALID' });
  assert.equal(f.calls.provider.length, 0);
});
