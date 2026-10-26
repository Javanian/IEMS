# Backend report: company-stock readiness

Current lead verification: maintained API292/292 includes all7 owner GREEN entries, and independent boundary2 passed5/5 with225 unchanged source hashes and mongod* cleanup0. Final frontend196, syntax, build2 and focused native2 eight checks passed; exact-head publication remains separate. Agent A's authoring and pre-runtime handoff below are retained. Worktree company-stock-readiness starts at23d2023; original purchased-stock-fulfillment backend remains idle and unchanged by this lane.

## Cause and bounded correction

The company stock writer accepts at most100 retained reservation references and500 source-use events, with virtual version1 and last writable version500 advancing to501. The old reader used dependency blockers and physical available stock only. It could therefore present a new reservation as available after the claim or event budget had been exhausted.

The new dependency-free company-stock-capacity helper supplies the unchanged numeric limits and capacity projection to the reader and saveUse. The state validator imports the same reservation/event limits without changing authority or ledger rules. Opening-unit limits remain separate physical bounds.

The view adds reserveBlockers and capacity, plus canHold/canReleaseHold. Claim exhaustion contributes RESERVATION_HISTORY_LIMIT only to reserveBlockers; source event exhaustion contributes STOCK_EVENT_HISTORY_LIMIT. Existing dependency blockers, units eligibility, eligibleQuantity and physical quantities remain unchanged. count100 does not reject an update to an existing claim or a hold change; the writer still rejects only a post-mutation count above100. Holds use their own state and the remaining event budget, independently of stock eligibility and claim-count capacity. No authorization, source-proof, ledger, quantity or cohort guard was removed.

## Real boundary reproduction

Root-owned owner RED attempt1 on the untouched production source completed in410.406 seconds, exit1: seven entries, one pass and six failures including the parent. All224 API-scope hashes were unchanged and teardown left zero owned mongod processes. This was expected RED evidence, not accepted feature verification.

The owner fixture uses real authenticated APIs for master data, procurement, receiving, QC/putaway, producer operations/attribution, approved internal demand and actual company stock. It reuses the earlier owner prerequisite helper, not the independent QA fixture. No scalar source-version spoof or fabricated happy-path history is used.

- Five actual V2 jobs, each with no more than20 claims, create99 released claims and the actual100th active claim. At count100, available and physically eligible quantity are both1, while the old canReserve is true. A direct101st reservation is rejected with STOCK_HISTORY_LIMIT and every collection, including authorization fences, unchanged.
- At count100, real hold, unissued abandonment and hold release still succeed. Physical stock returns to its opening2 units; exact opening receipt/unit/output evidence stays unchanged. Real read-only trace reports100 abandoned references and complete evidence before the old canReserve assertion fails.
- A separate real producer supplies three accepted units.249 hold/release pairs create498 events/version499; one real reservation reaches version500 without a hold and with2 units available. A second real job reserves another unit, reaching500 real events/version501, still without a hold and with1 unit physically available. The old reader again incorrectly says canReserve=true.
- At version501, a new reservation, abandonment of an existing live claim and a new hold are all refused by the existing writer with STOCK_HISTORY_LIMIT and full rollback. Historical trace still succeeds. Exact acknowledged replay advances only the six current authorization crmFence fields by2 for its two guards; dedicated-role revocation denies replay with no durable effects.

## Transition costs and residual recovery limit

New reservation, abandonment, hold and hold release each append one source event. Issue and first-operation consumption append one per affected company claim; execution release and later operation records do not append another source event. Exact replay appends none. An execution command with multiple source claims may therefore cost more than one event; a UI boolean is not a reservation for future lifecycle capacity.

Immediate one-event reserve readiness remains true at version500 if stock/dependencies/count allow it, matching the existing writer. The resulting version501 cannot append a later issue, abandonment or hold event. The real fixture demonstrates this recovery stranding. This correction neither increases that hard cap nor promises a recovery route beyond it; a separately authorized lifecycle/rework policy would be needed to change that boundary.

## Verification and limits

Before the final runtime freeze, node --check passed the three production files and two new owner files; direct import of app.mjs passed, and git diff --check reported no whitespace errors. No Mongo, browser, benchmark or build was started by Agent A. Lead runs the maintained suite containing the owner test, then independent QA and UI/browser acceptance. Those results must be recorded before publication is accepted.

This is the one-generation company-source readiness correction. V2 remains LEAF_ONLY, manufactured customer dispatch and general graph are excluded, and F5 remains BLOCKED. F5-A preparation exists externally only; no candidate replaces either production fence protocol. Agent A performed no staging, commit, push, merge or deployment.
