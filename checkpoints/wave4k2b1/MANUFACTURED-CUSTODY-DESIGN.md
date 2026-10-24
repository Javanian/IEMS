# Manufactured component custody: K2b2 design proposal

Status: **DRAFT, NOT FROZEN, NOT IMPLEMENTED**. Prepared 2026-10-24 from the current K2a/K2b1 source contracts. This document proposes later work; it does not authorize source changes or establish acceptance. K2b1 remains received-only. General manufactured graphs, cycle acceptance, replacement and internal inventory production are absent today.

## Decision and current boundary

Create an explicit internal production and company inventory path before accepting any manufactured child. Every currently produced output is tied to a customer sales order, account and line. Its QC ACCEPTED state and serial registry entry do not establish company-owned component inventory. Existing outputs, outputs with missing/unknown origin, and explicitly customer-owned material remain ineligible. Do not reinterpret their historical ownership or issue a synthetic sales order to manufacture eligibility.

The main tradeoff is additional domain work before general installation graphs can run. A distinct internal production source adds engineering, inventory and UI work, but avoids releasing customer demand or treating commercially committed units as free components. Reusing the current customer-order workflow with null fields or an ownership checkbox would hide that conflict.

Current extension points and gaps:

| Current authority | Proposed boundary |
| --- | --- |
| manufacturing.mjs plans only from a real OPEN SO and writes manufacturingAllocated | Add a separately authorized internal production-order aggregate and endpoint. Do not loosen the existing SO planner or write customer allocation/tally rows for internal work. |
| engineering.mjs approves routing/BOM tied to SO identity/version | Define an internal engineering release bound to the internal production order, item/revision and company owner. No fake SO or acceptance adapter. |
| manufacturingOutputUnits and shared warehouseSerials identify finished units | Add a mandatory discriminated output origin for the new path. Keep existing registry uniqueness and real output IDs; missing origin stays ineligible. |
| serial-custody.mjs proves receipt identities through consumption | Preserve its received identity authority. New internal WOs need an explicit origin adapter and internal demand validation, never a blanket skip of source checks. |
| genealogy.mjs binds consumed receipt material to output units | Add a versioned typed source model for manufactured inventory issues; preserve K1 receipt projections and historical revisions unchanged. |
| component-installation.mjs has received leaf dispositions and a scoped graph write fence | Extend only after internal stock authority exists. Keep child types distinct, one active parent, bounded traversal and descendant freezing. |
| fulfillment.mjs ships existing customer-order WORK_ORDER sources | Explicitly refuse internal-origin outputs in this route. A later sale/transfer of company inventory requires its own authorized demand/stock source, not a forged SO-source match. |

These are integration targets, not existing endpoints. Freeze exact schemas and migration/version adapters before implementation.

## Internal production and ownership authority

Proposed immutable origin discriminants:

```text
CUSTOMER_ORDER: salesOrderId, accountId, lineIndex, salesOrderVersion
INTERNAL_STOCK: internalProductionOrderId, internalEngineeringRevision,
                ownerLegalEntityId, plantId, inventoryItemId, itemRevision
```

Do not backfill INTERNAL_STOCK on old output units. An internal production order has an explicit authorized purpose and target quantity, a released internal BOM/routing, exact source-UOM requirements, output serialization, QC evidence and company inventory destination. Its lifecycle needs a dedicated native workspace; existing customer source links must retain their meaning.

The server derives ownerLegalEntityId from the authenticated selected plant and verifies active tenant, plant and legal-entity membership. A caller cannot submit an arbitrary company owner or clear an account ID to change ownership. Initial scope is one tenant, legal entity and plant. Intercompany, cross-plant and customer-owned transformations require separate contracts.

Introduce a new versioned typed-material schema and explicit planning opt-in for these internal orders and for parent WOs permitted to consume manufactured inventory. The selected schema, purpose and source kinds are immutable planning facts. Do not retrofit already released K1/K2a/K2b1 WOs, expand their existing receipt budgets, or infer a manufactured-material allowance from an old description. Existing cohorts keep their accepted schemas and remain ineligible for manufactured-child issue.

Keep QC outcome, inventory disposition and location as separate dimensions. Proposed new stock units retain immutable origin plus current versioned owner/location/disposition. A valid inventory location is an active company warehouse/bin in the same plant. Operator-entered text alone cannot establish a location or title transfer. Unknown owner/location, missing QC evidence or unsupported origin fails closed.

No current internal production aggregate or internal engineering release is mounted. A production order must not be considered complete merely because its serial records exist.

An inventory item/revision authority and qualified active warehouse/bin ownership authority are also missing. Existing bin IDs/codes and free-text locations do not establish item identity, approved revision, active company ownership or stock eligibility. K2B2-01/02 must either implement and version those authorities with scoped authorization and lifecycle tests, or explicitly depend on a separately accepted provider. The new flow must refuse operation while those prerequisites are absent; it must not substitute a text field or assume a provider is connected.

