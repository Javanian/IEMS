# F5 concurrency experiment

## Frozen pre-experiment protocol

Protocol version 1, saved before any benchmark command. Baseline source is the clean accepted commit `54a7e6db5fb1cfc48252477ca872d700c8c650ee` in the previous QC worktree, imported explicitly through `IEMS_BENCH_SOURCE`. The harness lives here; the baseline is read-only. A source SHA-256 manifest and environment record must be written before starting the owned replica and checked again after teardown.

The pilot assumes eight active local operator sessions, each with at most one command in flight, on this six-core Windows workstation. The predeclared initial capacity target is warm HTTP command p95 <= 2,000 ms at concurrency 8 and >= 4 successful commands/second for distinct resources, with zero unexpected errors and exactly one effect per successful fresh command. This is a local pilot target, not a production SLA or proof for all MES workloads. Shared-resource expected version conflicts are reported separately, never counted as successful capacity.

Use concurrency 1/4/8/16 and three sequential repetitions in each of four conditions:

| Condition | User/session | Business resources | Shared scope |
| --- | --- | --- | --- |
| same-plant | Independent per worker | One ticket per worker | Plant, entity, tenant |
| different-plants | Independent per worker | One ticket per worker | Tenant; each worker has a separate plant and entity |
| different-tenants | Independent per worker | One ticket per worker | None of the six authority documents |
| same-resource | Independent per worker | One ticket shared by all workers | Plant, entity, tenant and ticket |

Each cell creates a fresh marked database and app, then measures a first/cold batch of 200 commands without workload warmup, a separately labelled 40-command warmup, and a warm batch of 200 commands. The replica and driver pool remain running across cells. Cold means the first workload batch against this newly initialized database/app context; it does not mean an OS disk-cache flush, a fresh driver pool or a cold machine. Replica startup, app initialization, authority/session setup, and fixture creation are recorded separately from command latency. No failed sample is discarded. Total requested measurement is 19,200 commands plus warmup, subject to the resource guard.

The identical 50/50 command mix uses actual CS HTTP endpoints: internal-note append, and GET current ticket followed by an exact-version public update. The latter's read plus mutation are one measured logical command. All use real independent foundation-issued sessions. Ticket fixtures are created through foundation and CS APIs in an owned synthetic database; successful workload effects are never manufactured with database writes. CS is chosen because its transaction adapter actually invokes `authorizeInTransaction`. Inventory/catalog routes currently use a separate `app.guard` with similar shared `crmFence` writes; this experiment does not silently substitute that implementation or certify its performance.

For distinct resources all 200 commands must succeed. With one shared ticket, version-conflict responses on public updates are expected competition; each successful public update must advance the ticket once, each note append must create one note, and each successful command must have exactly one key and audit effect. This benchmark is not a deterministic race proof. Separate correctness probes must place test-only barriers after relevant reads and test revocation ordering; simultaneous HTTP alone may serialize at the authority fence.

Measure offered/completed/successful throughput, HTTP p50/p95/p99, logical-command admission queue p50/p95/p99, total response time including that queue, status/code counts, driver callback attempts/retries, aborted transaction commands, failed write-conflict commands (112), connection-pool checkout durations when supplied by the driver, host CPU/free RAM, Node CPU/RSS and Mongo resident memory. Instrumentation wraps client sessions/callbacks and observes driver events in the harness only; no business source is modified. Per-command samples and aggregate observations are retained externally. A callback retry is an observed re-invocation, not an inferred retry from latency. Abort commands include expected business failures and are not synonymous with write conflicts.

Resource guard: before concurrency16 require >=3 GiB available RAM and host CPU <80% over a one-second sample; otherwise record that cell UNTESTED and retain the observation. Before all other cells require >=2 GiB available RAM. During a batch, <1.5 GiB available RAM stops admitting new work, drains in-flight work, records partial results and marks the remaining cells UNTESTED. Do not kill unrelated processes, shrink samples, change these thresholds, or call incomplete cells passed. Use one owned single-node MongoDB 7.0.14 WiredTiger replica with 0.25 GiB cache, bounded 128 MiB oplog, and a randomized marker-protected database. Teardown verifies marker ownership before drop and stops only the replica created by this harness.

