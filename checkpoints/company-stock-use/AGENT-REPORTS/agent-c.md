# Agent C — independent company stock QA

Base: `f4cf6fd`. Final independent attempt 7 passed against the API frozen after owner attempt 4. This lane changed only its QA files and this report; no production change, commit, push, build or browser run was performed by C.

## Final result and source boundary

Command from the repository root:

```text
node --test --test-concurrency=1 checkpoints/company-stock-use/qa/company-stock-use.test.mjs
```

Node 24.19.0 and cached MongoDB 7.0.14 ran one disposable, marked replica with a 0.25 GiB WiredTiger cache. Final preflight measured 3.818 GiB free RAM, CPU load 31%, and zero pre-existing mongod processes; the minimum RAM guard remained 2 GiB. No user process was stopped.

Attempt 7: **15 passed / 0 failed / 0 skipped / 0 cancelled**, exit 0, reported duration **81.581 seconds**. The root test contains fourteen child cases. Started 2026-10-25 09:41:31.255 UTC; finished 09:42:52.933 UTC. All 42 captured API-source, tenant-foundation and QA file hashes matched before/after. That bounded manifest is not a whole-repository or dependency-install attestation; UI-only edits permitted during this run were outside it. The owned harness finished teardown and the final process check found **0 mongod**.

Raw evidence remains external under `company-stock-use-20261025/independent-attempt7/`: `independent-company-stock.tap`, `exit.json`, `preflight.json`, `source-before.json`, `source-after.json`, and `cleanup.json`. Attempt 7 has no teardown ECONNRESET. The earlier attempt 5 raw log retains a nonfatal Mongo `read ECONNRESET` during teardown; that parent test passed, exit was 0, and no mongod remained. The diagnostic is not silently removed or counted as a browser diagnostic.

Source files and C QA are frozen after this result. Parent-owned maintained API, UI, browser, publication and CI acceptance are separate gates.

## Retained attempts

Every attempt has a separate external directory; later results do not replace earlier raw failures.

| Attempt | Actual result | Explanation |
| --- | --- | --- |
| 1 | 2 passed / 11 failed; exit 1; 41.843 s | QA used `h.seeded.identities.find` although the harness returns the seeded identity array directly. Failure before releasing a company hold caused dependent-case cascades. Corrected the test lookup only. |
| 2 | 11 passed / 2 failed; exit 1; 57.252 s | One child and its parent failed: the terminal-source fixture used the same item as both output and input. Existing engineering correctly rejected that self-material plan with `INVALID_INTERNAL_PLAN`. Changed the fixture caller to use a distinct existing manufactured output item. |
| 3 | 11 passed / 2 failed; exit 1; 62.681 s | The terminal source and stripped-marker checks passed. Its final shipment request omitted mandatory `reference`, so `INVALID_TEXT` occurred before the intended source-type refusal. Added that required fixture field; retained the strict `INVALID_SOURCE` expectation. |
| 4 | 13 passed / 0 failed; exit 0; 57.845 s | Complete pre-hardening probe passed. This result precedes the queued source-snapshot/history hardening and is not final-source acceptance. |
| 5 | 13 passed / 0 failed; exit 0; 62.244 s | Final hardened API, plus the added untyped ISSUE replay/head-fault permission checks. Nonfatal teardown diagnostic retained as described above. |
| 6 | 13 passed / 2 failed; exit 1; 93.115 s | Added two dependency cases. Actual item revision withdrawal passed. One child and its parent failed because the new location fixture also reserved direct LOT stock at the producer location: ISSUE could hit that catalog dependency first and return `CATALOG_DEPENDENCY_CHANGED`. The source-bin fault was restored in `finally`. No product change followed. |
| 7 | 15 passed / 0 failed; exit 0; 81.581 s | Changed only the new dependency consumer factory to actual mounted V2 engineering with company material alone and a distinct consumer location. Kept the strict `COMPANY_DEPENDENCY_CHANGED` expectations and full snapshots; all original mixed-input assertions remain unchanged. Actual master revision, restored bin fault, and actual source-location deactivation passed. |

All attempts recorded unchanged captured source hashes during execution and zero mongod after cleanup. Corrections were QA fixture corrections, not weakened business, rollback, replay or conservation assertions. `support.mjs` remained unchanged throughout these runs; it was also frozen while the other lane used shared setup.

## What the final probe establishes

The HTTP prerequisite setup creates actual approved masters, qualified location/bin, typed PO receipts, QC and stock, and a stored V1 producer. No database writes fabricate a happy-path receipt, material claim, consumption or output. The default producer yields two accepted and one rejected serialized component. The V2 consumer uses two actual company identities plus LOT 2.5, with ratios 1 and 1.25; its first operation records one good and one scrap. Exact per-output and process-loss mapping leads to one accepted terminal leaf in storage.

Independently authored assertions cover:

