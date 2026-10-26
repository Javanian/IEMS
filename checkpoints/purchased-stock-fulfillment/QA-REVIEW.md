# Independent QA: purchased stock fulfillment

Status: final independent HTTP/domain-CAS gate PASS. Broader maintained API, native browser and publication/CI acceptance remain separate lead gates. Baseline `692463a7` does not attest this increment. Earlier attempts are retained separately below.

The independent fixture creates actual approved PURCHASED LOT and SERIAL masters, real procurement entitlement and arrivals, an explicit accepted/rejected serial inspection, qualified putaway, and a catalog-bound quote/SO through mounted HTTP routes. It does not create manufacturing output to represent purchased goods. The owned replica harness and prior generic full-snapshot/refusal utilities are reused; the new business setup and assertions are authored in this lane. Native browser prerequisites may share this setup, which is not a third independent fixture implementation.

## Threat boundaries

- Production and customer claims must validate one common stock head, receipt CAS, reservation history and serial occupancy. A customer demand head enforces the separate SO-line cap across receipts; it must not become another availability ledger.
- Partial dispatch permanently removes shipped quantity and identities. Release under hold or dependency withdrawal releases only the remaining unshipped part. Opening origin, QC, putaway, catalog units, warehouse movements and physical quantity counters remain unchanged.
- Fresh reserve/dispatch rechecks current item, owner, hold, location and bin. Coherent historical POD, invoice and settlement remain usable after withdrawal; a stored hash or idempotency key alone cannot authorize corrupted history.
- Durable typed proof must identify customer custody and money even after public markers or heads are missing. Recomputed hashes do not replace independent source/consumer/shipment/payment binding.
- Rejection snapshots include every actual collection and authorization/source fences. Successful exact replay permits only the known route's exact number of `crmFence` increments on the six current authority rows; all business fields, BSON types and bytes stay exact. GET must change nothing.
- An authorized HTTP winner proves durable exclusion. It does not prove source-level concurrent overlap because the common authorization guard can serialize HTTP transactions. A separately controlled test must use actual domain writers/contexts in two sessions, observe the real common receipt/head conflict, abort both, and prove the complete database is unchanged. It cannot remove or bypass production authorization and then claim HTTP throughput.

## Planned execution and limits

The authored suite has fourteen children plus its parent (fifteen test entries). It covers exact LOT millionths, real/rejected/duplicate SERIAL selections, line and scope authority, immutable opening evidence, reserve/partial ship/held release, cross-receipt SO and invoice caps, marginal rounding, historical POD/payment and document preparation, revoked replay, source/key/head/settlement corruption, outbox rollback, source location/bin withdrawal, and production/customer competition. The final candidate adds actual typed shipment reconciliation and three separately restored billing-summary faults: per-shipment only, per-SO-line only, and both summaries reset. Fresh duplicate billing, exact replay and billing reads must refuse inconsistent summaries without any additional durable effect.

Two controlled source cases use actual exported domain writers: distinct authentic production/customer claim releases on an existing shared source, and two endpoint-built customer claims on a virgin source. Each loads two real snapshot contexts without fresh-use fence writes, keeps the first write uncommitted, requires a Mongo112 common-source conflict from the second, aborts both, and compares every collection. The virgin case imports the actual endpoint's row builder, so it independently checks writer exclusion and rollback rather than independently implementing reservation construction. It does not prove two complete HTTP transactions overlap or accept a committed orphan consumer reference.

The raw-bin inactive case is an explicitly restored authority fault; location deactivation and item withdrawal use mounted commands. They prove sequential invalidation, not simultaneous revocation ordering. History/count/byte-bound caps and every possible race permutation are not yet independently executed or certified. Successful PDF assertions, if they pass, concern the existing financial/delivery renderer, not catalog-identity certification.

This is a PURCHASED-only adapter. Manufactured customer dispatch, general genealogy/cycles, cross-plant ownership, UOM conversion, amendments/returns and safe authorization performance optimization remain outside its proof. F5 stays BLOCKED.

