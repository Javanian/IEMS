# Domain owner report

Base: `9ad677a`. Scope: read-only company-unit trace and reverse affected-use evidence for the existing V1-to-V2 cohort. This is a P027/P029 precursor, not completion of K2B2-05/06.

## Implementation

`GET /api/company-stock/receipts/:id/units/:unitId/trace` requires the existing `company.stock.read` permission and reads one snapshot transaction. Nonempty GET bodies are rejected. The immutable company receipt/unit relationship is authoritative; a matching serial string, audit source-ID list or caller-supplied actor does not establish lineage.

The result separates exact selected-output raw allocation and serialized subsets from the conservative consumed producer-batch hold scope. It reports active reservation, issue, consumed-but-unattributed, output, process-loss and abandoned history as distinct categories. A selected V2 terminal unit can be traced upstream through its actual V1 component output without enabling reuse or dispatch. Output state and QC disposition are historical/current evidence, not a new stock eligibility or recall disposition.

The builder validates referenced execution, attribution, registry, stock, source, reservation and immutable issue/consumption evidence through existing providers. It uses an indexed selected-unit reservation query with an overflow sentinel. Full-result caps and the UTF-8 JSON envelope budget fail closed; no partial trace or paginated integrity decision is returned. GET does not call mutation guards, dependency fences, idempotency stores, audit writers or outbox writers.

Owned files: new `apps/portfolio-api/src/company-stock-trace.mjs`, the trace route/index hook in `company-stock.mjs`, `test/company-stock-trace.test.mjs`, and `test/support/company-stock-trace-owner-fixture.mjs`. The new owner fixture extends the previously accepted owner fixture with actual mounted-HTTP LOT/SERIAL procurement, receipt/QC, production and company putaway. It does not import Agent C's independent fixture or author happy-path database authority. The frozen technical wire is in `CONTRACT.md`.

## Verification

Owner attempt 1 command, from `apps/portfolio-api`:

```text
node --test --test-concurrency=1 --test-reporter=tap test/company-stock-trace.test.mjs
```

Result: **7 passed, 0 failed, 0 skipped, 0 cancelled; exit 0; 41.15 seconds**. One entry is the pure UTF-8 byte-boundary test; the mounted-HTTP parent contains five domain subtests. Cached MongoDB 7.0.14 ran as one disposable marked replica with the existing 0.25 GiB cache. Preflight required at least 2 GiB free RAM and no existing mongod. Owned cleanup completed and the heavy token was returned to the lead.

Raw evidence remains external under `D:/Project AI/GITHUB/IEMS-evidence/next-development-20261025/owner-trace-attempt1/`: `owner-company-stock-trace.tap`, `preflight.json` and `exit.json`. No raw log is committed here.

Proved in this owner run:

- Exact selected producer output uses two of six actual incoming serials; the remaining received serials are not substituted into its allocation.
- Abandoned raw history does not become selected-output ancestry or part of the consumed-batch hold set.
- Reserve, abandon/re-reserve, issue, consumed-unattributed, partial output attribution, explicit process loss, QC acceptance, stored descendant and terminal upstream trace remain distinct.
- Scope, actual unit/receipt mismatch, malformed UUID, dedicated read permission and nonempty GET body are rejected.
- Current holds preserve historical trace; orphan stock authority and corrupted immutable attribution are refused.
- All-collection snapshots, including session/membership and other authorization collections, remain byte-equal before and after successful and selected rejected reads.
- The response budget includes the `{data: ...}` envelope, accepts its exact byte boundary and rejects multibyte overflow based on UTF-8 bytes rather than JavaScript character count.

## Remaining gates and limits

Agent C owns the separate actual execution-count overflow fixture, independent corruption and no-write assertions. The owner byte-budget test is pure and does not claim a giant database fixture. Parent gates still include independent acceptance, maintained tests, frontend/build, native UI, source/import closure and publication. None is inferred from the seven owner entries.

This increment does not implement arbitrary-depth graph traversal, cycle mutation, replacement/rework, automated quality recall/NCR/CAPA, new holds, new customer item entitlement, customer shipment or F5 contention optimization. Existing stock policies and authorization fences remain unchanged.
