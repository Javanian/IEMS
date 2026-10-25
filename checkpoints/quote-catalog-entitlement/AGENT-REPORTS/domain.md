# Backend/domain report

Baseline: `23d2023`, isolated `quote-catalog-entitlement` worktree. Only this worktree was edited. No staging, commit, push, migration, or changes to the protected original master documents were performed by this lane.

## Implemented

- Opt-in `CATALOG_QUOTE_V1` on the real commercial quote routes, with explicit current approved V2 item/revision binding on every line. PURCHASED LOT/SERIAL and MANUFACTURED SERIAL are supported; schema-unset legacy manufactured revisions require a real V2 approval first.
- Server-captured immutable catalog source snapshots, historical source revision/event validation, exact approval/acceptance/native SO binding, and independent cohort evidence that rejects marker stripping.
- Keyed typed create/revise/approve/accept/convert. Replay reauthorizes, validates historical evidence, and preserves the committed result across ordinary master revision/withdrawal. Every fresh typed command reserves against existing legacy conversion keys. Self-rehashed command results are compared to the separately recorded event snapshot.
- Scoped indexed prefix selector and exact-ID hydration under `quote.read`. Current dependency eligibility is distinct from the frozen historical identity. Every fresh transition writes the actual item use fence inside the existing guarded transaction.
- Typed SO rejection before unsupported legacy reservation, engineering, work-order, shipment, invoice, and payment replay/mutation. Legacy unbound quote/inquiry and stock fulfillment remain separate supported paths.
- Existing quote documents validate typed historical authority. Technical `documentFence` remains outside quote semantic identity; financial document rendering remains the existing implementation. The renderer maps financial line fields and omits catalogBinding; PDF output is not a standalone catalog entitlement certificate.

Primary source: `apps/portfolio-api/src/quote-catalog.mjs`; integrations: commercial, catalog-option-index, documents, engineering, manufacturing, warehouse, fulfillment. No app action/role expansion was needed.

## Defaults and initialization impact

Omitting schema keeps the existing unbound quote/inquiry contract and result shape. This increment creates no catalog binding for historical quotes, inquiry lines, SOs, warehouse receipts, or outputs. Typed quotes deliberately reject any unbound line, historical schema-unset item revision, and unsupported legacy dispatch route. Commercial line wording is preserved independently of catalog descriptions. Existing exact integer/decimal money arithmetic is reused.

Initialization adds scoped unique indexes for typed quote events, keys and SO proof, plus a separate normalized quote-prefix index on the existing catalogOptionSearch collection. The existing projection builder now records quoteEligible independently of procurement eligibility. Existing master writers maintain it in their transaction; the existing startup projection rebuild rehydrates preexisting item projections using its real source-version/authority CAS and source use fence. That rebuild already existed: this increment does not add a second inventory scan or business adoption/migration. Projection refresh is technical cache maintenance and can advance technical fences; it does not approve an item, alter immutable item content, or create customer/stock entitlement. The separate index avoids broad case-insensitive residual search; the owner rare/absent query checks do not certify production-scale throughput.

## Owner evidence

Owner test `apps/portfolio-api/test/quote-catalog-entitlement.test.mjs` has nine children plus the parent (10 entries), with its own fixture functions. It does not import the independent QA fixture. Positive setup uses real authenticated HTTP APIs; direct writes are bounded corruption/injection tests restored in finally blocks. Successful replay permits exactly one increment of each actual session/membership/user/tenant/plant/legal-entity authorization fence and no other data change. Rejected commands still compare every collection exactly.

Command used by the lead:

```text
node --test --test-concurrency=1 apps/portfolio-api/test/quote-catalog-entitlement.test.mjs apps/portfolio-api/test/commercial.test.mjs apps/portfolio-api/test/wave4i-inquiries.test.mjs
```

- Attempt 1 failed in the external launcher before tests/Mongo because of command path quoting.
- Attempt 2: 24 passed / 2 failed out of 26 entries (the owner replay child and its parent). Actual differences were the required authorization fence increments; domain/master evidence did not change. The original failure log is retained.
- Attempt 3: 26/26 passed, exit 0, 36.062 seconds. This was before the final cross-cohort key namespace and malformed-result hardening.
- Attempt 4: owner plus legacy commercial/inquiry 26/26 passed, exit 0, 42.328 seconds (lead captured result). Independent attempt 1 failed on two replay comparisons because its structuredClone converted BSON Binary/Buffer prototypes after issuing a PDF; its original failure is retained. The independent helper was corrected to preserve exact BSON types and bytes.
- A later source correction makes replay eligibility describe the returned historical item binding when a newer quote revision binds another item. Both owner and independent tests now cover real R1 item A, R2 item B, and subsequent A withdrawal.
- Final candidate owner attempt 5 plus existing commercial/inquiry: 26/26 passed, exit 0, 32.688 seconds. Independent attempt 2: 15/15 passed, exit 0, 18.032 seconds. Lead confirmed zero remaining mongod processes after both. These results include the historical-result metadata correction and final namespace/type guards.
- The maintained API campaign is running under the lead's source-hash monitor. Frontend, build, normal browser, diagnostics and remote CI remain separate lead gates; consult STATUS/lead acceptance rather than treating these owner results as their completion.

External raw logs are held by the lead under the quote-catalog evidence directory and are not committed. Syntax checks and `git diff --check` passed for this lane. Parent owns actual Mongo/process cleanup and the final test campaign; this lane ran no heavy test processes.

## Limits

This is a P015 commercial identity prerequisite. It does not map inquiry source lines to catalog items, upgrade legacy quotes, implement direct stock dispatch, allocate company stock to customer demand, certify supplier identity, or complete K2B2-05/06. F5 authority contention remains blocked; no authority fences were removed or optimized.

100 lines, 50 quote revisions and the event bound are enforced source limits. Their largest combinations were not capacity-tested; repeated historical validation can be substantial. Event envelope recordedAt is diagnostic outside the semantic hash; approval/acceptance actor and time belong to the bound business snapshot. Runtime, browser, build, remote CI, performance and production claims remain limited to the lead's actual separate evidence.