Additional portfolio-guard matrix, also fixed before execution: repeat the same four conditions, concurrency levels, phases and repetitions with 60% inventory-item creation and 40% exact-version item revision (GET current head plus POST revision). Every mutator uses the actual portfolio `app.guard` and its shared six-document `crmFence`, distinct from the CS foundation path. First three conditions use one revision head per worker, fourth one shared head; fresh phase heads keep revisions within the real 100-revision bound (cold80, warmup16 plus warm80). Creation always uses fresh codes. Shared-resource VERSION_CONFLICT is expected only on revision commands. The same predeclared warm concurrency8 target applies to distinct-resource results, separately by workload. This is a representative authority/CRUD workload, not proof of all stock/internal-execution command costs. Total requested measurement for both matrices is38,400 commands plus3,840 warmup. Publish any guarded UNTESTED cells rather than declaring complete platform capacity.

Reproduction: set `IEMS_BENCH_SOURCE` to an unmodified checkout of the selected source commit and `IEMS_BENCH_EVIDENCE` to an external directory, then run `node checkpoints/review-five-findings/qa/concurrency-benchmark.mjs`. The source commit and source manifest are written into every result. An optimized run must use the same protocol and payload mix, with its actual source hash, without changing the predeclared target after seeing baseline results.

## Baseline result

Attempt1 completed on the unchanged baseline, exit0, 2026-10-25 03:46:00 through04:08:35 UTC (about22m35.75s). Environment: Windows10.0.26300, Node24.19.0, Intel i5-9400F six logical cores,15.94GiB RAM; one owned Mongo7.0.14 WiredTiger replica/cache0.25GiB. Replica startup1265ms was separate from measurements. All879 tracked baseline files matched before/after: SHA-256 manifest digest `8d64aa65cfc17015b8537e875f30d9020ca9a320950abe6448f8114cc0f3e121`.

Measured24,800 cold+warm logical commands plus2480 separately reported warmup commands.23,675 measured commands succeeded;1125 expected same-resource version conflicts occurred; unexpected errors0.62of96 planned cells completed all200cold/40warmup/200warm commands and passed exact effect/key/audit reconciliation.34 cells were UNTESTED under the frozen resource guard, not reduced samples or failed samples removed. The raw results include65,160 observed callback retries and65,160 failed write-conflict commands;66,285 abort commands include the1125 expected business refusals. These counts concern repeated transaction attempts, not corrupt business effects.

The following warm figures are pooled p95 milliseconds / successful logical commands per second. Each fully measured combination has three repetitions of 200; PARTIAL means only 2/3 repetitions and is not a completed target proof. Shared-resource successful throughput excludes expected 409 responses.

| Workload | Condition | C1 | C4 | C8 | C16 |
| --- | --- | --- | --- | --- | --- |
| Foundation CS | Same plant, distinct tickets |78.83 /17.16|264.98 /36.69|879.60 /25.97|3906.93 /14.85|
| Foundation CS | Different plants, same tenant |93.66 /15.87|UNTESTED|UNTESTED|UNTESTED|
| Foundation CS | Different tenants |UNTESTED|UNTESTED|188.09 /69.40|UNTESTED|
| Foundation CS | Same ticket |78.85 /17.37|221.91 /29.65|1160.73 /17.52|UNTESTED|
| Portfolio guard | Same plant, distinct heads |91.34 /17.70|156.72 /55.51|658.79 /41.80|UNTESTED|
| Portfolio guard | Different plants, same tenant |94.10 /16.91|169.54 /54.38|625.23 /42.60|UNTESTED|
| Portfolio guard | Different tenants |93.46 /16.56|221.00 /45.18 PARTIAL|206.11 /68.32|UNTESTED|
| Portfolio guard | Same revision head |79.15 /17.52|142.15 /45.13|688.51 /31.02|UNTESTED|