## Proposed custody lifecycle and stock conservation

The following is a proposal to freeze after source and workflow review:

| Disposition | Entry proof and permitted next step |
| --- | --- |
| PRODUCTION_QUARANTINE | Internal output exists with immutable origin; no claim, install or dispatch eligibility. |
| STOCK_AVAILABLE | QC ACCEPTED, required lot/installation genealogy complete, explicit authorized receipt into valid company location, no active holds. |
| COMPONENT_RESERVED | Exact unit reserved against a released typed component demand; unit and stock-position CAS commit together. No competing parent or sale allocation. |
| COMPONENT_ISSUED | Explicit issue to that parent WO consumes its internal-stock entitlement once. Source issue records unit, source inventory version, owner, UOM, demand and actor. |
| INSTALLED | The same issued identity is attached to its authorized parent through a graph transaction. It remains unavailable and cannot also be dispatched. |
| REMOVED_QUARANTINE | Controlled removal preserves the edge and source issue. No automatic reuse, available-stock increase or clearing of the previous parent history. |
| SCRAPPED / QC_REJECTED | Explicit terminal quality disposition with immutable evidence; not a component source. |

Releasing a COMPONENT_RESERVED unit before issue may be a separate authorized command with reason and exact stock reversal. It must not be inferred from a timeout. There is no release/reuse of issued, installed, removed or scrapped identities in the initial increment. Inspection and return-to-stock remain separately gated.

Company ownership is only one eligibility condition. The unit must also have accepted QC, complete validated child genealogy, a valid stock location, current hold-free source ancestry and exact reserved/issued identity authority. Reservation is the identity claim: it removes that unit from free stock atomically and names its sole parent demand. Do not model a company-owned ACCEPTED unit as implicitly claimable or installed.

One identity belongs to exactly one disposition bucket at a time. Exact stock ledgers and their rebuildable projections distinguish available/reserved stock, issued WIP and terminal dispositions; installation is not a second stock issue. For each production batch, output identities reconcile with production quantity, QC outcome and all current inventory/WIP/terminal dispositions. Preserve explicit process-loss treatment for consumed inputs; do not invent an output unit for scrap.

For each parent component demand, ordered requirement equals outstanding plus reserved plus issued quantity, adjusted only by explicitly authorized reversals or rework amendments. Issued quantity equals distinct issued identities; installed quantity never exceeds issue entitlement. An identity removed from a parent remains part of its consumed issue history and cannot replenish outstanding demand without a controlled replacement/rework authorization.

Separate approval of the typed component demand from execution release of the parent WO. First approve/release a versioned demand from the selected BOM while the execution WO is still PLANNED; then reserve exact stock identities against that demand; only then may execution release validate the complete reservation set and begin issue/execution. A released component demand is not an already RELEASED execution WO. Demand changes or revocation must share the same demand/WO/unit fences, and must not invalidate a reservation silently. This ordering prevents reserve-before-execution from becoming circular with execution release requiring reserved inputs.

An internally manufactured assembly embodies its original receipt consumption. Issuing that assembly as a child must not consume its raw materials a second time. Parent sources become typed INVENTORY_ISSUE records in a new genealogy schema, with traversal to the child's immutable origin and receipt ancestry. Never fabricate a warehouse receipt or copy the child's raw-material quantities into the parent's direct consumption ledger.

### Demand and financial separation

Internal production does not create customer quotes, acceptance, SO lines, invoice entitlement, shipment tallies or payment balances. It must not write manufacturingAllocated or fulfillmentTallies for a customer order. No invoice is issued merely because a company-owned component is produced or installed.

Installing internal inventory into a customer WO is a material issue against that WO's approved component demand. The customer WO's finished-output shipment and billing caps remain unchanged. Item/revision/UOM equivalence must be explicit in the released typed BOM; a matching description is insufficient.

Current portfolio quantity and financial records do not establish perpetual inventory valuation or a general ledger. Preserve exact captured source cost/currency where authoritative; expose unsupported valuation as UNVALUED rather than zero. Do not call the proposed internal-stock ledger an accounting valuation system. Cost rollup, capitalization, intercompany accounting and statutory treatment need their own reviewed policies.

Existing SO-bound output transfer is excluded. Any future exception must atomically reconcile the original manufacturing allocation, replacement demand, serialized dispatch eligibility, invoiced/shipped entitlement and immutable issued records. A transfer must not free the same unit for both customer dispatch and internal installation. No current command provides that authority.

## Conflicts with QC, holds, reservation and dispatch

