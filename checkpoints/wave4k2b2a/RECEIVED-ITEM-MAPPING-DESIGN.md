# Received stock to approved item revision mapping

Status: **DRAFT, NOT FROZEN, NOT IMPLEMENTED**. Documentation proposal, 2026-10-25. This is a prerequisite to future internal execution, not evidence that internal stock production or a provider integration exists. Current K2b2a creates master/planning evidence only. Canonical E01 remains unchanged.

## Current gap and chosen direction

Current procurement lines contain description, quantity, UOM, price and currency. Receipt checks bind a real PO/vendor/line/UOM/version and quantity entitlement, but do not establish an approved inventory item revision. Current master item content contains description/UOM/kind and has no tracking policy. Neither matching text nor a matching UOM proves item equivalence, ownership or whether incoming identities must be serialized.

Use a NEW typed procurement cohort from request approval through issued PO and actual receipt. Do not attach an item label to an already consumed receipt and call it authoritative. Existing legacy request/PO/receipt schemas and their accepted workflows remain intact; missing or malformed new cohort markers must never silently fall back to legacy behavior.

The smallest useful next increment is approved tracking policy plus typed request/PO identity and quarantine-only receipt mapping. Internal execution, available-stock issuance and manufactured-child installation remain blocked until their source adapters and stock guards are separately accepted. This keeps the new identity boundary concrete without treating planned material demand as actual inventory.

## Prerequisite: approved tracking policy

Introduce a versioned inventory-item content schema, proposed INVENTORY_ITEM_V2, with an explicit immutable revision field `trackingPolicy: LOT | SERIAL`. The policy must be recorded in a NEW revision and independently approved through the current master authority/event/revision checks. Never add a default policy to an existing approved revision. A V1 item revision without policy is not eligible for the typed procurement cohort; no inference from code, kind, UOM, quantity or an existing receipt.serials array.

LOT permits exact quantity in the approved source UOM, including bounded decimals. Actual lot/heat identifiers are operator/supplier evidence, not generated component serials. SERIAL requires integral quantity and exactly that many distinct, actually supplied serial identifiers; one identity represents one source UOM. Existing cardinality/uniqueness bounds need an explicit typed-cohort limit, proposed 100 identities per receipt line for compatibility with current custody authority. No placeholder serials, auto-numbering of purchased components or undocumented UOM conversion.

Item kind PURCHASED is required for initial typed procurement. MANUFACTURED stock must come from the later real internal production path, not from pretending that an internally built output was purchased. An item revision changing LOT to SERIAL is a new approved policy revision, not a transformation of historical received stock.

Canonical E01's five received sources have real lot/heat and no incoming component serial IDs. A future accepted evidence/fixture policy may describe those sources as LOT without changing the fixture or inventing supplier serials. That description is not runtime legacy adoption, catalog identity proof or typed-stock eligibility. Its UN/SET UOMs and integer quantities do not imply SERIAL. Supplemental SERIAL tests remain separate.

## New typed request and PO source authority

Proposed separate namespace `/api/catalog-procurement`, schema CATALOG_PURCHASE_V1. This is a design candidate, not a mounted endpoint. The implementation contract must freeze exact paths, capabilities and lifecycle before code changes; current strict legacy line allowlists must not be weakened to accept ambiguous optional item fields.

Each new request line references an approved item UUID/revision and caller-expected master version. The server derives and freezes:

```text
lineId: stable server UUID
itemId, itemRevision, itemContentHash, approvedItemVersion
itemCode, descriptionSnapshot, uom, kind: PURCHASED, trackingPolicy
itemSchema: INVENTORY_ITEM_V2
ownerLegalEntityId: derived from authenticated active plant
quantity, unitPrice, currency
```

Description is presentation evidence. UUID/revision/hash/policy/UOM and the approval authority establish the line identity. Server-derived fields cannot be submitted as overrides. Initial scope is one tenant/plant/company legal entity; no customer-owned, intercompany or cross-plant procurement. Owner is the purchasing company recorded by the new workflow, not a claim that a supplied document independently verified legal title.

Suggested lifecycle follows real request drafting, approval, conversion and PO issue. Every content revision is immutable; approval binds its exact hash and line IDs. Conversion copies the approved snapshot into a real typed PO. Issue revalidates active owner and current applicable master approval/policy. No synthetic legacy request/PO, no missing vendor check, and no bypass that creates a later entity merely to complete a demo.

Real use-fence writes on item master heads serialize request approval/PO issue with item revision or deactivation. Head status must match immutable authority evidence. Master changes before fresh approval or issue block those actions and expose precise source blockers. Exact acknowledged replay remains historical after committing authorization is rechecked.