Every measured distinct-resource C8 condition met both predeclared targets in all three repetitions; the largest single-repetition p95 was1087.23ms for CS same-plant. CS different-plants C8 remains untested, so the full scope target is not established. Same-plant CS scaling also shows material contention: throughput fell from36.69/s atC4 to25.97/s atC8 and14.85/s atC16. CS same-plant C16 had pooledp95=3906.93ms, worst-repetitionp95=5086.56ms and7677 retries across600warm commands. C16 had no predeclared2second target; these remain measured limits rather than a retroactively invented target failure.

Queue latency is separate: with a fixed200-command backlog, pooled C8 same-plant admission-queue p95 was7185.86ms for CS and4299.00ms for portfolio; total including queue was7554.84ms and4534.95ms respectively. The predeclared HTTP service-latency target excludes that artificial backlog. No end-to-end2second queue SLA is claimed. Per-command p50/p95/p99, both queue percentiles, pool-checkout distributions and cold/warm/startup separation remain in raw evidence.

During measured phases host CPU reached83.23%, Node RSS377.70MiB and Mongo resident memory713MiB; minimum sampled available RAM during a running phase was2.05GiB. Between cells the guard observed as little as0.926GiB available and CPU83.34%, causing untested cells. This was a shared workstation, not a dedicated benchmark host. No unrelated processes were stopped and no guard threshold changed.

Raw evidence under the externally configured baseline directory: `benchmark-attempt1.jsonl`, `benchmark-attempt1.exit.json`, `environment.json`, `source-before.json`, `source-after.json`, each workload/condition/concurrency/repetition/phase JSON, `effect-checks.jsonl`, `summary.json`, `capacity-summary.json`, and `capacity-table.md`. Reproduce aggregation with `node checkpoints/review-five-findings/qa/summarize-benchmark.mjs` using the same evidence environment variable. No raw evidence is committed.

Current-guard deterministic authorization ordering passed 9/9 entries: seven revoke/deactivation cases checked fresh mutation and acknowledged replay, plus a documented mutation-first overlap. Supplemental domain probes also passed their bounded orderings. They do not isolate two same-scope domain snapshots from the authority fence.

At attempt1, F5 remained BLOCKED for full acceptance with 34 guarded cells and the response to material contention open. The resume result below updates coverage without changing that verdict. [ADR 001](ADR-001-AUTHORITY-CONTENTION.md) retains current authority writes and records a prospective permit design with full ordering/resource/retest gates. A future optimization requires identical before/after workload and independent review. Removing shared fences or relying on old authorization caches is not an acceptable inference from these measurements. CS and representative CRUD capacity do not certify stock allocation, internal execution, financial or PostgreSQL throughput.

## Required correctness seams and residual limits

The six foundation writes establish overlap conflicts with session revoke, role/scope membership edits, user/tenant/plant/entity deactivation. Tests must distinguish committed revocation before authoritative verification (deny) from overlapping mutation/revocation (document ordering). A test-only wrapper around the late-bound transaction authorization port can pause before verification or after its successful writes; a transaction callback wrapper can retry after an abort. To isolate stock/domain conflicts from shared authorization contention, barriers must be after the relevant business snapshot reads on separate sessions and require actual domain CAS/unique constraints to choose a winner. No production bypass, authorization cache, or fence deletion is allowed by this QA lane.

## Resume addendum: selection only, no protocol change

Added after attempt1 to allow a later exclusive resource window to re-observe the 34 guarded cells. Their old guard observations are historical, not a permanent statement about available RAM. This addendum does not change any target, workload, identity seed, phase, sample count, repetition or threshold. No resume benchmark has run as of this addendum. F5 remains BLOCKED for material contention and the unimplemented safe authority model even if more cells are measured.

