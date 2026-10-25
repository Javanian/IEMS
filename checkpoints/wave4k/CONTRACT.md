# Wave4k K1: consumed-lot attribution per output

Frozen local implementation contract, 2026-10-24. Baseline `4b9eab05355558c0599fe4d054d16b076e8d88d7`, branch `feat/manufacturing-lot-genealogy`. Follow the reviewed Wave4j DEVELOPMENT-PLAN.md. This increment implements K1 only. Serialized component custody/installation/cycle prevention, POD and full E01 acceptance remain open. Do not modify the older main, CRM or accepted Wave4j worktrees.

## Opt-in and compatibility

Planning optionally accepts boolean `genealogyRequired`. True requires `serialized: true` and each split to be integral and at most 100 units. Omitted/false preserves legacy behavior and omits the response flag. Required WOs may release at most 20 materials, each with the receipt's frozen lotNumber/heatNumber pair; enforce in the shared manual/engineering release path. Existing non-opted-in quantity/serialized flows retain all accepted contracts.

Record attribution only after final output exists (QUARANTINED or QC_COMPLETED). Finalization requires QC_COMPLETED. Reference every output unit, including rejected units, with its stable ID. Each parent unit requires exactly the released quantityPerUnit for each source receipt, in the source UOM. Source total alone is insufficient. Drafts can be incomplete, but no per-unit over-ratio or total over-consumption is accepted. Exceptions/concessions are outside K1; they cannot silently become COMPLETE.

An authoritative source requires a frozen routing material and matching MATERIAL_CONSUMED movement with receipt, quantity, UOM and materialTrace. Server derives movementId, lot/heat and scope. Do not consume stock, reserve stock again, or increment stock quantities when recording genealogy. Preserve exact decimal arithmetic and existing quantity bounds.

## Authority and transactions

New actions: `genealogy.read`, `genealogy.record`, `genealogy.finalize`. Dedicated roles `genealogyReader`, `genealogyRecorder`, `genealogyFinalizer` include manufacturing.read and genealogy.read plus their named mutation capability where applicable. Owner receives these explicit actions through the existing role registry. Existing manufacturingRead/Record roles gain no new grants. Planning still requires manufacturing.plan. Fulfillment shipment remains authorized by fulfillment.ship; its server-derived genealogy update is an internal shipment consequence.

Every mutation validates expected WO version and expected genealogy version and uses the existing committing auth guard BEFORE durable receipt replay. Commands write the WO version and genealogy head in the same transaction, plus effective allocation/balance projection, immutable revision, manufacturing audit/outbox and durable manufacturing key receipt. Failed commands retain no key, revision, allocation or version effects. Exact authorized replay returns its stored response; changed payload or kind/key collision conflicts. New source holds do not retroactively invalidate an already acknowledged command replay; fresh finalization/shipment rechecks current holds.

Head starts at genealogy version 0, currentRevision 0, status UNRECORDED when absent. Each successful attribution/loss/finalize creates one full immutable revision in a SEPARATE document and increments head version plus WO.version. No unbounded history array in the head/WO. A revision records status, reason, actor/time, allocations, losses, source identities and contentHash. Effective projections represent only the current revision; superseded rows never count twice.

Attribution/loss changes replace the specified scope and set DRAFT, including corrections to a COMPLETE but not-yet-shipped WO. The first opted-in shipment conservatively freezes the ENTIRE WO genealogy: status FROZEN and a stable revision/hash/firstShipmentId. No further attribution or correction is accepted, even for its remaining units; later shipped-evidence amendments need a future controlled workflow. This conservative rule makes partial-shipment corrections explicit and cannot free a shipped allocation's budget.

## Wire contract

All endpoints retain authenticated tenant/plant scope and standard `{data}` envelopes. Unknown input fields and caller-supplied derived trace/hash/version authority are rejected. Mutations return 200 `{data: view}`. Mutation key is the existing body `idempotencyKey` (8..100 allowed characters). `expectedVersion` is the current WO version, `expectedGenealogyVersion` the current head version (0 allowed). Reason: trimmed 3..500 characters.

Base: `/api/manufacturing/work-orders/:id/genealogy`.

- GET base: current view, no mutation. A legacy/non-required WO is honestly UNRECORDED with required=false; no synthetic backfill.
- POST `/allocations`: `{expectedVersion,expectedGenealogyVersion,outputUnitId,materials:[{receiptId,quantity,uom}],reason,idempotencyKey}`. Replace ONLY this unit's current material set. Empty materials explicitly clears that unit while unfrozen. Maximum20 unique source receipts; positive exact quantities, maximum six fraction digits. No auto-filled/equally distributed attribution. A unit must belong to this WO and be unshipped.
- POST `/losses`: `{expectedVersion,expectedGenealogyVersion,losses:[{receiptId,quantity,uom,reason}],reason,idempotencyKey}`. Replace the complete current loss set, max20 unique sources; empty clears it. Positive exact quantities, each reason 3..500. Losses represent explicit process scrap/unattributed-to-output consumption, never fabricated output units. Zero-good output finalizes only after all consumed material is explicitly reconciled as loss.
- POST `/finalize`: `{expectedVersion,expectedGenealogyVersion,reason,idempotencyKey}`. Require QC_COMPLETED, a DRAFT head, exact per-unit ratios and source conservation including losses, and no active source holds. Append a COMPLETE immutable revision. No automatic losses or residual rounding.
- GET `/revisions?limit=25&cursor=<UUID>`: `{data: metadata[],page:{limit,nextCursor}}`, max100, UUID ordering consistent with existing pagination. Metadata `{_id,revision,status,contentHash,recordedBy,recordedAt,reason}`; no claim chronological cursor order. GET `/revisions/:revision` returns the immutable full snapshot for a positive integer revision.
- GET `/api/manufacturing/genealogy/receipts/:id?limit=25&cursor=<UUID>`: current effective per-unit allocation lookup, standard pagination and scoped receipt concealment. Each row identifies workOrderId, outputUnitId, serial, receiptId, quantity, uom, materialTrace and current revision. Historical full snapshots remain available through revision reads.

