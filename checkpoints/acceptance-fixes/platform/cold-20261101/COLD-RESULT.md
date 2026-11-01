# SEC-R01-COLD: measured bounded fixture completion

IMPLEMENTED_QA_PENDING. No production source defect was proven and no production/test/helper source was changed in this continuation. The deliverable is a guarded, active startup/profile arrangement with exact capacity and portable-tool receipts. CTO integration/freeze and independent security acceptance remain required. All earlier handoff sections and adverse QA results remain valid evidence.

## Provenance and preserved contract

Started from clean `0d5137e67c036df9f62caf00ee844cbd751fb203`; merged immutable corrected candidate `9269ae5d504378ecf7bdaae0edf963b893afcc96` with provenance in `39a79724eb55edeb79df33ae86dd0eb6629944b4`. Workspace/branch remain `D:/Project AI/GITHUB/IEMS-worktrees/iems-accept-fix-20261101-platform`, `program/iems-accept-fix-20261101-platform`. Model UNVERIFIED; remote/CI UNKNOWN; local only.

The entire original recovery test and shared helper are byte-identical to9269ae5. Before120000ms, parent180000ms, after60000ms, original eight cases, provider/fault options, receipt/outcome/authorization/fence assertions and marker checks remain unchanged. No seeding/index/source guard was skipped. Native Mongo7.0.14/count1/WiredTiger0.25GiB/oplog128MiB is real; provider effects retain their original LOCAL_SIMULATED label and original real orchestration/BEGIN/fencing behavior.

The own evidence loader changes only fixture namespace, loopback ports, private native data path, passive driver command monitoring and timestamps. It splits the existing helper's initialization and seed expression solely to timestamp their original awaited calls. Original helper assertions are mechanically compared before loading. Actual commands record collection names and durations without query payloads, credentials, tokens or private content. Exact early UUID marker, OS creation/PID/command/RSS, drop and stop are recorded. No application/provider transport is rewritten.

## Results and capacity

| Run | Native ready | Initialized | Seeded | Authenticated | Index commands / total command time | Actual outcome |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Independent security171 candidate review | 7985.1522ms | NOT_REACHED | NOT_REACHED | NOT_REACHED | Not separated in that report | Before-hook FAIL120004.1982ms; eight original cases NOT_RUN |
| Continuation profile: real marker guard fixture | 9619.2493ms | 102798.6507ms | 117957.0867ms | 118995.9722ms | 277 /87569ms,0 index failures | Actual missing/foreign marker cleanup negatives PASS; normal restored-marker cleanup completed |
| Same profile invocation: original recovery fixture | No launch | NOT_RUN | NOT_RUN | NOT_RUN |0 | Preflight refused CPU81.648% against unchanged80% limit; eight cases NOT_RUN. Invocation exit1,1PASS/1FAIL,0skip/cancel |
| One controlled recovery-only measurement after tooling completed | 8183.1764ms | 66184.6570ms | 68168.4092ms | 69356.2290ms |277 /55587ms,0 index failures | Exit0,9PASS (parent + all eight),0FAIL/SKIP/CANCEL; sourceUnchanged and sampled RAM floor respected; process93415ms |

Times are cumulative from helper entry, not additive phase durations. The marker profile had initialize93.17s after client connection and seed15.16s; controlled recovery had initialize57.98s after connection and seed1.98s. Actual index-command durations account for much of initialization. This establishes observed phase costs and variability, not a causal production diagnosis or a guaranteed cold-start SLO.

The first profile admitted at3.61GiB free RAM/59.58% CPU but later sampled0.76GiB and100% CPU. Its functional marker-negative PASS is not capacity PASS. The unchanged second preflight correctly refused a new native start. That run's failures were preserved; no retry loop or threshold change occurred.

During independent supported tool work, the task-activated existing WSL distro was returned to its initial stopped state. A later five-second sample showed materially quieter CPU10.68–28.75% and approximately4.48GiB free RAM; this justified one controlled recovery-only measurement, reusing completed marker checks. Preliminary samples are not admission guarantees: actual native preflight later measured2764079104 free bytes (2.57GiB) and59.88% CPU. The final run still completed all assertions; sampled free RAM minimum2301857792 bytes (2.14GiB), no1.5GiB-floor breach. Host CPU peaked99.09% during native work; the80% rule is a preflight rule, not a new in-flight workload SLO.

Original launch guards remain >=2GiB available RAM, CPU<80% over1s and >=1GiB free disk before every fixture. Reproduction also requires the assigned sole-heavy window and no concurrent source scanning/generation/tool probes. The owner performed none during either measured fixture; process preflights detected no competing Mongo/Java/Docker/rg runtime. This is a bounded observed window, not proof of global machine idleness. Resource sampling is every2s and can miss shorter dips. New runner returns nonzero if any sampled RAM falls below1.5GiB, even if TAP assertions pass.

