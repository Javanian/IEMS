# K2a: received serial custody before consumption

Frozen local contract, 2026-10-24. Baseline `2b66c853a3ef4420b7fb899b4af75af230873f7b`, branch `feat/manufacturing-serial-custody`, worktree `D:/Project AI/GITHUB/IEMS-worktrees/manufacturing-serial-custody`. Preserve the accepted K1 and older dirty checkouts. This is the first part of K2: received-component identity custody through WO consumption. Manufactured-child inventory, per-output installation, unique parents, cycles, removal and return-to-stock remain K2b. Canonical E01 has no received component serial IDs; use separate supplemental fixtures.

## Opt-in and adoption

WO planning optionally accepts boolean `serialCustodyRequired`. True requires both `serialized: true` and `genealogyRequired: true`, integral splits at most100. False/omitted leaves existing responses and behavior unchanged and omits the flag. Required WOs may release at most20 sources; EVERY material source must be adopted. Each source's quantityPerUnit must be a positive integral exact decimal and total required serial count must be at most100. Ratio2 is supported as two source-UOM units per output; fractional ratios are outside K2a. One serial identity represents exactly one source UOM; no conversion.

Receipt adoption is explicit and permanent. Require current STORED receipt, paired frozen lot/heat, integral quantity1..100 and unique receipt.serials count exactly equal to quantity. Require availableQuantity==quantity and every sales-reserved/shipped/manufacturing-reserved/consumed counter zero. Reject ANY sales reservation, manufacturing reservation/consumption movement, warehouse RESERVE/SHIP/COUNT/TRANSFER history or preexisting custody authority. Check the full receipt-owned serial registry set: exactly the receipt serials, receiptId matching, no manufactured source/workOrderId/unitId or extra/missing/foreign rows. Counters alone cannot establish unused stock. Prior released holds are permitted only when current authoritative hold/cache state is valid and clear. No automatic adoption/backfill and no adoption after quantity usage.

Adoption writes receipt.serialCustody `{mode:'RECEIVED_V1',adoptedBy,adoptedAt}` plus receipt.version, separate serialCustodyUnits authority and immutable event, in the existing warehouse transaction with audit/outbox/key. Unit authority uses new stable UUIDs and retains registryId, receiptId, serial, source UOM and frozen materialTrace. Registry uniqueness itself remains unchanged. Invalid present adoption markers fail closed, never silently become legacy quantity stock.

Unit states: AVAILABLE -> CLAIMED -> RESERVED -> CONSUMED. CLAIMED -> AVAILABLE is permitted only by explicit abandon while its WO is PLANNED. RESERVED/CONSUMED have no release/reuse/cancellation endpoint in K2a. Do not fabricate output installation or parent edges. Claim documents keep bounded frozen unit IDs/serials/trace and current state/version; immutable serialCustodyEvents retain changes separately, not in unbounded arrays.

## Quantities, claims and all competing writers

Claiming and abandoning identities DO NOT change stock quantities. They write both receipt.version and PLANNED WO.version, plus unit CAS, claim/event, manufacturing audit/outbox/key. A scoped partial unique active claim per WO/receipt and unit CAS prevent duplicate custody. Active means CLAIMED, RESERVED or CONSUMED; ABANDONED leaves history but frees its identities. At most20 active receipt claims per WO and100 units per receipt command. Only AVAILABLE units from the exact adopted receipt are claimable, only when source holds are clear. Claim cannot retrofit a RELEASED/already-consumed WO. No TTL or automatic unclaim.

Release and release-engineering accept top-level `serialClaims:[{receiptId,claimId}]`. Validate its complete set against resolved routing and ALL active WO claims: exactly one CLAIMED claim per material, no extra/missing/foreign/abandoned IDs, exact source UOM, positive integral ratio and unit count equal to computed required quantity. Both release paths call the same shared validator. CLAIMED -> RESERVED and the existing available -> manufacturingReserved stock move commit together. Freeze `materials[].serialCustody:{claimId,serialUnitIds,serials}` into routing and MATERIAL_RESERVED evidence. Expected WO version catches concurrent claim/abandon changes. Do not change approved engineering revision content or permit caller-derived serial trace authority.

