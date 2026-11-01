import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = 'checkpoints/acceptance-fixes/platform/evidence';
const runs = {};
for (const run of ['baseline', 'fixed', 'final']) {
  const tap = readFileSync(join(root, `${run}-suite.tap`), 'utf8');
  const events = readFileSync(join(root, `${run}-resource-events.ndjson`), 'utf8').trim().split('\n').map(JSON.parse);
  const setup = events.filter(e => e.kind === 'setup-timing');
  runs[run] = {
    ...JSON.parse(readFileSync(join(root, `${run}-result.json`), 'utf8')),
    counts: Object.fromEntries([...tap.matchAll(/^# (tests|pass|fail|cancelled|skipped) (\d+)/gm)].map(m => [m[1], Number(m[2])])),
    cases: [...tap.matchAll(/^(\s*)(not ok|ok) (\d+) - (.*)\r?\n\s+---\r?\n\s+duration_ms: ([\d.]+)/gm)].map(m => ({ nested: m[1].length > 0, result: m[2], name: m[4], durationMs: Number(m[5]) })),
    coldSetup: [...new Set(setup.map(e => e.ownerPid))].map(pid => ({ ownerPid: pid, stages: setup.filter(e => e.ownerPid === pid).map(({ stage, elapsedMs }) => ({ stage, elapsedMs })) })),
    starts: events.filter(e => e.kind === 'mongo-running'),
    stops: events.filter(e => e.kind === 'mongo-stopped').length,
    fixtureCleanupCompleted: events.filter(e => e.kind === 'fixture-cleanup-completed').length
  };
}
writeFileSync(join(root, 'timings-and-results.json'), JSON.stringify(runs, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(runs).map(([name, run]) => [name, { status: run.status, counts: run.counts, elapsedMs: run.elapsedMs, starts: run.starts.length, stops: run.stops }]))));
