# Company-stock reservation readiness

The real API reproduction confirmed the inherited P2 mismatch before production edits. At100 retained claims and positive available stock the old reader returned canReserve=true, while claim101 was refused atomically. After all100 claims were released and the complete bounded trace remained readable, readiness still returned true. A separate valid source reached version501 through actual commands, retained positive available stock and again reported true despite rejecting another source write. No scalar source-version substitution created these boundaries.

## Correction and transition budget

company-stock-capacity.mjs defines the unchanged100-reference and500-event caps. The reader, writer and source validator use those constants. The reader adds reservation capacity separately from dependency blockers, physical quantities and unit eligibility; canReserve now includes the immediate command budget. reserveBlockers explains claim exhaustion and event exhaustion separately. canHold/canReleaseHold use their own hold state and one-event budget, so claim count100 does not disable otherwise legal hold or release commands.

The writer still accepts a post-mutation count100 and rejects101. A one-event operation at version500 may advance to501; another source event is refused. A reservation, abandonment or hold change costs one event for its affected source claim; issue/first consumption may affect several claims. Work-order release, later operations and exact replay do not consume another company-source event. Readiness does not reserve future lifecycle headroom.

All original stock arithmetic, opening evidence, V1/V2 identity, source/location/item checks, authorization writes, transactional rollback and retained-key rules remain in place. V2 output stays LEAF_ONLY. The UI shows an English operational reason and actual balances. Exact capacity counters and transition details remain inside Audit details.

## Actual local evidence

| Gate | Observation |
| --- | --- |
| Pre-fix owner RED1 |7 entries:1 PASS,6 FAIL including parent;410.406s;224 API-scope hashes unchanged. Count100 and version501 assertions reproduced true!=false after valid ledger assertions. Direct101 refusal, full rollback, replay/revocation and historical trace also executed |
| Maintained API GREEN1 |292/292, zero fail/skip/cancel,1510.703s;225 API-scope hashes unchanged. Includes all7 new owner entries; no redundant separate owner rerun |
| Lead frontend |Final refinement196/196, zero fail/skip/cancel,5.703s; syntax also PASS |
| Independent boundary and old company-use/trace |Fresh boundary2:5/5,0fail/skip/cancel,1196.453s,225 hashes unchanged, cleanup0. Old trace9/use15 passed in the earlier attempt;224 other source files are identical. The earlier combined attempt remains failed by its outer timeout, not relabeled29/29 |
| Native exhausted-readiness regression |Final build PASS22.234s with315 unchanged web hashes; focused native2 PASS8/0application exceptions/0console errors,423.515s,796 unchanged hashes,cleanup0. Lead inspected actual exhausted PNGs360/768/1440. Disabled reserve is persisted DOM proof; initial201/final203 and stock2 are recorded, while held202/trace100 are frozen-harness assertions. This is not normal20 acceptance |

Raw evidence is indexed in [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md). Source before/after maps, complete output and cleanup are external. Native1 passed before pixel review identified a misleading secondary stale/blocked warning on the otherwise current capacity-exhausted source. Only its render condition changed; frontend/build/native were rerun. Native2 retains a nonfatal Mongo teardown reset, with actual exit0 and cleanup0. Initial runner metadata used an exact process-name query; an explicit mongod* inventory corroborated cleanup and all subsequent preflights detect the versioned binary. Resource floors are unchanged.

## Separate recovery finding

The existing hard event cap can strand an already reserved claim: reserve at500 is legal, but issue or abandonment at501 is refused. The owner fixture executes this case with1 unit still available and2 live claims on a3-unit source. That limitation is not fixed by changing readiness and no capacity increase or recovery policy was introduced. Independent QA additionally exercises source-event-free work-order release followed by refused issue. Hold recovery beyond the same cap is source-derived unless explicitly exercised by a listed test.

This correction is bounded reservation readiness, not general graph, manufactured customer dispatch, maximum-load performance or F5 acceptance. F1–F4 keep their earlier VERIFIED scope. Publication and exact-head CI remain separate gates.