The optional inputs are paired: `IEMS_BENCH_RESUME_SUMMARY` points to the original external `summary.json`, and `IEMS_BENCH_CELL_IDS` is a JSON string array of exact IDs `workload:condition:concurrency:repetition`. Without both, the unchanged default is the original 96-cell matrix; supplying only one fails before Mongo starts. Selection rejects unknown or duplicate IDs, cells already measured in any phase, prior fatal/source-change records, mismatched source SHA/digest and changed frozen protocol/targets. It runs selected IDs in their original matrix order, retaining original repetition numbers and label-derived fixture/command identities. A filtered index never enters a seed.

Every selected cell still receives a fresh owned marked database/app, 200 cold commands, 40 warmup and 200 warm commands with independent users/sessions. C16 still requires at least 3GiB free RAM and CPU below 80%; others require at least 2GiB. The 1.5GiB runtime admission floor, draining and retained partial/UNTESTED behavior are unchanged. A resource guard is sampled again for each selected cell; it may still refuse the cell. Do not stop user processes to make it pass.

Use a new external attempt2 directory. The harness refuses the original summary's directory and existing result artifacts before writing manifests; only an attempt stdout/exit log may already exist there. It writes `selection.json` containing all selected/omitted canonical IDs and the SHA256 of the prior summary, records selection in its environment/summary, and captures complete baseline source manifests before and after. The source must remain the clean read-only `54a7e6d` checkout with the original digest. Attempt1's 62 completed cells and all failures/guard observations remain untouched. Any later combined report must retain both attempt identities, join by full cell ID, and use complete resume evidence only for cells originally UNTESTED. Partial attempts remain partial; they cannot replace a complete successful cell or count as a completed repetition.

Portable PowerShell preparation, after the lead grants the exclusive Mongo token:

```powershell
$env:IEMS_BENCH_SOURCE = '<clean-baseline-checkout>'
$env:IEMS_BENCH_EXPECTED_SHA = '54a7e6db5fb1cfc48252477ca872d700c8c650ee'
$env:IEMS_BENCH_EVIDENCE = '<new-external-attempt2-directory>'
$env:IEMS_BENCH_RESUME_SUMMARY = '<original-external-directory>/summary.json'
$prior = Get-Content -Raw -LiteralPath $env:IEMS_BENCH_RESUME_SUMMARY | ConvertFrom-Json
$ids = @($prior.results | Where-Object state -eq 'UNTESTED' | ForEach-Object {
  '{0}:{1}:{2}:{3}' -f $_.workload,$_.condition,$_.concurrency,$_.repetition
})
$env:IEMS_BENCH_CELL_IDS = ConvertTo-Json -Compress -InputObject $ids
node checkpoints/review-five-findings/qa/concurrency-benchmark.mjs
```

Retain command stdout and exit code separately in the new evidence directory. Do not run this preparation as implied authorization to start Mongo while browser/API/another benchmark owns the token. Clear the two selection variables before a later default full-matrix run.

Original gaps: CS C1=3, C4=6, C8=3, C16=9; portfolio C4=1 and C16=12. If all 34 pass their guards, the additional request is 13,600 cold+warm commands and 1,360 warmup. Estimated duration is 10–20minutes including setup from measured peer-cell durations, with unmeasured portfolio C16 costs uncertain; retries and the existing 120second HTTP deadline may extend it. If all guards refuse, selection costs about 34 one-second guard samples plus replica startup/teardown. This is scheduling guidance, not a post-hoc target.

Light validation only: `node --test checkpoints/review-five-findings/qa/benchmark-selection.test.mjs` passed 3/3, exit0; harness syntax passed. A dry selection against actual attempt1 evidence returned exactly 34 selected/62 omitted IDs, without importing the baseline application or starting Mongo. These prove selector safety boundaries, not resumed capacity.

## Executed baseline resume attempt2

