import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.env.IEMS_BENCH_EVIDENCE;
assert.ok(root, 'Set IEMS_BENCH_EVIDENCE to the external completed experiment');
const result = JSON.parse(await readFile(path.join(root, 'summary.json'), 'utf8'));
const phases = result.results.filter(row => row.phase), measured = phases.filter(row => ['cold','warm'].includes(row.phase));
const total = (rows, field) => rows.reduce((sum, row) => sum + (row[field] || 0), 0);
const quantile = (values, p) => values.length ? values.sort((a,b) => a-b)[Math.max(0,Math.ceil(values.length*p)-1)] : null;
const groups = [];
for (const workload of ['foundation-cs','portfolio-guard']) for (const condition of ['same-plant','different-plants','different-tenants','same-resource']) for (const concurrency of [1,4,8,16]) {
  const rows = phases.filter(row => row.workload === workload && row.condition === condition && row.concurrency === concurrency && row.phase === 'warm'), samples = [];
  for (const row of rows) samples.push(...JSON.parse(await readFile(path.join(root, `${workload}-${condition}-c${concurrency}-r${row.repetition}-warm.json`), 'utf8')).samples);
  const unexpectedErrors = total(rows, 'unexpectedErrors'), warmP95MaxMs = rows.length ? Math.max(...rows.map(row => row.latencyMs.p95)) : null, throughput = total(rows,'success') / total(rows,'elapsedMs') * 1000;
  groups.push({ workload, condition, concurrency, repetitions: rows.length, state: rows.length === 3 ? 'MEASURED' : rows.length ? 'PARTIAL' : 'UNTESTED', samples: samples.length, success: total(rows,'success'), expectedConflicts: total(rows,'expectedConflicts'), unexpectedErrors, throughput: Number.isFinite(throughput) ? throughput : null, p50Ms: quantile(samples.map(row => row.latencyMs), .5), p95Ms: quantile(samples.map(row => row.latencyMs), .95), p99Ms: quantile(samples.map(row => row.latencyMs), .99), warmP95MaxMs, queueP95Ms: quantile(samples.map(row => row.queuedMs), .95), totalP95Ms: quantile(samples.map(row => row.totalMs), .95), callbackRetries: total(rows,'callbackRetries'), writeConflicts: total(rows,'writeConflicts'), abortCommands: total(rows,'abortCommands'), pilotTarget: concurrency === 8 && condition !== 'same-resource' ? rows.length !== 3 ? 'NOT_PROVEN' : rows.every(row => row.latencyMs.p95 <= 2000 && row.successPerSecond >= 4 && row.unexpectedErrors === 0) ? 'MET_IN_MEASURED_SCOPE' : 'FAILED' : 'NOT_TARGET_CELL' });
}
const summary = { commit: result.commit, sourceDigest: result.sourceDigest, sourceUnchanged: result.sourceUnchanged, fatal: result.fatal, measuredCommands: total(measured,'completed'), warmupCommands: total(phases.filter(row => row.phase === 'warmup'),'completed'), unexpectedErrors: total(measured,'unexpectedErrors'), expectedConflicts: total(measured,'expectedConflicts'), successfulCommands: total(measured,'success'), completedCells: phases.filter(row => row.phase === 'warm').length, untestedCells: result.results.filter(row => row.state === 'UNTESTED').length, measuredCallbackRetries: total(measured,'callbackRetries'), measuredWriteConflicts: total(measured,'writeConflicts'), measuredAbortCommands: total(measured,'abortCommands'), allPhaseHostCpuMaxPercent: Math.max(...phases.map(row => row.resource.hostCpuPercent)), allPhaseFreeRamMinGiB: Math.min(...phases.map(row => row.resource.freeRamMinimumBytes)) / 1024 ** 3, allPhaseNodeRssMaxMiB: Math.max(...phases.map(row => row.resource.nodeRssMaxBytes)) / 1024 ** 2, allPhaseMongoResidentMaxMiB: Math.max(...phases.flatMap(row => [row.resource.mongoBefore?.residentMiB || 0,row.resource.mongoAfter?.residentMiB || 0])), groups };
await writeFile(path.join(root, 'capacity-summary.json'), JSON.stringify(summary,null,2));
const number = value => value === null ? '-' : value.toFixed(2);
const lines = ['| Workload | Condition | C | Reps | Success / sample | p50 / p95 / p99 ms | Success/s | Retry | Write conflict | State |','| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...groups.map(row => `| ${row.workload} | ${row.condition} | ${row.concurrency} | ${row.repetitions}/3 | ${row.success}/${row.samples} | ${number(row.p50Ms)} / ${number(row.p95Ms)} / ${number(row.p99Ms)} | ${number(row.throughput)} | ${row.callbackRetries} | ${row.writeConflicts} | ${row.state} |`)];
await writeFile(path.join(root, 'capacity-table.md'), lines.join('\n')+'\n');
process.stdout.write(JSON.stringify(summary,null,2)+'\n');