## Retained execution history

The lead ran each attempt on a marker-owned disposable replica, after a fresh resource check, with source capture and teardown evidence outside Git.

| Attempt | Actual result | Interpretation |
| --- | --- | --- |
| Independent1 | 15/15 PASS, exit0, 90.531s command elapsed, zero skips/cancellations; 53 captured runtime files unchanged; 0 mongod after teardown | Earlier source before the billing aggregate/reconciliation/cap refinements. Both actual domain-conflict cases returned Mongo112 and their full rollback assertions passed. This is not final-source acceptance. |
| Independent2 | 11 PASS / 4 FAIL including parent, exit1, 59.796s; 131 campaign source files unchanged; 0 mongod after teardown | Two primary fixture-selection failures and one dependent reconciliation failure. UUID/index order caused `.at(-1)` to pick a previously shipped or released reservation rather than the new one; the missing fourth shipment then made the strict reconciliation count fail. The financial-summary corruption child and both source-CAS cases passed, but the whole candidate was not accepted. |
| Independent3 | 15/15 PASS, exit0, 58.375s command elapsed (58.306s TAP), zero skips/cancellations; preflight3.619GiB / 0 mongod; 0 mongod after teardown | Final independent candidate. All three separately restored billing-summary faults, exact four-shipment reconciliation, fractional marginal rounding, real location/bin withdrawal, historical POD/payment/PDF, revoked replay and both actual Mongo112 source conflicts executed successfully. Broader campaign source capture remains under the lead's freeze through the maintained suite. |

The test-only correction identifies every new claim by the immutable `commandReceipt.reservationId` and additionally checks its receipt, version and content hash. It preserves all quantity caps, the expected four shipments/movements, financial-summary refusals, hold assertions and full rollback snapshots. No business implementation was changed to accommodate those fixture failures. Final rerun source is `qa/purchased-stock-fulfillment.test.mjs` SHA256 `c98a30a10802d995f836c6f7c41ac00e1a7baf41eb2971c4838d6b3dd93a541a`.

The separate owner/targeted gate first failed its immutable rejected-unit status expectation (`REJECTED` versus actual `REJECTED_QUARANTINE`) and a dependent lookup. Its test-only correction then passed43/43. Those owner assertions and fixture are separate from this lane; they do not replace independent final rerun evidence. Raw nonfatal Mongo teardown `ECONNRESET` output in that owner gate remains retained. Neither independent1 nor independent2 raw log contains that warning.

## Source review dispositions

Before independent1, review identified a retained financial-result bypass: an altered invoice/payment result ID could produce a false untyped lookup and still return the stored result. The provider now identifies typed proof by the original key, requires the correct typed result identity/hash and refuses a missing proof. A separately stripped invoice marker/proof cannot fall through to unvalidated document preparation. The final suite executes those restored corruption cases.

After independent1, review identified that lowering mutable billing summaries could reopen already invoiced shipment capacity. The provider now reconciles actual invoice/key/proof/payment sets and both shipment/SO billing summaries before fresh invoice commands and relevant reads/replays. The independent final suite lowers each summary alone and both together, requires409 `PURCHASED_FULFILLMENT_SOURCE_INVALID`, checks the entire database unchanged after each refusal, then restores every test-only change in `finally`.

Source history and consumer history readiness flags were aligned with their hard write limits in the final provider. This alignment is a static review finding, not an executed400-event/100-payment capacity campaign. The executed cap assertions concern actual SO quantities, source quantities and already invoiced shipment quantities. No measured throughput or general revocation/source race certification is inferred from this small disposable fixture.

Evidence names are external: `independent-attempt1.*`, `independent-attempt2.*`, `independent-attempt3.*`, their cleanup/environment files and lead campaign source captures. No raw logs or database files are committed with this report. The final run command is `node --test --test-concurrency=1 checkpoints/purchased-stock-fulfillment/qa/purchased-stock-fulfillment.test.mjs`.