- Scoped discovery and accepted identities; foreign scope denial; extra catalog fields in the company branch; stale versions; fractional quantity, duplicate units and nonexistent unit refusal.
- Direct company hold rollback/retry/replay, dedicated hold permission revocation, held fresh-use refusal and unissued abandonment while held.
- Two HTTP claimants for the same unit: one durable winner, one conflict, no losing key, and reuse of the losing key for a distinct available unit.
- Dedicated reserve replay authorization with current execution head intact, missing or relabelled V1 while the durable V2 result survives. ISSUE repeats those checks with a body that has **no source-kind discriminator**, so the prior-result cohort is necessary.
- Actual abandoned raw holds excluded from consumed ancestry; actual consumed raw holds and malformed non-null hold caches block new use. Missing company projection, forged self-hashed opening identity and forbidden registry authority refuse reads.
- Outbox failure restores the entire domain state, including hidden dependency fences; the same failed key can then succeed once and replay exactly.
- Release/issue preserve physical company on-hand; first operation consumes selected identities once; subsequent operation does not consume producer raw material again. Producer opening/output/company evidence and raw physical counters remain unchanged.
- Incomplete attribution/loss blocks QC; exact good/loss mapping passes. Leaf stock is `UNVALUED`, physical on-hand 1, blocked 1, available/eligible 0, with no reserve/dispatch entitlement. Reuse is refused; self-rehashing a removed terminal marker does not upgrade it; the unsupported company source kind is refused by the shipment API.
- A second real producer fixture supplies three accepted units, leaving one free after two consumer claims. Real producer engineering withdrawal blocks a new claim, issue and first record; current physical quantities remain. Historical read and authorized exact ISSUE replay remain valid, while revoked company issue permission blocks replay.
- An actual new item revision moves the producer's component master to DRAFT; approving revision 2 still does not make its revision-1 stock eligible. Company reads report `ITEM_CHANGED` and preserve physical counts; fresh reserve and issue have exact no-effect refusals.
- Separate company-only consumers use their own qualified location/bin. A restored producer-bin `active:false` fault blocks source eligibility and fresh reserve/issue; exact restoration recovers eligibility and `canIssue`. The mounted producer-location deactivate command then makes the source location INACTIVE and again blocks both operations, with exact domain snapshots and unchanged producer physical evidence. No mounted bin-deactivation command exists, so only that bin authority case uses an explicitly restored database replacement. Authentic terminal item/location history remains until owned teardown rather than being rewound into approval.

The fixture/harness is shared infrastructure, and C's prerequisite setup helper is available to other lanes, including the browser journey. These are independent assertions, not a claim that all evidence uses independently implemented setup infrastructure. Final owner tests also have their own prerequisite fixture.

## Concurrency and snapshot boundaries

The simultaneous HTTP requests retain the application's actual authorization fences. Their winner/loser result does **not** prove that two requests passed authorization and read stock concurrently: shared authorization writes may serialize them.

The separate controlled case starts two snapshot sessions, reads the same company source version in both, and invokes the actual exported domain writer against two different already-valid consumer claims. The first pending write makes the second encounter a write conflict or version conflict at the shared company projection. **Both transactions abort**, and the full domain snapshot is byte-equal afterward. No authorization fence is removed. This is deterministic evidence of the common domain contention boundary, not two committed authorized requests or a throughput benchmark. Durable winner/key behavior is established separately over HTTP.

Rejected-command and rollback snapshots preserve all domain collections and hidden business/dependency fences. Entire authentication/control collections are excluded explicitly: `sessions`, `memberships`, `users`, `tenants`, `plants`, `legalEntities`, `credentials`, `ownedRun`. Thus the snapshot is not an assertion that failed authorization makes no authentication bookkeeping writes.

For successful downstream commands only, producer conservation permits the named raw receipt `catalogStockUseFence` to advance, requiring integer/nonnegative/monotonic values. It does not exempt physical quantities, public receipt fields, raw issue/consumption records, or immutable producer opening/output/company rows. Official raw hold/release changes are bounded separately; their legitimate receipt changes are not compared against a stale pre-hold physical snapshot.

## Conservative ancestry and unresolved gates

Inherited hold checks use the producing execution batch's actual `consumedReceiptIds` union. They exclude abandoned audit receipts, but do **not** narrow that union to the selected output's exact raw allocation subset. A receipt used by another accepted/rejected output in the producer batch can conservatively block a selected component. Actual chosen company identities and attribution hashes remain available for detailed traversal; no fine-grained descendant hold graph is claimed.

The final probe covers sequential hold-before-use and dependency-withdrawal-before-use ordering plus a controlled reservation-writer conflict. The item revision case also invalidates the consumer's frozen material demand: its fresh commands stop first at `INTERNAL_DEMAND_CHANGED`. The separate company read's `ITEM_CHANGED` proves current source display behavior, but this case is not an isolated proof that a fresh request reaches the company source guard. The source-location/bin cases remove the direct LOT confound and keep the consumer location valid, so their exact `COMPANY_DEPENDENCY_CHANGED` refusals isolate the company source dependency.

None of those cases proves a simultaneous authorized master/location revocation against source use. The final probe also does not independently exercise deterministic hold-vs-consume races, the positive 100-unit boundary, or every possible corrupted authority chain. Owner corruption tests and the maintained suite remain distinct evidence, not inferred C results.

No general graph/cycle/ancestor shipment-freeze acceptance, further manufactured generation, customer dispatch, replacement/rework, financial valuation, production deployment or capacity result follows from these fifteen entries. F5 remains blocked at its previous architecture/performance boundary; this work neither removes authorization fences nor reruns its benchmark. Native UI retry, keyboard, source navigation and viewport requirements remain parent/browser evidence.
