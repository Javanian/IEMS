# Independent QA — company unit trace

Base: `9ad677a3fabedbe2005cdb2fefbc8d0e7d8ee140`. Scope: the frozen read-only V1-to-V2 company unit trace contract. C owns the new QA files and this report, with no production implementation, commit or push.

## Actual execution

From the repository root:

```text
node --test --test-concurrency=1 --test-reporter=tap checkpoints/company-stock-trace/qa/company-stock-trace.test.mjs
```

**Independent trace attempt 1: PASS 9/9, exit 0, no failures, skips or cancellations, 135.830 seconds.** This is seven HTTP child cases, their parent, and a separate pure UTF-8 envelope-boundary case. The phase assertions also run during the actual HTTP fixture construction. No failed independent runtime attempt preceded this result.

Started 2026-10-25 12:11:10.528 UTC; finished 12:13:26.470 UTC. Preflight measured 4.381 GiB free RAM, CPU load 42%, and 0 mongod processes. The unchanged resource floor was 2 GiB. The marked disposable replica used cached MongoDB 7.0.14 and a 0.25 GiB WiredTiger cache; Node was 24.19.0. No unrelated process was stopped.

All **45 captured source hashes matched before/after**, covering portfolio API source, tenant foundation, the new QA, and the reused CSU QA helper sources. This bounded manifest excludes UI and is not a whole-repository or dependency-install attestation. Cleanup confirmed **0 mongod** and the heavy token was explicitly released before this report. The raw run contains no teardown ECONNRESET.

External immutable evidence: `next-development-20261025/independent-trace-attempt1/`, containing `independent-company-stock-trace.tap`, `preflight.json`, `exit.json`, `source-before.json`, `source-after.json` and `cleanup.json`. Raw TAP and database/browser artifacts are not committed. A prior syntax check passed; the isolated pure envelope test also passed before this full run and did not start Mongo.

## Fixture and trace assertions

`qa/support.mjs` reuses the unchanged CSU prerequisite helper through a repository-relative import. That helper creates approved masters, qualified location/bin, actual typed receipts, incoming QC/putaway, and a real purchased-input V1 producer with accepted2/rejected1. The new helper then creates a real V2 target2 job with company ratio1 plus purchased LOT ratio1.25. It reserves, abandons, reclaims, releases, issues, records good1/scrap1, allocates exact output/loss inputs, performs QC and stores the accepted leaf. There are no database writes fabricating happy-path authority. The setup helper is available to the browser lane; shared setup is disclosed rather than presented as independent infrastructure in every lane. Owner tests use their separate fixture.

Phase callbacks asserted actual trace data at AVAILABLE, RESERVED, ABANDONED, ISSUED, CONSUMED_UNATTRIBUTED, OUTPUT_UNREVIEWED, LOSS_RECORDED, QC_ACCEPTED and STORED. They establish:

- Each company identity maps to its actual producer output UUID and serial. Its purchased SERIAL attribution is exactly two of the six received/consumed serials; its LOT contribution is exactly 1.25. The rejected producer output's distinct raw serials are not assigned to accepted company units.
- Hold policy remains the conservative consumed producer-batch receipt set. Abandoned raw history is absent from physical ancestry and the hold set. This fixture demonstrates exact serial subsets versus whole-receipt hold scope; it does not demonstrate different raw-receipt sets for sibling outputs.
- A released claim appears in abandoned history, and the later active claim retains its own reservation identity. RESERVED and ISSUED remain distinct from physical consumption. A consumed identity without output/loss mapping is explicitly unattributed.
- One selected company unit becomes the downstream output, while the other is process loss. Loss never invents an output or company receipt. QC-unreviewed, accepted, rejected and stored states retain their distinct evidence and nullable company stock pointers.
- The terminal leaf has its direct purchased LOT source plus only the selected upstream company output and that output's raw serial subset. Its hold-policy union is broader than its exact output allocation. `LEAF_ONLY` remains blocked for reuse; trace does not grant dispatch permission.
- A separate actual QC-rejected consumer fixture has a REJECTED output with no fabricated company receipt/unit, while the other company identity remains process loss.