First-operation record verifies each required routing claim, exact unit/registry origin/count/receipt/WO/trace/status and the matching MATERIAL_RESERVED evidence, then RESERVED -> CONSUMED atomically with the existing manufacturingReserved -> manufacturingConsumed update and MATERIAL_CONSUMED evidence. Scrap/zero-good output still consumes the claimed input identities once. Later operations cannot consume again. Holds added after claim/release block fresh release/first consumption without deleting acknowledged custody. Exact authorized replay returns its old result with no new stock or identity effects.

Every quantity-only sales reservation, legacy manual/engineering release, legacy first consumption and RESERVATION dispatch must permanently reject an adopted receipt, including when all units are AVAILABLE or all claims abandoned. A required WO cannot use unadopted sources. COUNT is forbidden for adopted receipts even when unclaimed, because a quantity-only adjustment cannot reconcile identities. Whole receipt TRANSFER may proceed only when every authority unit is AVAILABLE, no active claim exists, all encumbrance counters zero and holds clear; it writes the existing receipt CAS so claim/transfer/adoption contend. Unit location derives from the receipt. Hold apply/release stays permitted at every custody stage and writes the same receipt. K1 genealogy receipt fences and normal stock writers remain intact. There is no separate mounted stock adjustment endpoint.

Strict K2a hold handling also rejects any present non-null hold cache failing validHoldCache, including `{active:false}`. Read exposes INVALID_HOLD_CACHE, claimable=false and a blocker; metadata abandon may proceed during a hold, but AVAILABLE never means unheld/physically available. All adoption/claim/release/consume/transfer eligibility checks use authoritative holds and the transaction's real receipt write, not a no-op/cached check. No blanket changes to legacy hold semantics.

## Authority and wire

Actions `custody.read`, `custody.adopt`, `custody.claim`, `custody.abandon`. Roles custodyReader/Adopter/Claimer/Abandoner include warehouse.read, manufacturing.read and custody.read plus the named mutation action. Existing roles gain no implicit new grants; owner gets explicit action registration. Manufacturing release/record retain their existing permissions and perform custody transitions as consequences of those commands. All commands authenticate tenant/plant and use committing guards BEFORE durable replay. Rejected commands retain no domain/key effects. Changed body/kind/resource with the same key conflicts. UUIDs, safe versions>=1, unknown-field rejection and existing body idempotency keys8..100 retain existing rules. Reason is trimmed3..500 characters.

Warehouse provider receives `tx(req,kind,payload,effect)` from installWarehouse; manufacturing provider receives existing `tx(req,kind,effect)`. Abandon uses a body claimId so the existing manufacturing body hash binds that resource. Keep the global32kb request limit.

- GET `/api/warehouse/receipts/:id/serial-custody` -> `{data:receiptView}`.
- POST same path + `/adopt`: `{expectedVersion:<receipt>,reason,idempotencyKey}` ->200 `{data:receiptView}`.
- GET same path + `/events?limit=25&cursor=<UUID>` -> standard `{data:event[],page:{limit,nextCursor}}`, max100, UUID order not chronology.
- GET `/api/manufacturing/work-orders/:id/serial-claims` -> `{data:woView}`.
- POST same path: `{expectedVersion:<WO>,expectedReceiptVersion,receiptId,serialUnitIds:[UUID],reason,idempotencyKey}` ->200 `{data:woView}`. Unit IDs1..100 unique. Serial strings/caller trace/quantity overrides rejected.
- POST same path + `/abandon`: `{expectedVersion:<WO>,expectedClaimVersion,claimId,reason,idempotencyKey}` ->200 `{data:woView}`. Only active CLAIMED ownership and PLANNED WO; no quantity reversal.
- GET same path + `/events?limit=25&cursor=<UUID>` -> scoped immutable event pagination.

Receipt view fields:

```text
_id:receiptId, version:receiptVersion, receiptId, receiptVersion,
tracked, mode:UNTRACKED|RECEIVED_V1, canAdopt, adoptionBlockers:[code],
quantity, quantityAvailable, uom, claimableQuantity,
sourceHolds:[{receiptId,holdIds,reasonCodes,legacy}],
units:[{_id,version,receiptId,serial,uom,status,claimId,workOrderId,materialTrace}]
```

