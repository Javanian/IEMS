import assert from 'node:assert/strict';

export const benchmarkCellId = row => `${row.workload}:${row.condition}:${row.concurrency}:${row.repetition}`;
export const benchmarkCellIds = Object.freeze(['foundation-cs', 'portfolio-guard'].flatMap(workload => ['same-plant', 'different-plants', 'different-tenants', 'same-resource'].flatMap(condition => [1, 4, 8, 16].flatMap(concurrency => [1, 2, 3].map(repetition => benchmarkCellId({ workload, condition, concurrency, repetition }))))));

export function selectBenchmarkCells({ requestedJson, prior, expected, sourceDigest }) {
  if (requestedJson === undefined && prior === undefined) return { mode: 'FULL', matrixCellCount: 96, selectedCellIds: [...benchmarkCellIds], omittedCellIds: [] };
  assert.ok(typeof requestedJson === 'string' && prior, 'Resume requires both explicit cell IDs and prior summary');
  const requested = JSON.parse(requestedJson);
  assert.ok(Array.isArray(requested) && requested.length > 0 && requested.length <= 96 && requested.every(id => typeof id === 'string'), 'Cell IDs must be a nonempty JSON string array');
  assert.equal(new Set(requested).size, requested.length, 'Duplicate cell IDs are forbidden');
  assert.equal(prior.commit, expected); assert.equal(prior.sourceDigest, sourceDigest); assert.equal(prior.sourceUnchanged, true); assert.equal(prior.fatal, null);
  assert.equal(prior.environment?.protocol, 'CONCURRENCY.md v1'); assert.equal(prior.environment?.commandSamplesPerPhase, 200); assert.equal(prior.environment?.warmup, 40); assert.equal(prior.environment?.repetitions, 3);
  assert.deepEqual(prior.environment?.target, { concurrency: 8, warmP95Ms: 2000, distinctSuccessCommandsPerSecond: 4, unexpectedErrors: 0 });
  assert.ok(Array.isArray(prior.results), 'Prior summary must retain result rows');
  const untested = new Set(prior.results.filter(row => row.state === 'UNTESTED').map(benchmarkCellId));
  const measured = new Set(prior.results.filter(row => row.phase).map(benchmarkCellId));
  for (const id of requested) { assert.ok(benchmarkCellIds.includes(id), `Unknown cell ID: ${id}`); assert.ok(untested.has(id) && !measured.has(id), `Resume may select only wholly untested cells: ${id}`); }
  const selected = new Set(requested);
  return { mode: 'RESUME_UNTESTED', matrixCellCount: 96, selectedCellIds: benchmarkCellIds.filter(id => selected.has(id)), omittedCellIds: benchmarkCellIds.filter(id => !selected.has(id)) };
}