For the first increment, a PO line becomes non-receivable for a fresh receipt when its item revision is no longer the current approved revision or the item is deactivated. Existing issued PO content is preserved; no automatic rebind, substitute item or silent cancellation. A separately reviewed PO amendment/supersession policy is needed to receive against a different revision. This conservative policy may require reissuing an order after harmless catalog edits, but avoids creating an unreviewed equivalence rule.

This chooses blocked intake after a master change, including quarantine intake; it does not silently accept against an obsolete revision because the goods have physically arrived. The UI must expose that receiving exception and preserve the issued PO history. A non-stock arrival/exception record may be proposed separately, but cannot masquerade as a receipt or create an available/quarantined stock balance. Controlled amendments and receiving against a historical approval remain out of scope until their equivalence, entitlement and authorization rules are frozen.

## Actual receipt mapping and quarantine boundary

A typed receipt references a real ISSUED typed PO, exact immutable lineId, vendor, current expected PO version, quantity/UOM, and actual lot/heat plus SERIAL identities when required. The server copies the frozen catalog/owner/policy source into an immutable typed receipt source binding. It must verify the PO approval/issue evidence, line hash, current applicable master authority and exact received entitlement inside the same guarded transaction as receipt/receive-ledger/key/outbox.

Proposed binding:

```text
catalogSource: {
  schema: CATALOG_RECEIPT_V1,
  purchaseOrderId, purchaseOrderRevision, purchaseOrderLineId,
  purchaseOrderLineHash, itemId, itemRevision, itemContentHash,
  approvedItemVersion, ownerLegalEntityId, uom, trackingPolicy
}
```

The received quantity is a real physical receiving record. Creating that receipt may create quarantined stock and the normal RECEIVE movement once; it is not a planning side effect and must not be simulated through a fake receipt. Receiving does not create available stock, consumption, a manufactured output, an invoice or a component installation. Partial receipts share the actual PO entitlement and immutable line identity while carrying their own source/lot/serial evidence.

Physical-item mapping, lot/heat and serial capture are operator-recorded receiving evidence unless an actual verified provider supplies that evidence. Catalogue approval validates the selected master definition; it does not independently certify that the delivered object matches it, establish supplier authenticity or prove a QC result. Later QC approval must record its own authorized checks and evidence. Do not label either step provider-verified without a real integration and accepted verification proof.

The initial mapped receipt remains QUARANTINED with availableQuantity zero. A typed receipt is not an input to current legacy sales reservation, manual/engineering release, first consumption, quantity-only dispatch or custody adoption simply because its UOM matches. Permanently refuse those legacy paths when the new marker is present, including null/malformed marker cases, until a separately accepted typed adapter handles that operation. The guard must cover both newly mapped receipts and defensive consumption of any improperly created older reservation/routing.

Marker presence alone is insufficient cohort authority. Resolve every competing receipt use from immutable receipt-origin proof and its real PO namespace/identity, or an equivalent immutable source index written atomically with receipt creation. A typed origin remains typed if `catalogSource` is stripped; absent, mismatched or ambiguous origin proof must deny use rather than downgrade to legacy. Positive legacy eligibility requires a valid real legacy PO/receipt lineage under the accepted legacy schema, not merely `!hasOwn(catalogSource)` or absence of a typed index row. Freeze the exact origin-proof storage and resolver before implementation, and use that resolver consistently in release, putaway, reserve, consume, count, transfer and dispatch. Include a negative test that strips the marker from a typed receipt and attempts each legacy use; no stock effect or durable success key may result.

Current free-text putaway and unrestricted bin transfer are also insufficient for the new company-location authority. The first mapping increment should refuse legacy release/putaway/transfer/count on the new cohort. Hold apply/release remains permitted and preserves identity. Later typed QC release and putaway need real qualified company location, owner/source/policy revalidation and shared receipt/location/bin fences. Quantity adjustment must preserve typed item/lot/serial authority; it cannot clear a marker or create new source eligibility.

This quarantine-only boundary intentionally postpones usable typed stock. If acceptance requires available stock immediately, include the complete typed QC/location and competing-writer contracts in that increment rather than letting existing quantity paths bypass the mapping.

## Holds, identity and version fences

All fresh eligibility checks use active authoritative holds and strict malformed-cache handling. Metadata trace and immutable source history remain visible under later holds. A hold does not rewrite received item identity, PO lineage or historical approvals. Releasing a hold does not restore a deactivated item revision or qualify a location.

Request approval, PO issue, receipt mapping and future typed release/issue must use the existing committing user/tenant/plant/legal-entity authorization fences before durable replay, plus actual writes to every conflict authority they rely on. At minimum:

- Current item master head against revision/deactivation and policy changes.
- Typed request/PO head and immutable line entitlement against conversion, issue, amendment and concurrent partial receiving.
- Actual receipt document against holds, mapping/custody transitions and every stock writer.
- Qualified location head and underlying real bin against deactivation or location changes, when an operation uses that location.
- Source serial identity registry/custody rows against duplicate assignment and incoming/manufactured serial collisions when policy is SERIAL.