Current view fields:

```text
workOrderId, required, workOrderVersion, version, currentRevision,
status: UNRECORDED|DRAFT|COMPLETE|FROZEN,
allocations:[{outputUnitId,serial,receiptId,quantity,uom,movementId,materialTrace}],
losses:[{receiptId,quantity,uom,reason,movementId,materialTrace}],
sources:[{receiptId,quantityPerUnit,consumedQuantity,uom,movementId,materialTrace}],
units:[{_id,serial,status}],
balances:[{receiptId,consumedQuantity,allocatedQuantity,lossQuantity,remainingQuantity,uom}],
incompleteUnits:[{outputUnitId,receiptId,requiredQuantity,allocatedQuantity}],
sourceHolds:[{receiptId,holdIds,reasonCodes,legacy}],
canFinalize,
frozen: null|{revision,contentHash,firstShipmentId}
```

`canFinalize` is derived state readiness, not a replacement for capability checks. No unbounded history embedded in this view. Sources and units may be empty before output exists; UI shows the actual waiting state.

## Whole-receipt holds and shipment integration

Existing holds cover whole receipts, not partial lot/serial quantities. Later source holds do NOT suppress valid historical attribution. Genealogy read exposes current blocking receipt IDs/reasons, including consumed/QC-completed WOs omitted by the legacy stockExceptions projection. No historical stock quantity is reversed.

Every fresh finalization and every fresh opted-in shipment, including later shipments after FROZEN, calls the authoritative hold check and performs a real `$inc: {genealogyFence: 1}` write on EVERY source receipt in the SAME transaction. Match-count checks required. This shares the conflict document with hold apply/release, and retries must re-read authority. Do not substitute a no-op write or cached flag. Legacy/invalid hold forms stay fail-closed. Read-only views report holds without pretending to clear them.

K1 explicitly tightens the existing helper's inactive-cache edge case: if receipt.hold is present and non-null but fails validHoldCache, fresh finalize/ship rejects STOCK_ENCUMBERED and read exposes reasonCodes including INVALID_HOLD_CACHE with legacy=true. Absent/null hold is unset. Do not change global legacy stock-hold semantics; apply this additional guard only to opted-in K1 sources. Historical attribution remains recordable.

Provider exports `freezeShipmentGenealogy(db, wo, serials, shipmentId, session)` from genealogy.mjs. It validates a current COMPLETE/FROZEN head and immutable finalized snapshot, fences the head and WO, rechecks/writes all source receipts, sets the first frozen pointer when appropriate, and annotates selected unit records with the pointer. It returns `{workOrderId,revision,contentHash}`. Parent calls it in the existing WORK_ORDER shipment transaction before ACCEPTED→SHIPPED update. Shipment `sources[].genealogy`, SHIP stock movement genealogy and selected output-unit genealogy retain that SERVER-DERIVED pointer. Caller overrides remain outside the source allowlist. Do not change renderer schemas, issued PDFs, VAT arithmetic or invoice entitlement.

## Error and acceptance boundary

400 malformed body/version/quantity/pagination and `INVALID_GENEALOGY`; 403 existing scoped denial; 404 concealed foreign/missing resource. 409 codes: VERSION_CONFLICT, GENEALOGY_VERSION_CONFLICT, GENEALOGY_NOT_REQUIRED, GENEALOGY_SOURCE_INVALID, GENEALOGY_QUANTITY_CONFLICT, GENEALOGY_INCOMPLETE, GENEALOGY_FROZEN, STATE_CONFLICT, STOCK_ENCUMBERED and existing IDEMPOTENCY_CONFLICT. Invalid missing material lot metadata during required release uses MATERIAL_TRACE_REQUIRED (409). Size limit remains32kb; per-unit commands avoid expanding the global request limit.

Owner HTTP and independent probes must cover ten units/WO6/4/five sources with per-unit ratios1/1/1/2/1, exact losses and zero-good, missing/foreign/changed-source inputs, globally balanced uneven attribution, aggregate/correction concurrency, rollback, stale WO/head fences, fresh/replay revocation, effective reverse tracing and immutable revision history. Later holds allow attribution but block fresh finalize/ship, visibly recover after release, and race safely against finalize and shipment. First shipment freezes all corrections; second shipment still rechecks holds and retains the identical pointer. Verify original stock counters and MATERIAL_CONSUMED counts are unchanged by attribution.

Connected browser adds GENEALOGY to the nine existing switches, uses native per-unit quantities/losses/finalize and real authenticated shipment, reload/recovery/revocation plus actual Mongo assertions. No fabricated fixture genealogy, test assertion weakening, shared database, broker/cloud/live-provider action or full E01/K2 acceptance. Heavy execution sequential: provider API, lead maintained API, independent probe, browser, then final source audit.
