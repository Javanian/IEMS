# Independent QA: quote catalog entitlement

Status: independent API probe accepted on the final captured API candidate. Browser, full maintained regression, publication, and remote CI results are owned by the lead and are not established by this report.

The independent HTTP fixture uses the existing marker-owned Mongo/server/session harness. Item and account prerequisites are created through mounted HTTP commands. The new business assertions are independently authored; sharing this prerequisite fixture with the native journey is setup reuse, not separate fixture implementation evidence.

## Required boundaries

- An explicit binding identifies one scoped, company-owned catalog item and approved immutable revision. Description, UOM, inquiry drawing metadata, and serial-looking text cannot establish a binding.
- Fresh create, revision, approval, acceptance, and conversion validate current item eligibility and contend on real source authority documents. An historical snapshot remains readable when its source is later withdrawn; historical validity does not grant fresh eligibility.
- Typed classification survives deletion or relabeling of a mutable quote head. Revision, approval, conversion key, and sales-order evidence must agree. A corrupted stored proof must not become eligible merely by recomputing its own hash.
- Inquiry quantity, UOM, source description, and provenance stay frozen. Catalog selection cannot rewrite inquiry-owned values or infer mapping from them.
- Scope, legal owner, UOM, tracking policy, exact positive quantity, and item revision/version are checked independently. SERIAL quantities are integral. Monetary calculations retain existing exact-string and rounding behavior.
- Conversion authorization precedes idempotency replay. Replay returns the original coherent stored result, without creating a new source use or silently upgrading a source revision. Revoked permission and corrupted historical proof cannot return success.
- Refused or rolled-back commands leave every durable collection unchanged, including hidden source and authorization fences. Successful fresh commands may legitimately advance technical authority fences; immutable source business fields and downstream stock/financial entitlements stay unchanged.
- This increment creates commercial item entitlement only. It does not allocate, dispatch, consume stock, authorize manufactured graph reuse, or retrospectively bind legacy quotes/orders.
- Existing warehouse reservation, customer engineering, work-order planning, shipment, and invoice writers must reject typed customer orders until their item-aware entitlement slice exists. UOM or description equality is insufficient. Removing a mutable schema or line marker must not reopen these legacy routes.

## Executed independent probes

1. Actual HTTP LOT and SERIAL quote lifecycle, exact approval and sales-order binding, inquiry provenance, and unchanged stock/execution collections.
2. Forged snapshot/scope/owner/UOM/tracking, foreign and draft items, absent or partial binding, mixed cohort, and fractional SERIAL negatives.
3. Current master revision or deactivation at each fresh transition, historical read, and authorized original-key replay; exact no-effect assertions on rejection.
4. Stored revision, approval, key, and sales-order corruption with restoration in `finally`, including mutable-head deletion/relabel and coherent self-hash attempts where the actual proof design supports a meaningful test.
5. Actual outbox-write failure after conversion effects begin, full rollback, and same-key retry after restoring the injected storage fault.
6. Competing conversions with distinct keys: one winner, one refusal, one order/key/audit/outbox effect. This is an HTTP result test; common authorization writes may serialize transactions, so it does not prove unrestricted domain overlap.
7. Typed orders denied at reachable legacy stock/execution/dispatch/billing writers, with unchanged full snapshots. A separately created unbound legacy order follows its supported path successfully; no old order is rebound by textual similarity.

The probe contains 14 children plus their parent: **15 test entries**. Mounted HTTP commands create the catalog masters, quotes, inquiry, approvals, sales orders, legacy procurement receipt, shipment, invoice, and payment. Direct database changes are restricted to explicitly restored negative corruption/permission fixtures and the injected outbox fault.

Additional cases check the shared legacy/typed conversion-key namespace, a real legacy invoice temporarily retargeted to a typed order before fresh payment and acknowledged payment replay, and the historical metadata distinction between R1 bound to item A and R2 rebound to B. After actual withdrawal of A, the current B quote remains eligible while original create and R1 approval replays retain A and report it ineligible.

## Evidence and attempts

Run from the repository root:

```sh
node --test --test-concurrency=1 checkpoints/quote-catalog-entitlement/qa/quote-catalog-entitlement.test.mjs
```

The lead executed the runs serially on marker-owned disposable MongoDB. The independent reviewer inspected their raw output and exit/cleanup files; the reviewer did not launch another replica or browser.

| Attempt | Actual result | Disposition |
| --- | --- | --- |
| `independent-attempt1` | Exit 1; 12 passed, 3 failed, including the parent; 17.437 seconds wall time; no skips/cancellations; zero owned Mongo processes afterward | Two children failed because `structuredClone` changed stored PDF BSON Binary/Buffer prototypes in the expected snapshot. The failed output is retained. |
| `independent-attempt2` | Exit 0; 15/15 passed; 18.032 seconds wall time; no skips/cancellations; zero owned Mongo processes afterward | Expected snapshots preserve original BSON types and bytes. This candidate also includes the independently requested R1-A/R2-B replay metadata case and its provider correction. |

Each attempt retains one nonfatal `MongoNetworkError: read ECONNRESET` diagnostic block. Neither block is filtered from the evidence. The final raw TAP duration is 17,943.1916 ms; wall time comes from the separate run record.

Raw evidence is external: `independent-attempt{1,2}.log`, matching run JSON and cleanup JSON, and `api-campaign-attempt2-source-before.json`. A read-only comparison after attempt 2 matched all 92 captured API/QA files to that final campaign capture. This is a bounded source capture, not a whole-repository or later-maintained-suite attestation.

## Snapshot and race boundaries

Refused commands, injected conversion rollback, and read-only catalog/quote/order probes compare every durable collection without removing authorization collections or hidden source fences. Successful replay is different: it must advance `crmFence` by exactly one on the current session, membership, user, tenant, plant, and legal entity only. The session is selected by the actual cookie token hash; every target must match exactly one row. All other fields and rows, including master `useFence`, PDF BSON types/bytes, stock, financial, and commercial effects, remain strictly equal. The expected object is a private fresh database snapshot; no BSON normalization or blanket fence stripping is used.

The simultaneous distinct-key conversion probe proves one HTTP winner, one refusal, and one order/key/audit/outbox effect. Existing common authorization writes can serialize those transactions. It does not prove independent domain overlap, deterministic revocation ordering, throughput, a new concurrency architecture, or an F5 optimization.

## Review findings closed before acceptance

- Historical typed command results are anchored to independently recorded event snapshots and command identity, rather than trusting a recomputed result self-hash alone. Malformed/null results and malformed stripped heads refuse with `QUOTE_SOURCE_INVALID`.
- Fresh typed keys cannot take over an existing legacy conversion key; original acknowledged legacy conversion replay remains valid.
- Historical replay readiness describes the actual returned historical binding rather than a later revision's replacement item.
- Typed orders fail closed at legacy reservation, engineering, planning, shipment, invoicing, and payment entry points, including the restored retargeted-invoice negative. Valid unbound legacy reserve, shipment, invoice, and payment still execute.
- Typed quote document source/issuance validates historical commercial authority; corruption rolls back document fencing. This API proof does not certify that the PDF visibly prints catalog identity fields.

These checks establish the bounded direct-quote identity slice. Inquiry quotes remain unbound with their existing provenance, old records are not inferred or migrated, and no stock allocation, dispatch entitlement, general manufactured graph, external acceptance signature, statutory tax, production deployment, or performance acceptance is claimed.
