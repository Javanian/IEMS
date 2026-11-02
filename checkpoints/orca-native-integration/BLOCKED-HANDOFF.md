# Stage B blocked handoff

**BLOCKED: native host capacity and startup diagnosis. Implementation is preserved, not accepted.** TPR-157 and parent TPR-135 remain unaccepted; `fullEndpointCoverage=false`.

Implementation source: `a60ca641dc7a3d15100bd15b5ad00d878c1ad6d5`. This handoff adds evidence only. The inherited 20 WIP files were preserved and completed through local commits, including managed native kinds, original attempt/SMTP binding, scoped native service admission, cross-mode credential revocation, generated metadata, the native harness and owned cleanup. Provider/adapter source remains Stage A. No push, PR, default merge or deployment occurred.

## Observed results

| Check | Result and qualification |
| --- | --- |
| Focused API/provider/adapter/recovery/lab suite | 47 passed before later bounded source corrections; includes all eight existing recovery child assertions |
| Native engine source mapping and legacy engine follow-up | 16 passed |
| Native-only service role/composition/registry | 12 passed |
| Cross-mode credential replay/revocation and registry | 2 passed |
| Final startup/cleanup/readiness/workflow checks | 8 passed; source matches implementation above |
| Final actual admission/domain source verifiers | Both passed at the implementation SHA |
| First approved runtime setup, `771f84fb...` | Exit 1, 0 passed / 1 failed; API missed its unchanged 120-second readiness deadline; n8n and SMTP never launched |
| Second approved attempt, `a60ca641...` | Exit 1, 0 passed / 1 failed; original 3584 MiB free-RAM guard rejected it before a root or service was created |

Counts overlap and are not a combined coverage total. Exact commands, source qualifications and raw-log hashes are in [verification.json](verification.json). Earlier scratch-setting failure and the superseded broad-service-role test run remain retained; neither is promoted to final proof.

After the second failure, the 2026-11-02 03:57:32.916 UTC snapshot measured **3309.17 MiB free RAM** against the 3584 MiB requirement. This is a later observation, not an invented exact failure-time reading. Capacity fluctuates near the threshold; no stable headroom was established and no unrelated process was stopped.

## Cleanup and limits

The first supervisor recorded a marker-checked database drop and normal API/Mongo shutdown. Independent checks verified all three original PID/creation-time identities gone and loopback ports 32740–32746 free. The second attempt created no runtime resource. Raw logs, private root, native owner marker and recovery context remain outside Git. No actual native n8n history or SMTP acceptance proof exists from these attempts.

The first failure also exposed a cleanup-reporting race. The final source handles a supervisor that has already entered self-shutdown without waiting for an impossible control acknowledgment, while retaining actual exit, database-drop, identity and port checks. Native supervisor module loading was reduced and API initialization timing added. These corrections do not establish the cause of the first startup delay or prove it fixed. All API120/setup300/parent180/teardown60 and RAM/CPU/disk guards remain unchanged.

## Resume

The coordinator must first establish safe host headroom and review the exact clean handoff SHA, including its evidence-only ancestry to the implementation SHA. Then, in the assigned worktree, set `IEMS_NATIVE_REVIEWED_SHA` to that explicitly approved full HEAD, retain `MONGOMS_RUNTIME_DOWNLOAD=false`, set `IEMS_NATIVE_EVIDENCE_ROOT` to the external task checkpoint's `runs` directory, and execute:

```powershell
node --test --test-concurrency=1 ops/automation-lab/native-history.test.mjs
```

Use a fresh owned root and unchanged budgets. Preserve failures and measured startup stages; do not blindly rerun. No further run is authorized in the completed dispatch.

Actual engine/SMTP identity, ACK-loss recovery, restarts, revocation/publication, drain barriers, pruning and privacy scenarios remain unrun. Native ErrorTrigger original-attempt correlation and automatic scheduled child continuation remain explicit workflow gaps. WA15/17, PREPARED document recovery, mounted Automation Center QA, independent acceptance and the broader contract-review gaps remain open.