Use the same real manufactured-output unit document as the conflict authority for QC disposition, stock receipt, reserve/release, component issue, installation/removal and shipment. Each transition checks expected unit/stock/demand versions, performs a real CAS increment and commits audit, outbox, immutable events and idempotency receipt atomically. Separate collections may project inventory positions, but they cannot substitute a read-only check for that common unit write.

Every existing direct WORK_ORDER dispatch path must reject an internal-origin or component-encumbered unit, including malformed marker presence. A future company-stock sales route must reserve and ship the exact identities through the same unit/stock fence as component issue. ACCEPTED by itself is never dispatch or installation authority. Invoice entitlement must come from an actual authorized sale/shipment source.

Reservation captures the child's complete current genealogy/installation revision hashes and creates a real versioned evidence lock that every child evidence writer checks. The initial policy should block child provenance correction while any component reservation is active. A controlled pre-issue release may retire its lock only when no remaining reservation, issued component or frozen ancestor still depends on it. Issue converts the dependency into an immutable source-evidence lock; it cannot be cleared by cancelling a reservation. This prevents a parent from silently retaining COMPLETE over a changed child before the first shipment.

These are new inventory evidence-lock records, not fake K1 shipment freezes. Do not populate firstShipmentId with an issue ID or call the dispatch helper to obtain a lock. If the implementation conservatively locks an entire source WO's evidence, all affected sibling evidence edits must be visible as blocked. That history policy must not mark unrelated sibling outputs RESERVED, ISSUED or SHIPPED, consume their inventory, or reduce their physical entitlement. Evidence immutability and physical custody remain separate authorities.

Holds remain independent quality authority. Stock eligibility, issue, installation finalization and fresh shipment check current direct and inherited source holds, including malformed caches, and write the same held source documents in their transaction. A later hold does not erase historical attribution; historical trace reads expose it. Installed descendants may not become claimable merely because a hold is released.

Test issue-versus-dispatch, reserve-versus-reserve, install-versus-QC rejection, hold-versus-issue/finalize/ship and cancellation-versus-issue with deliberate overlapping transactions. Both commands returning success is acceptable only when the committed serial order preserves all entitlements; never count a stale eligibility snapshot as proof.

## Typed graph and cycle prevention

Parent nodes are manufactured output identities. Child keys are typed, for example RECEIVED:<custodyUnitId> and MANUFACTURED:<outputUnitId>; UUID coincidence cannot merge namespaces. Received nodes remain terminal. A manufactured child must have valid INTERNAL_STOCK origin and the exact COMPONENT_ISSUED entitlement for the prospective parent. Reject self-links, foreign scope/owner/plant, duplicate children, already parented/removed units and unsupported types.

Maintain a scoped unique active child key and a current unit disposition/pointer, with immutable edge events and revisions. Active uniqueness alone is insufficient for removed identity reuse: the retained custody disposition must also refuse it. Parent and child versions, released demand, source issue and graph revision are checked together.

Every graph mutation performs a real increment on the shared tenant/plant graph document in the same committing transaction BEFORE it relies on traversal results. Traverse the prospective manufactured child's descendants; if the intended parent is reachable, the proposed parent-to-child edge would create a cycle. Snapshot traversal without this common write fence is insufficient for simultaneous A->B and B->A. On write conflict, re-read graph authority and traverse again; do not reuse earlier reachability results.

Proposed initial bounds are depth 32, distinct manufactured nodes 1000 and active edges 2000 per mutation/freeze. These are draft implementation limits, not accepted performance capacity. Detect duplicate edges and inconsistent source ownership. Exceeding ANY bound, missing required node/source, malformed edge or unknown type must fail closed with an explicit traversal-limit/source error. Do not silently truncate, paginate a single integrity decision or call a partial traversal acyclic.

Graph limits alone do not bound source reconciliation or a conservative whole-WO evidence lock. Freeze additional independent budgets before implementation. Proposed draft ceilings per command are 128 distinct source WOs, 256 sibling output identities pulled solely for whole-WO reconciliation, 2000 terminal received identities INCLUDING loss/removed dispositions, 128 distinct receipt/hold authorities, 10000 total documents read, 2000 documents written, 500 database operations and a 5-second server-side transaction work deadline. The complete generated closure manifest must serialize to at most 1 MiB; the caller request limit remains 32 kb. These values are candidates for measurement and review, not established throughput or production capacity.

Count expanded source and sibling work as well as reachable active edges. Every query must be bounded by the remaining budget plus one overflow sentinel; do not fetch an unbounded claim/source history before measuring it. Deadline and operation/read/write counters cover retries within a bounded command attempt. A timed-out attempt aborts and may be retried only through durable idempotency with fresh authority checks. A large batch must not be split into separately committed partial freezes merely to evade a limit. Exceeding any graph, terminal, receipt, sibling, source, byte or transaction-work budget aborts the whole transaction with an explicit budget blocker and leaves no partial lock, stock change or shipment.

