import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkCellIds, selectBenchmarkCells } from './benchmark-selection.mjs';

const one = 'portfolio-guard:different-tenants:4:3', two = 'foundation-cs:different-plants:8:2';
const row = id => { const [workload, condition, concurrency, repetition] = id.split(':'); return { workload, condition, concurrency: Number(concurrency), repetition: Number(repetition), state: 'UNTESTED' }; };
const prior = () => ({ commit: 'frozen', sourceDigest: 'digest', sourceUnchanged: true, fatal: null, environment: { protocol: 'CONCURRENCY.md v1', commandSamplesPerPhase: 200, warmup: 40, repetitions: 3, target: { concurrency: 8, warmP95Ms: 2000, distinctSuccessCommandsPerSecond: 4, unexpectedErrors: 0 } }, results: [row(one), row(two)] });
const select = (ids, changes = {}) => selectBenchmarkCells({ requestedJson: JSON.stringify(ids), prior: { ...prior(), ...changes }, expected: 'frozen', sourceDigest: 'digest' });

test('default preserves all96 canonical IDs and resume keeps original tuple/repetition order', () => {
  assert.equal(benchmarkCellIds.length, 96); assert.equal(new Set(benchmarkCellIds).size, 96);
  const all = selectBenchmarkCells({}); assert.deepEqual(all.selectedCellIds, benchmarkCellIds); assert.equal(all.omittedCellIds.length, 0);
  const resume = select([one, two]); assert.deepEqual(resume.selectedCellIds, [two, one]); assert.equal(resume.omittedCellIds.length, 94); assert.equal(resume.selectedCellIds[1], 'portfolio-guard:different-tenants:4:3');
});
test('resume refuses unknown duplicate already-measured or partially-measured cells', () => {
  for (const ids of [[], [one, one], ['portfolio-guard:different-tenants:4:0'], [3], ['foundation-cs:same-plant:1:1']]) assert.throws(() => select(ids));
  assert.throws(() => select([one], { results: [row(one), { ...row(one), phase: 'cold' }] }));
});
test('resume refuses drifted source, failed previous run or changed frozen protocol', () => {
  for (const changes of [{ commit: 'other' }, { sourceDigest: 'other' }, { sourceUnchanged: false }, { fatal: { message: 'failure' } }, { environment: { ...prior().environment, warmup: 20 } }, { environment: { ...prior().environment, target: { ...prior().environment.target, warmP95Ms: 3000 } } }]) assert.throws(() => select([one], changes));
  assert.throws(() => selectBenchmarkCells({ requestedJson: JSON.stringify([one]) })); assert.throws(() => selectBenchmarkCells({ prior: prior() }));
});