After the lead granted an exclusive window, resume attempt2 ran from 2026-10-25 05:30:39.979 to05:32:16.133 UTC, exit0,96.15seconds. This is the same clean read-only54a7 baseline, not an optimized candidate. All879 source files still match the original digest `8d64aa65cfc17015b8537e875f30d9020ca9a320950abe6448f8114cc0f3e121` across both attempts' before/after manifests. The original summary hash remains `9d205e4ecb27640d3a454777f08604d4abf0a5af55be381ca4eb7895bc413a0b`; attempt1 results were not overwritten.

Initial free RAM was2.553GiB with CPU27%. The harness freshly admitted three CS different-plants C4 repetitions, each completing200cold/40warmup/200warm commands. Their600warm commands had pooled latency p50=94.63ms, p95=265.46ms, p99=408.71ms and34.34 successful commands/s. C4 has no separate retroactive target; these are additional baseline observations.

The next selected cell, CS different-plants C8 repetition1, admitted62 of200 cold commands before sampled free RAM fell below the unchanged1.5GiB runtime admission floor. It drained in-flight work; all62 succeeded and exact note/update/key/audit effect checks passed. The cell remains PARTIAL, with no warmup or warm measurement. Its phase minimum was1.165GiB. The remaining30 selected cells were recorded UNTESTED under the interruption rule; a later between-cell guard observed0.562GiB. No threshold was reduced, no user process was stopped and no partial sample was discarded. The environmental observation is specific to this run, not a permanent claim about available resources.

Resume retained1262 cold/warm commands and120 separately reported warmup commands, with1262 successes, zero expected conflicts and zero unexpected errors. Measured phases recorded3427 callback retries/write conflicts and3427 abort commands. All four actual cell effect reconciliations, including the partial cell, passed. Normal marker-checked database cleanup, client/replica shutdown and final source verification completed before exit. This guarded stop is not a completed-matrix PASS.

Combined evidence joins the original62 complete cells with3 new complete cells:65/96 complete,1 partial and30 wholly untested. It retains26062 cold/warm commands,2600 warmup,24937 successes,1125 expected same-resource conflicts, zero unexpected errors,68587 callback retries/write conflicts and69712 abort commands. Those totals include the62 partial cold commands; they do not count that repetition as complete. CS different-plants C8 capacity remains unproven. Existing same-plant contention and the safe authority optimization/retest gate remain open, so F5 stays BLOCKED.

New external evidence directory: `performance-baseline-resume-attempt2/`, containing `benchmark-attempt2.jsonl`, `benchmark-attempt2.exit.json`, `selection.json`, environment/source manifests, individual phase samples, `effect-checks.jsonl` and `summary.json`. Its `combined-baseline-summary.json` retains both attempts' per-cell rows and full IDs, labels the aggregation `COMBINED_BASELINE_NOT_OPTIMIZATION`, and preserves original guard history. No raw results were committed. The heavy token was released immediately after normal teardown; a subsequent heavy owner must check then-current resources independently.

## Executed baseline resume attempt3

A new exclusive window remeasured current resources rather than treating attempt2's observation as permanent. Preflight found3.180GiB free RAM and43.55% host CPU; the benchmark environment recorded3.163GiB initially. The unchanged selector selected exactly30 wholly UNTESTED IDs from attempt2's summary. CS different-plants C8 repetition1 already had62 cold samples, so it was excluded and its original partial evidence remains intact. No completed cell was rerun.

The executed command used the same harness and paired inputs below. `$baselineRoot` and `$evidenceRoot` are operator-supplied local paths; the baseline must be the clean54a7 checkout and evidence must remain external. The prior summary hash was `e17b1098e223225d03b116fb87a833b5b7354b53291aa866ef6e784f9829a1b1`.

