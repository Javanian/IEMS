# Backend performance acceptance — 2026-11-02

The original backend performance matrix is complete and its scoped acceptance
criteria are met at clean source commit
`e8bec8cad0a210021493aad3034953ad557c0bc5`.
This is local backend verification. Independent product QA and release approval
remain pending; this report does not establish production readiness.

| Check | Verified result |
| --- | --- |
| Matrix coverage | 96 complete, 0 partial, 0 untested |
| Phase batches | 288: cold, warmup and warm for each cell |
| Measured commands | 38,400: 36,250 successes and 2,150 expected same-resource conflicts |
| Warmup commands | 3,840, counted separately |
| Unexpected errors | 0 |
| Exact effect, key and audit checks | 96 passed |
| Distinct-resource warm C8 targets | All 18 repetitions passed |
| Worst distinct-resource C8 service p95 | 1,174.7502 ms; target at most 2,000 ms |
| Lowest distinct-resource C8 successful throughput | 12.9779 commands/s; target at least 4/s |
| Source integrity | All 1,803 tracked files matched before/after manifests |
| Fixture cleanup | 96 marker-verified database drops, 2 normal replica stops |
| Final owned resources | 8 recorded process IDs absent; 20 reserved ports free |

The first run completed 93 cells. Three cells were refused by the original
CPU/RAM admission guards and subsequently completed using the existing
`benchmark-selection.mjs` resume selector:

- `foundation-cs:same-plant:1:1`
- `portfolio-guard:same-resource:16:2`
- `portfolio-guard:same-resource:16:3`

The resumed run used the same source SHA, source digest, protocol, sample counts,
repetitions and thresholds. Each canonical cell appears once in the combined
results. No completed cell was rerun or discarded, and the original refusals
remain in the evidence. The external runner changed only fixture ownership,
namespace, reserved ports and private data placement; its resume copy additionally
supplied the paired prior-summary and three-cell selection values. No business
source or benchmark assertions changed during either run.

## Interpretation and limits

The fixed target in `checkpoints/review-five-findings/CONCURRENCY.md` concerns
HTTP service latency at concurrency eight. Benchmark admission backlog and
queue-inclusive response times are recorded separately. CS queue-inclusive p95
in the reported same-plant and different-plants C8 cells was approximately
11.1–14.7 seconds. This result does not promise two-second total response time.
Expected same-resource version conflicts are not successful capacity.

All admitted cells passed their original CPU and RAM preflight thresholds.
Phase CPU sometimes reached 100%; the 80% CPU limit is an admission criterion,
not a runtime stop threshold. Runtime RAM remained above the original stop floor.
No guard, watchdog or unrelated service was disabled.

The earlier 88 scoped TAP entries, including parent entries, remain separately
qualified in [QUEUE-RESULT.md](QUEUE-RESULT.md). Historical failures and incomplete
baseline matrices are retained; this candidate result does not rewrite them.

## Evidence provenance

Raw logs and process receipts remain in the operator's external evidence archive.
They are not published with this branch. These checksums identify the reviewed
artifacts; access to the originals is required to independently reproduce the
evidence audit. The committed harness and original protocol describe the test.

| Artifact | SHA-256 |
| --- | --- |
| Original 93-cell summary | `8213ee573aca25af5f81009386f32615b40c761babd3f58434f738f242501b13` |
| Three-cell resume summary | `5a22003713af25639aca3cd4a270f224e9e612d4380cad1bbe41bb80f2e6b320` |
| Joined reconciliation receipt | `30f03c568067e81574f6ce891d324c8ad13b64f8c9d588a3e9b4d8b8929df055` |
| Evidence checksum manifest | `dfc022d84c61693d0bdd74907ad347bc3d86b3e293e7bc4bcc725a360b550ab4` |

The lead independently checked the report, 327 evidence artifacts, the current
tracked source, canonical cell coverage, targets and fresh resource cleanup.
The implementation was assisted by Codex using `gpt-6-astra`; final reconciliation
and the three-cell continuation used `gpt-6.1-sol` through Orca.

## Remaining gates

Independent QA, ErrorTrigger and scheduled-child execution, WA15/17, PREPARED
recovery, and parent TPR-135/157 acceptance remain open. Remote CI, merge and
deployment are separate gates. Publishing this feature branch does not close
them or authorize a merge to main.