Do not rely on a read-only status check or an unchanged public version alone. Fence-only metadata must not alter historical approval hashes; semantic fields and their immutable proof must remain exact. Failure after any source write must roll back receipt, identity claims, entitlements, audit/outbox and idempotency evidence together. Bound item/source/line counts and reads; use the global 32 kb request limit and exact decimal arithmetic.

## Legacy receipt adoption policy

The initial recommendation is **NO LEGACY ADOPTION**. Existing descriptions/UOM cannot prove which item revision was received. A clean balance is necessary for a future adoption workflow, but not sufficient evidence of identity. Existing K1/K2a/K2b1 consumed/claimed/installed sources must never be relabeled as fresh free typed stock.

If a later reviewed increment permits untouched adoption, require explicit independently recorded source mapping evidence, actual PO/vendor/line identity, an approved revision/policy mapping decision and separate authorization. Require exact untouched counters, complete no-use history, no sales/manufacturing reservation or consumption, no claim/adoption/installation authority, no incompatible transfer/count history, and exact registry/cardinality proof. One real receipt CAS must contend with adoption versus every legacy use; raw history and marker corruption fail closed. Capture an immutable adoption event and preserve the prior source labels. Do not manufacture an original item approval date or supplier serial evidence.

No current approval of this draft permits that adoption path. Already consumed material remains historical UNMAPPED for catalog identity unless a separate evidence-only policy is reviewed; it must not become stock available for another issue.

## Future typed internal execution adapter

Planning material lines currently express ITEM_REQUIREMENT with approved item snapshots; they are not receipt or stock allocations. A future explicit INTERNAL_EXECUTION schema must bind those exact approved demands to real typed receipt/issue identities and location/owner evidence. Do not retrofit already released legacy WOs or reinterpret current planning as execution permission.

Introduce an origin-dispatched source adapter for actual internal production orders, separate from CUSTOMER_ORDER manufacturing. It must validate the approved internal order/engineering revision, current source item policy/UOM/owner and exact remaining demand. It must not pass synthetic salesOrderId/accountId, bypass the legacy SO source guard, write manufacturingAllocated/customer fulfillmentTallies, or create stock from engineering approval. Internal planning continues to report NOT_IMPLEMENTED/canExecute false until this execution authority is separately accepted.

LOT and SERIAL inputs use different actual source authorities. LOT can consume exact released quantities from the correct typed lot with durable lot genealogy and stock conservation. SERIAL additionally requires real received identities, pre-consumption claim/reserve/consume states and per-output installation/loss evidence as applicable. Do not turn LOT inputs into serial custody or assert that a mixed LOT/SERIAL BOM is supported by the current all-serial custody-required WO flag. Mixed tracking needs an explicit per-line schema/adapter and independent tests.

Internal execution must create real operations/output/QC records and company-stock receipt only through their accepted later workflows. A manufactured assembly embodies those source inputs; issuing that assembly into another parent must not consume its raw materials again. The mapping increment does not unlock manufactured graph/cycle acceptance or replacements.

## Concrete staged deliverables and acceptance

These are proposed decomposition IDs beneath K2B2-01..04, not implemented backlog status.

| Proposed ID | Deliverable | Required proof |
| --- | --- | --- |
| MAP-01 | Freeze master V2 policy and typed procurement/receipt contract | Explicit LOT/SERIAL; authoritative purchased item revision/UOM/owner; no V1 policy inference; legacy schema unchanged. |
| MAP-02 | New typed request approval, PO conversion and issue | Immutable line identity/hash, current master use fence, vendor/owner/scope checks, revisions/deactivation races, replay/rollback, unchanged customer entitlement. |
| MAP-03 | Actual typed quarantine receipt and permanent legacy-path guards | Exact partial-receipt entitlement, actual lot/serial evidence, master/PO/receipt fences, quantity/identity conservation, no legacy consume/reserve/putaway/count bypass. |
| MAP-04 | Independent mapping acceptance and native UI | Scoped source navigation, immutable historical replay, corrupt marker/registry/approval refusal, operator recovery, concurrent receiving/hold/master changes, canonical LOT fixture unchanged and separate SERIAL fixture. |
| MAP-05 | Freeze typed QC/location and internal execution adapters | Approved demand versus execution ordering, real qualified owner/location and source policy; no fake SO/receipt, no planning stock effects. Implementation remains separately gated. |

The first runnable outcome should be a real typed PO and its exact quarantined receipt identity, with an explicit explanation that it cannot yet feed internal production. Do not call this internal execution, available company inventory, general genealogy acceptance or production readiness. Finish MAP-04 before broadening into MAP-05 execution work.