Observed first-run RAM drop was about2.85GiB. A conservative5GiB free-RAM planning recommendation leaves more room than the original guard, but was not met by the later quiet-window diagnostic and is not presented as a newly proven requirement or a changed acceptance threshold. Existing2GiB/80% guards alone did not guarantee120s setup on the earlier busy host. Schedule a quiet window, retain actual per-stage/resource receipts, and report a rejected guard or timeout honestly. Do not kill another workload, reduce thresholds, extend the timeouts or reuse an already seeded DB to manufacture success.

## Original child timing table, controlled run

| Case | ms | Result |
| --- | ---: | --- |
| Quota/audit rollback |611.01 | PASS |
| Immutable selection/receipt, concurrent continuation |3784.85 | PASS |
| Approved draft freeze/child charge |2980.38 | PASS |
| Ambiguous claim/no invoke/same-parent retry |2608.27 | PASS |
| Status kinds perform zero writes |1523.61 | PASS |
| Private content omitted |8.04 | PASS |
| Human not-submitted new fenced ordinal before provider BEGIN |2238.64 | PASS |
| Suspend/stop delayed parent/child drain |1807.26 | PASS |

Exact unrounded values, stage events, command totals, assertions and exit receipts are in `evidence/timing-summary.json`, both native evidence subdirectories and their TAP. Original independent failed TAP/command/result and read-only failed-data reconciliation are preserved under `evidence/independent-failure/`; original stopped failed data was not reopened, replayed, dropped or altered.

## Reproduction

Use a new private child under this issue's recorded D: checkpoint root, with matching sole-heavy ownership and free reserved32720–32739 ports. Do not launch capability probes, source audits or generators alongside native startup. Existing ignored dependency junctions are reused read-only; no install/lock/cache mutation.

```powershell
$env:QA_SOURCE_ROOT=(Get-Location).Path
$env:QA_RUNTIME_ROOT='<fresh private D: child under this issue checkpoint root>'
$env:MONGOMS_SYSTEM_BINARY='C:/Users/Admin/.cache/mongodb-binaries/mongod-x64-win32-7.0.14.exe'
$env:MONGOMS_RUNTIME_DOWNLOAD='false'
$env:TMP='<task-owned D: TEMP>'
$env:TEMP=$env:TMP
# Original recovery and marker negatives, sequential, each on fresh native state:
node checkpoints/acceptance-fixes/platform/cold-20261101/run-exclusive.mjs
# Smallest recovery-only check when unchanged marker proof already exists:
node checkpoints/acceptance-fixes/platform/cold-20261101/run-exclusive.mjs packages/tenant-lifecycle/automation-recovery-v15.test.mjs
```

The active owning runner records the exact selected argv, source/instrumentation hashes, child PID, exit/signal and elapsed time, with420000ms outer cap. Source hashes are read only before/after child lifetime, not concurrently with measured setup. No detached monitor, supervisor, automatic retry or altered selected case body exists.

## Resources, cleanup and limits

`evidence/cleanup.json`:9 recorded runtime/runner identities absent;2 native starts/2 normal stops/2 exact-marker protected DB drops/2 cleanup completions; loopback32720/32721/32722 rebound and closed. Both source-before/after manifests matched. Browser/profile NONE. Exact process creation identities and commands are in native events; native paths, markers and existence after cleanup are recorded. Mongo observed RSS maximum151220224 bytes across explicit startup/OS samples, not a continuous peak. Node sampled RSS maximum157495296 bytes in the successful recovery. No unrelated process was stopped or native data recursively deleted.

`CAPABILITY-RECEIPT.md` distinguishes actual available WSL/Linux, Python/Java and portable Terraform from missing native Kafka/Rabbit/Redis/Qdrant/Airflow/Flink/Spark packages and inactive Docker daemon. Native engine RSS/workloads remain NOT_RUN. The existing distro limit6GB RAM/4CPU/2GB swap was not changed. Starting its existing Docker daemon is an optional concrete host-service decision for Board/CTO; task-local Linux dependencies can be prepared without that service. This receipt does not label absent local engines external or close their roadmap rows.

No production/test/helper/pin changes were necessary. No broad regression, all96F5, real provider/customer send, user PostgreSQL access, paid service, global installation, host feature/firewall/permission change, public push/merge or deployment was performed. Historical native n8n startup failure and missing joined native engine acceptance remain owned downstream; this task does not clear them.

Next: CTO integrates the clean continuation tip and freezes a corrected candidate; independent Security Reviewer reruns original recovery acceptance. Data/broker/AI owners use the exact capability receipt to prepare supported local engines under their existing scope. Product and full55 acceptance remain unaccepted.