## Authorization, current state and corrupt evidence

An actor with only `companyStockReader` can use the new endpoint, without internal execution read permission. Removing that company grant produces 403. Foreign scope, missing unit and receipt/unit mismatch produce 404; malformed UUID produces 400. Error results contain no partial `data`.

An actual direct company hold leaves ancestry and use history byte-equal while current blockers change. A real new component-master revision similarly preserves historical trace and reports `ITEM_CHANGED`. These are historical read checks, not proof that held or withdrawn stock can be used. No fresh source-use permission is inferred from a downstream QC label.

Restored test-only faults remove the actual current company reservation while its reverse authority survives, or replace an immutable producer unit with a self-rehashed forged output pointer. They refuse the source trace; the forged producer pointer also refuses the terminal leaf's upstream trace. Documents are restored in `finally`, and the valid trace then succeeds. This is bounded orphan/self-hash corruption coverage, not a claim to exhaust every coherent authority-chain corruption.

Every tested successful and rejected trace GET snapshots **all collection names and documents**, including authentication, authorization records, keys, audit/outbox and all hidden domain/use fences. There are no collection exclusions or fence masks. Before/after snapshots match exactly. Collection options/index metadata and Mongo server internals are not runtime-diffed. Static source review separately confirms that the new index is created during initialization, while the endpoint and trace builder perform reads without dependency/write-fence calls.

## Genuine limits and their boundary

The execution-cap fixture creates actual mounted plans, engineering approvals, V2 jobs and company reservations. Each job reserves and abandons the same real company unit; it does not issue direct purchased stock or fabricate history rows. At root producer plus 31 distinct consumer jobs, trace returns HTTP200, complete=true, 32 executions and 31 abandoned uses. After the 32nd consumer, total executions become 33: HTTP409 `TRACE_LIMIT_EXCEEDED`, no partial data, and the full database snapshot remains unchanged. The limit child took 75.872 seconds; this is a correctness test, not a capacity benchmark.

The separate pure case invokes the actual final response guard with an exact 512 KiB serialized `{data: ...}` envelope containing multibyte text. Equality passes and one additional UTF-8 byte fails. This proves byte accounting at the exported guard; it is not an enormous HTTP fixture. The other company/raw/output/use-reference caps are not independently driven to their HTTP boundaries here. Existing validators retain their constituent limits; result caps do not establish a total database-operation, memory, latency or production-capacity budget.

## Static source review and acceptance limits

The trace builder obtains raw links from actual CONSUMED reservations, checks the validated catalog origin hash and preserves allocation quantity/serial subsets with their real consumption pointers. Existing validators verify ledger/projection/head hashes and per-output/loss reconciliation. V2 upstream traversal explicitly accepts only V1 `ONE_HOP_SOURCE`; reverse uses must match the actual consumer reservation proof. Query scope and the hinted selected-unit index remain explicit, and new discovery limits use an overflow sentinel.

No new concrete production defect was identified in the final read-only review. `completeness.counts.rawReceipts` includes validated audit sources, including abandoned history checked by the validators; it must not be described as a physical-consumption count. The response's exact ancestry and conservative physical hold set are separate.

This accepts a bounded lookup for the current cohort, not K2B2-05/06 general graph mutation, arbitrary generations, cycle enforcement, recall disposition, replacement or customer dispatch. P015 commercial inventory entitlement and P031 company-stock fulfillment remain separate dependencies. There is no new performance acceptance, F5 optimization, production cutover, PostgreSQL migration or hardware claim. Parent-owned native UI, maintained regression, build, publication and exact-head CI are separate gates.

The prior CI observability finding is also separate from trace correctness: the historical runner collected `networkFailures` in local failure diagnostics, but its console result omitted them and its old workflow did not upload those artifacts. That unavailable evidence cannot establish the cause of the prior request failure; later teardown ECONNRESET is not proof of an earlier transport cause. Improvements to future diagnostic retention do not retroactively repair that evidence gap.
