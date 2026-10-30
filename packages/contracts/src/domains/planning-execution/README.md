# Manufacturing implementation contract

TPR-141, PLAT-011/012. Implementation handoff is incremental; independent QA remains TPR-150/152 after integration.

## Historical warehouse intake

`receipt-origin.mjs` exports `legacyReceiptPurchaseSource(db, order, lineIndex, documentRevision, session)`.
It reads the commercial owner's approved revision chain and returns `{line, purchaseSource}`.
New warehouse receipts and their RECEIVE movement pin `LEGACY_PURCHASE_RECEIPT_V2`, order ID, document revision,
stable line ID, line hash and approved revision hash. Unmarked historical receipts use revision 1.
Neither receipt nor movement hashes are rewritten. Typed catalog receipts remain a separate cohort.
Receiving writes the existing PO fence and gross received tally in the same transaction.

## Manufactured stock across generations

New `INTERNAL_EXECUTION_V2` putaway receipts have `sourcePolicy=MULTI_GENERATION_SOURCE`.
Existing V1 roots retain `ONE_HOP_SOURCE`; historical V2 `LEAF_ONLY` output stays terminal without migration.
No stock balance or movement ledger is duplicated. Existing company reservations, use events, issues,
consumptions and immutable output attribution remain authoritative.

`validateInternalExecution` recursively verifies producer events, approved engineering, immutable receipts,
serialized units, stock use and per-generation material conservation. A path cannot revisit an execution.
The traversal admits a shared upstream producer and caches validated nodes within one read, with at most
32 distinct executions and depth 32. Limit and cycle errors fail closed before any partial trace is returned.
Reservations require current source/use/unit revisions, owner/item/UOM match and transactional fences.
Each manufactured unit remains occupied by one reservation; complete attribution assigns it to one output
or explicit process loss, never both. New reservations reject a producer whose ancestry contains the consumer.

`companyStockContext` recursively checks current company holds, source demand, item and qualified location;
mutating callers fence every consumed ancestor in their transaction. Raw receipt ancestry is the union of
all consumed generations, not just direct raw inputs. Existing broad producer-batch hold policy is preserved.
`companySourceSnapshot` includes the complete raw ancestry only for the new reusable cohort, keeping old
snapshot hashes stable.

`COMPANY_UNIT_TRACE_V2` retains exact recursively attributed `companySources[]`, each with its own
`purchasedSources[]` and `companySources[]`. Existing trace paths and V1 output remain supported.
Trace reads preserve execution/receipt/output/reservation and 512 KiB response limits. Reverse uses remain
direct downstream candidates; following their resulting stock opens the next generation. No automatic recall,
dispatch entitlement or financial valuation is implied.

UI uses the existing IEMS navy/white/blue tokens and bundled typography. ENERGY 1 / RHYTHM 1 / MOTION 1.
Native disclosure shows component ancestry on demand so deep graphs do not force every level open at once.
Existing state, focus and permission-aware links are retained. No shared shell, routing, manifest or schema delta.

## Remaining assignment work

General manufactured installation graph mutation/freeze integration, shortage API adoption/customer demand
adapter, F5 contention review and reporting producer coverage are not completed by these two features.
Do not mark PLAT-011/012 fully implemented from this partial handoff. The shortage producer is owned by
commercial; proposed customer demand dispatch is recorded on TPR-153 for the CTO allocation decision.

Checks: `node --test packages/contracts/src/domains/planning-execution/*.test.mjs`, API syntax and web build.
Pure tests cover historical receipt preservation/tampering, DAG sharing/cycle/limit behavior, serialized
unique-parent/loss conservation and operator selection. They do not prove real DB races, rollback or full QA.