For UNTRACKED units=[], claimableQuantity=null; never infer AVAILABLE from registry. For tracked, claimableQuantity is AVAILABLE identity count only when receipt is eligible/hold-free, otherwise0. quantityAvailable is the existing stock counter and includes pending CLAIMED identities; explicitly distinguish it from claimable stock. canAdopt is domain readiness, separate from permissions.

WO view fields:

```text
workOrderId, required, workOrderVersion, status:<WO status>,
claims:[{_id,receiptId,version,status,serialUnitIds,serials,quantity,uom,
         materialTrace,reason,claimedBy,claimedAt}],
```

claims contains current active CLAIMED/RESERVED/CONSUMED rows (max20); historical ABANDONED evidence is in event pagination. Display installation as UNRECORDED, never imply per-output component linkage. Context holds are fetched through the scoped receipt view.

Errors:400 INVALID_SERIAL_CUSTODY/INVALID_SERIAL_CLAIMS plus existing version/key/pagination validation;403/404 scoped denial/concealment;409 SERIAL_CUSTODY_REQUIRED, SERIAL_CUSTODY_UNTRACKED, SERIAL_CUSTODY_STATE_CONFLICT, SERIAL_CUSTODY_SOURCE_INVALID, SERIAL_CLAIM_CONFLICT, SERIAL_CLAIM_QUANTITY_CONFLICT, STOCK_ENCUMBERED, VERSION_CONFLICT and IDEMPOTENCY_CONFLICT. Adoption-ineligible uses SERIAL_CUSTODY_SOURCE_INVALID or STATE_CONFLICT with blocker view available. No new automatic remediation.

## Provider integration ownership

API owner: new `serial-custody.mjs`, manufacturing.mjs and dedicated owner HTTP test. Export custodyActions/custodyRoles (registered through manufacturing exports once), initializeSerialCustody, installWarehouseSerialCustody, installManufacturingSerialCustody, requireQuantityOnlyReceipt(receipt), requireCustodyTransfer(db,receipt,session). The transfer helper is no-op only for genuinely untracked receipts, validates tracked authority/holds and current claims for adopted receipts; parent performs existing real receipt write. Provider installs warehouse endpoints via passed tx/find/fields/id/fail; manufacturing integration owns its new route-action mapping, planning flag, shared reserve/consume helpers and calls.

Lead: warehouse.mjs initialization/middleware/endpoints/quantity reserve/count/transfer guards, fulfillment.mjs defensive RESERVATION dispatch guard, docs/checkpoint/source manifest/CI and connected browser. UI owner: receipt/WO custody workspace and helpers, planning/release integration, legacy-control guidance and tests. Independent QA: adversarial probe/source review, no owner assertion edits. No agent edits another lane without handoff. Heavy tests sequential with lead-issued token and owned marked disposable Mongo only.

## Acceptance and remaining K2b gate

Owner tests: supplemental received serials, explicit adoption eligibility/registry/history, quantities unchanged by claim/abandon, two WOs competing for identity, abandon/reclaim, both release paths with complete claims and ratio1/2, missing/extra/foreign/fractional inputs, stale receipt/WO/claim versions, guard-before-replay revocation, audit/outbox rollback, first consumption/scrap/zero-good once, all legacy quantity paths denied even after abandon, count forbidden, unclaimed transfer permitted versus claim conflict, later and malformed holds, scoped reads/event pagination. Adoption versus legacy use and claim/abandon versus release must commit in only a safe ordering.

Connected browser: native adoption, planning opt-in, explicit claim/select/abandon/reclaim, manual/engineering release binding and first-operation consumption, uncertain response exact retry, reload/read-only grants/hold recovery, stored events/source pointers and unchanged quantity counters before release; responsive/keyboard proof and all accepted previous switches. Raw evidence external under `D:/Project AI/GITHUB/IEMS-evidence/wave4k2a-20261024/`. No shared database or live provider/broker actions.

K2a acceptance leaves K2b open. Before installation code, separately freeze incoming CONSUMED custody adoption into stable parent output units, manufactured-child inventory transfers with common shipment fences, unique active parent, bounded ancestry traversal with shared graph revision, simultaneous reciprocal-cycle prevention, immutable removal/replacement and inspection before reuse. No retrofit claim on already-consumed legacy/K1 receipts. POD and full original E01 remain later gates. Do not mark complete Wave4k genealogy from K2a alone.