```powershell
$env:IEMS_BENCH_SOURCE = $baselineRoot
$env:IEMS_BENCH_EXPECTED_SHA = '54a7e6db5fb1cfc48252477ca872d700c8c650ee'
$env:IEMS_BENCH_EVIDENCE = Join-Path $evidenceRoot 'performance-baseline-resume-attempt3'
$env:IEMS_BENCH_RESUME_SUMMARY = Join-Path $evidenceRoot 'performance-baseline-resume-attempt2/summary.json'
$prior = Get-Content -Raw -LiteralPath $env:IEMS_BENCH_RESUME_SUMMARY | ConvertFrom-Json
$ids = @($prior.results | Where-Object state -eq 'UNTESTED' | ForEach-Object {
  '{0}:{1}:{2}:{3}' -f $_.workload,$_.condition,$_.concurrency,$_.repetition
})
if ($ids.Count -ne 30) { throw 'Expected exactly30 wholly UNTESTED cells' }
$env:IEMS_BENCH_CELL_IDS = ConvertTo-Json -Compress -InputObject $ids
node checkpoints/review-five-findings/qa/concurrency-benchmark.mjs
```

Attempt3 ran from2026-10-25 06:58:40.370 to07:01:59.367 UTC,198.997seconds, exit0. Nine selected cells completed every200cold/40warmup/200warm phase: CS different-plants C8 repetitions2/3, CS different-tenants C1 and C4 repetitions1/2/3, and portfolio different-tenants C4 repetition3. All nine exact effect/key/audit reconciliations passed. The attempt retained3600 measured commands, all successful, and360 separate warmup commands; expected conflicts0, unexpected errors0, instrumentation errors0. Measured callback retries/write conflicts/aborts were5070 each; including warmup they were5547 each. These are repeated transaction attempts, not duplicate business effects.

The two complete CS different-plants C8 warm repetitions contain400 samples: p50=201.89ms, p95=738.19ms, p99=956.87ms and28.54 successful commands/s. Their admission-queue p95 was6462.71ms and queue-inclusive response p95 was6729.60ms. This is2 complete repetitions plus the retained partial repetition1, not the required3 complete repetitions or a completed C8 target proof. No latency or throughput target changed after observation.

The remaining21 selected cells were all C16 and stayed UNTESTED at their pre-cell guards. Their sampled free RAM was2.330–2.783GiB, below the unchanged3GiB requirement; their maximum sampled host CPU was30.18%. No running phase crossed the1.5GiB admission floor: minimum running-phase free RAM was2.564GiB. Measured-phase host CPU peaked64.21%, Node RSS346.96MiB and Mongo resident memory341MiB. No user process was stopped, no threshold was reduced and no incomplete cell was promoted.

All879 files matched before/after again, with digest `8d64aa65cfc17015b8537e875f30d9020ca9a320950abe6448f8114cc0f3e121`; the baseline remained clean. Original summary hash `9d205e4ecb27640d3a454777f08604d4abf0a5af55be381ca4eb7895bc413a0b` and attempt2's hash above remain unchanged. Attempt3 summary hash is `75ede14b6562484fc56957fa639d2e1f5750c51710496bdcebf4ccf0f45b26e7`.

Combined coverage is62+3+9=74/96 complete,1 partial and21 UNTESTED. All three attempts retain29662 measured commands plus2960 warmup,28537 measured successes,1125 expected same-resource conflicts and zero unexpected errors. Measured callback retries/write conflicts total73657 and abort commands74782; the62 partial cold commands remain included without counting their cell as complete. The external attempt3 `combined-baseline-summary.json` preserves every canonical cell ID and each attempt's original rows. Its kind remains `COMBINED_BASELINE_NOT_OPTIMIZATION`.

A standalone targeted repeat with only `IEMS_BENCH_CELL_IDS` is unsupported: the frozen harness requires paired summary/IDs, and the selector rejects any cell already measured in any phase. No selector patch or bypass was made. The partial C8 repetition remains a capacity gap. Independently, measured material contention and the absence of an accepted proof-preserving authorization optimization/retest remain blockers, so F5 stays BLOCKED even if later resources permit more baseline measurements.

External `performance-baseline-resume-attempt3/` retains stdout/exit, selection/prior hash, source manifests, phase samples, effect checks, summary and the combined report. Normal marker-verified database cleanup and owned-replica shutdown completed, with zero remaining mongod processes observed before token release. No production source or other checkpoint document was changed for this resume.