Cycle tests need both sequential and reciprocal concurrent cases, longer cycles, shared descendants, self/duplicate links, corrupt graph state and exact boundary/over-bound cases. Received-only K2b1 tests do not cover these assertions.

## Shipment freezes reachable ancestry

Shipping a manufactured parent must lock the shared graph revision and resolve its complete reachable manufactured subgraph, plus terminal received identities and source receipt holds, within the declared bounds. A direct-parent freeze is insufficient.

Persist an immutable closure manifest containing each descendant's typed identity, active edge set/hash, current validated genealogy/installation revision/hash, source issue, owner/custody disposition and applicable source receipts. Validate head status against immutable revisions and effective projections before accepting the manifest. Freeze the relevant descendant evidence in the same transaction as parent dispatch, using the same unit/head/graph/source documents that all mutation and independent-dispatch paths test.

Once an ancestor has shipped, descendant removal, re-parenting, evidence changes, QC disposition or direct dispatch cannot race past that frozen ancestry. Do not store only a digest without an authority that later writers are required to check. A separately recorded quality incident may add evidence without rewriting the shipped closure. Corrections to shipped ancestry require a future controlled workflow and preserve the old manifest.

Different ancestor shipments can reference already frozen descendants only when the underlying unique-parent/custody rules permit the same physical ancestry; they cannot issue a second physical child entitlement. A shared graph reference is not permission to install or dispatch the same component twice. The initial model should reject such ambiguity rather than infer interchangeable stock.

## Removal and authorized replacement

Preserve K2b1's permanent REMOVED_QUARANTINE behavior. The current received-only WO consumed exactly its released input budget; it has no authorized spare or extra rework issue. Consequently, removal leaves normal completion blocked. A replacement button cannot supply missing material authority.

Before replacement is implemented, define an approved rework order or released demand amendment with exact replacement item/revision/UOM, additional source identity, quantity cap, quality/inspection evidence and cost treatment. The replacement source must independently satisfy company ownership or valid incoming custody, unused issue entitlement and all graph/hold checks. It must not be a previously declared process-loss or retired identity.

A later atomic replacement transaction appends removal of the old edge and installation of a separately authorized new issue, consumes the rework entitlement once, reconciles original production versus extra rework quantities, and creates a new immutable parent revision. The old component stays quarantined and its historical source budget remains consumed. Replacing a component never silently frees it for another parent or erases the original scrap/cost evidence.

Inspection, disassembly, returns, repair, custody reuse and warranty consequences are separate workflows. They remain unsupported until their state/ownership rules and conflict documents are frozen.

## Proposed backlog and acceptance sequence

These IDs are draft decomposition under existing W4K-05 through W4K-08. They do not change the older backlog's status or claim that an endpoint exists.

| Proposed ID | Dependency | Concrete deliverable and acceptance |
| --- | --- | --- |
| K2B2-01 | Accepted K2b1 | Freeze internal production purpose, immutable origin/owner, new typed schema/opt-in, item/revision and qualified location authorities, internal engineering and demand-versus-execution ordering; reject reuse of old SO outputs. |
| K2B2-02 | K2B2-01 | Implement or integrate separately accepted item/location authorities, internal production-order API/UI and QC-to-stock receipt; native creation/reload, exact serialized output and stock reconciliation, no customer allocation/tally/invoice effects. |
| K2B2-03 | K2B2-02 | Exact company-stock reserve/release/issue authority with stock/output-unit CAS; typed parent material demand and source issue; issue/dispatch/hold/QC races and rollback/replay. |
| K2B2-04 | K2B2-03 | Versioned manufactured-source genealogy adapter; no double raw-material consumption, immutable source ancestry and exact unit/UOM demand reconciliation. |
| K2B2-05 | K2B2-04 | Typed manufactured graph, one active parent, real shared graph write fence and bounded cycle traversal; concurrent reciprocal cycles and competing parents independently tested. |
| K2B2-06 | K2B2-05 | Ancestor shipment closure/freeze across all reachable manufactured descendants and source holds; descendant mutation/dispatch races, corruption and bound failures. |
| K2B2-07 | K2B2-03;K2B2-05 | Freeze rework/spare demand authority and removal/inspection policy before any replacement implementation. |
| K2B2-08 | K2B2-07 | Optional controlled replacement with separately authorized issue and immutable removal; no retired/loss reuse, no duplicate issue or hidden stock reversal. |
| K2B2-09 | K2B2-02..06 | Independent API/browser/restart acceptance, source/import manifests and exact quantity/demand/financial-negative evidence; retain received-only and historical PDF regressions. |

The smallest next implementation is K2B2-01/02, with manufactured installation still refused. Only accepted inventory authority can unlock issue and graph work. Full Wave4k acceptance still requires its separately defined complete genealogy gate; POD, canonical E01 parity and external/production readiness remain later and separate.
