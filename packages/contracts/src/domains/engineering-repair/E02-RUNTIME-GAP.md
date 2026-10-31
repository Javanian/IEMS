# Historical canonical E02 runtime gap at19561749: INCOMPLETE

V7 source continuation is documented in [E02-V7-HANDOFF.md](E02-V7-HANDOFF.md). The clock/VAT corrections and typed domains are now written; current runtime verification stops at the admission source-pin prerequisite. The409 evidence below is historical, not the current source verdict.

Allocated base: `576a947d623ee12561d0a7819eb4bd3645021eba`. This is an implementation capability probe, not independent QA or a full-chain runner handoff.

`runE02Flow(h, { setClock, onCheckpoint })` in `apps/portfolio-api/test/support/review-e02-flow.mjs` reads the unchanged original E02 fixture. It uses the existing authenticated HTTP harness and returns actual prefix resources/manifest on `E02IncompleteError.flow`, with the rejected command/response on `.gap`. The callback receives sanitized milestones and UUID bindings. A returned manifest remains `INCOMPLETE`; callers must check it and must not interpret a returned value or a passing probe test as runtime acceptance.

## Reproduced blocker

The focused test builds an actual customer account, customer-owned non-inventory repair intake/custody, capped diagnostic authorization `1200.00 USD`, three teardown findings (REUSE/REPAIR/REPLACE), budgetary quotation revision1 and a genuinely approved revision2. Revision2 preserves the original five lines and exact `9000.00` net + `990.00` VAT = `9990.00` gross. Revision1 remains unchanged.

At fixture business time `2026-05-14T11:20:00.000Z`, the mounted request is:

```json
POST /api/repair/cases/<actual-case-UUID>/scope
{
  "expectedVersion": 3,
  "idempotencyKey": "<runtime-UUID>",
  "quoteId": "<actual-approved-quote-UUID>",
  "revision": 2,
  "depositRequired": "3000.00",
  "evidence": "KPC-APPRV-RPR-8812"
}
```

Actual result on 2026-10-31: HTTP409 `SCOPE_CONFLICT`. The case remains unchanged in TEARDOWN with no scopes. Commercial quote creation/revision/approval correctly accepts the original dates using `businessNow(runtime)`; repair scope instead compares the May28 expiry with `new Date()` in `apps/portfolio-api/src/repair.mjs:110`. The same wall-clock comparison appears in `decide` at line118. This is reproducible with the existing marker-protected business-clock constructor; no global clock patch is used.

## Additional source-backed gaps for CTO allocation

These observations are not downstream runtime proof; the first failure blocks those stages.

- `repair.mjs:111` explicitly rejects any scope tax policy except `NO_TAX`, including the approved canonical `FIXTURE_VAT_11_V1`. Fixing only the clock cannot make E02 pass. Do not replace the fixture tax policy or increase net to fake gross.
- Rejection at `repair.mjs:124` creates a NO_TAX diagnostic invoice from a single amount capped at1200. Canonical rejection requires net1200 + VAT132 = gross1332. Passing1332 as the diagnostic fee violates the cap and passing1200 does not prove the fixture invoice.
- `repair.mjs:184` return records only case custody/returnedAt. Fulfillment source types are WORK_ORDER/RESERVATION (`fulfillment.mjs:353`), and delivery source loading requires an actual `fulfillmentShipments` row (`delivery.mjs:82`). There is no source-backed customer-asset-return shipment/POD adapter exposed by these contracts. Do not make customer property inventory to obtain a shipment.
- Warranty (`repair.mjs:195`) starts at `returnedAt` and expires an integer number of days later; it has no invoice/repair-WO/POD reference or operating-hours field. Fixture return dispatch is May31, POD/start June2, expiry June2 2027 23:59:59, 12months/2500hours. An evidence string alone cannot establish those typed links or dates.
- Repair start/execution are case transitions; this API does not create/link the fixture repair sales/work orders. A separate arbitrary SO/WO must not be presented as authoritative linkage.

CTO on TPR-153 must allocate the bounded domain/return/billing contract corrections and an updated usable base. This continuation expressly excludes domain modules and admission/source/schema pins. Preserve canonical stock authority and the existing source-backed company/catalog owner helpers when assembly resumes. No replacement stock source has been prepared or consumed in this probe because scope is an earlier prerequisite.

## Checks and limits

From the assigned repair_quality worktree:

```powershell
$env:MONGOMS_SYSTEM_BINARY='C:/Users/Admin/.cache/mongodb-binaries/mongod-x64-win32-7.0.14.exe'
$env:MONGOMS_RUNTIME_DOWNLOAD='false'
node --check apps/portfolio-api/test/support/review-e02-flow.mjs
node --check apps/portfolio-api/test/review-e02-full-chain.test.mjs
node --test --test-concurrency=1 apps/portfolio-api/test/review-e02-full-chain.test.mjs
```

Syntax PASS exit0; bounded mounted Mongo/HTTP capability probe PASS1/1 exit0. PASS means the exact blocker and absence of fabricated downstream rows were reproduced. Full E02 runtime result **INCOMPLETE**. Deposit, actual replacement/quarantine, failed-test/rework/retest/QC, return shipment/POD, invoice/settlement, warranty and rejection variant **NOT_RUN**. No full regression/browser/security/independent QA.

Original fixture byte SHA256: `6baee7beb75983827bd40f0064618af35b41e96ea6eba4ef3cb68dfdaba49d48`, checked before and after. Only the standard owned harness seeds synthetic identity; helper mutations all use HTTP, no business-row seeding. The test uses a randomized marker-checked database, cached Mongo7.0.14, loopback ephemeral HTTP, automatic guarded cleanup, and no application environment credentials. No runtime/domain/fixture/manifest/pin edits or publication.
