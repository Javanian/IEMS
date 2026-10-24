# K2b1 received component installation evidence

Frozen 2026-10-24, baseline f2d6f4a, worktree manufacturing-serial-installation. Received CONSUMED components are leaf identities; manufactured children, inventory transfers, ancestry/cycle acceptance, replacement, rework and return-to-stock remain outside this increment. Canonical E01 receives no invented serials.

## Opt-in and authority

Planning optionally accepts boolean installationRequired. True requires serialCustodyRequired, genealogyRequired and serialized, with existing100-output/20-source/100-identities-per-source limits. False/omitted preserves existing cohorts and omits the flag. Dedicated actions installation.read/record/finalize/remove and roles installationReader/Recorder/Finalizer/Remover include manufacturing.read, installation.read and their named capability only; existing grants do not expand.

Inventory units and claims remain CONSUMED. Installation records a separate disposition and source-unit version fence, with no stock quantity or claim quantity change. Every source must belong to this WO's exact consumed claim/routing and matching MATERIAL_RESERVED/MATERIAL_CONSUMED evidence, registry, UOM, ratio and trace. Parents are real output units from the same WO, QUARANTINED/ACCEPTED/REJECTED; SHIPPED or genealogy-frozen parents are denied. Only received identities are accepted, never caller child types or manufactured IDs.

Record commands represent operator-recorded historical evidence and remain allowed under a later source hold. Finalization and every fresh shipment check strict authoritative whole-receipt holds, including malformed caches, and perform a real receipt write in the same transaction. Old authorized replay returns stored acknowledged evidence without repeating current hold checks.

## Append-only dispositions

Record is ADD-ONLY. A child with any existing installation/loss/removal disposition cannot be assigned again. Per-parent/source installed count cannot exceed the released ratio or its current K1 per-unit allocation. Explicit loss is also ADD-ONLY and permanent; loss identities cannot be installed or removed from loss later. Loss count cannot exceed current K1 process-loss quantity for the receipt. No auto distribution or inferred loss.

Remove records an existing active edge as REMOVED_QUARANTINE, permanently retires its received identity, retains its original parent/source and appends immutable evidence. This leaves normal genealogy incomplete: any removed identity blocks COMPLETE/fresh shipment until a future separately authorized rework policy. It never counts automatically as process loss or returns to availability. No replacement/spare authority is invented.

Every record/loss/remove/finalize creates an immutable full revision plus immutable event; current head contains bounded metadata only. Current dispositions are unique by scoped childType/childId, including retired identities. Every mutation and fresh shipment performs a real increment of one scoped graph revision document, plus WO/head CAS and selected unit CAS. This serializes graph writes, but received-only leaf typing prevents ancestry cycles by construction; no general cycle-prevention acceptance is claimed.

Finalization requires QC_COMPLETED, DRAFT installation head, current validated K1 COMPLETE revision/hash, exact per-parent ratios and per-receipt K1 allocations/losses, every consumed identity assigned exactly once to active installation or explicit process loss, and no retired identities. COMPLETE snapshot stores K1 revision/hash and canonical effective allocation/loss/source hash. Later K1 correction makes installation unready until explicitly re-finalized against the new complete source. Re-finalize may start from COMPLETE when K1 changed, preserving older revisions. First shipment freezes the WHOLE installation head; no mutation then. Subsequent shipments retain the identical pointer and recheck holds. K1 and installation freeze operate in the same fulfillment transaction; lead re-reads latest WO after K1 freeze before calling installation helper.

## HTTP wire

Base `/api/manufacturing/work-orders/:id/installations`; standard scoped `{data}` envelopes. Unknown fields refused; UUID validation; global32kb unchanged. Every mutation includes `{expectedVersion:<WO>,expectedInstallationVersion:<head,0 allowed>,reason:<trimmed3..500>,idempotencyKey}`. Existing committing manufacturing authorization guard precedes durable replay. Head starts absent version0/revision0/UNRECORDED. Each accepted mutation increments WO.version/head.version/currentRevision and scoped graph revision; rejected commands retain no effects.

- GET base returns view below. Non-required WOs return honest UNRECORDED with required=false and no synthetic adoption.
- POST `/record`: common fields plus `{outputUnitId,components:[{serialUnitId,expectedUnitVersion}]}`;1..100 unique children; add edges to the specified parent. Each child must be unassigned CONSUMED, expected source-unit version current. Bounds/ratios are checked across prior active edges plus this addition.
- POST `/losses`: common fields plus `{components:[{serialUnitId,expectedUnitVersion}]}`;1..100 unique children. Append explicit process-loss dispositions within current K1 loss quantities.
- POST `/remove`: common fields plus `{edgeId,expectedEdgeVersion,expectedUnitVersion}`. Only ACTIVE edge, permanently REMOVED_QUARANTINE. No evidence correction or physical replacement shortcut.
- POST `/finalize`: common fields only. No implicit edges/losses.
- GET `/revisions?limit=25&cursor=<UUID>` metadata `{_id,revision,status,contentHash,recordedBy,recordedAt,reason}`, standard page/max100. UUID ordering is not chronology.
- GET `/revisions/:revision` returns immutable full revision for positive integer revision.
- GET `/events?limit=25&cursor=<UUID>` immutable scoped events and standard page/max100.

View:

```text
workOrderId,required,workOrderVersion,version,currentRevision,
status:UNRECORDED|DRAFT|COMPLETE|FROZEN,graphVersion,
k1:{version,currentRevision,status,contentHash,effectiveHash},
sources:[{receiptId,quantityPerUnit,consumedQuantity,uom,movementId,materialTrace}],
parents:[{_id,serial,status}],
components:[{_id,version,serial,receiptId,claimId,uom,status:CONSUMED,
             materialTrace,disposition:null|ACTIVE|PROCESS_LOSS|REMOVED_QUARANTINE,
             edgeId:null|UUID,outputUnitId:null|UUID}],
edges:[{_id,version,childType:RECEIVED,childId,serial,outputUnitId,
        receiptId,claimId,uom,movementId,materialTrace,status:ACTIVE|REMOVED_QUARANTINE}],
losses:[{_id,version,childType:RECEIVED,childId,serial,receiptId,claimId,
         uom,movementId,materialTrace,status:PROCESS_LOSS}],
incompleteParents:[{outputUnitId,receiptId,requiredQuantity,installedQuantity}],
balances:[{receiptId,consumedQuantity,installedQuantity,lossQuantity,
           removedQuantity,unassignedQuantity,uom}],
sourceHolds:[{receiptId,holdIds,reasonCodes,legacy}],
canFinalize,blockers:[code],
frozen:null|{revision,contentHash,firstShipmentId}
```

Components expose live source-unit version for exact command capture. Add/remove/loss changes also update source-unit installation pointer and version while keeping CONSUMED. Snapshot reads use one database transaction. Immutable event fields `{_id,workOrderId,kind:RECORDED|LOSSES_RECORDED|REMOVED|FINALIZED,revision,graphVersion,outputUnitId?,componentIds,edgeId?,reason,recordedBy,recordedAt}`. Full revisions contain edges/losses/sources/K1 binding and hash, not unbounded embedded history.

Errors400 INVALID_INSTALLATION plus existing version/key/pagination;403/404 scoped denial/concealment;409 VERSION_CONFLICT, INSTALLATION_VERSION_CONFLICT, INSTALLATION_NOT_REQUIRED, INSTALLATION_SOURCE_INVALID, INSTALLATION_QUANTITY_CONFLICT, INSTALLATION_CHILD_UNAVAILABLE, INSTALLATION_INCOMPLETE, INSTALLATION_FROZEN, STOCK_ENCUMBERED and existing IDEMPOTENCY_CONFLICT. A removed identity is never eligible again.

Provider exports initializeComponentInstallation, installationActions/Roles, installComponentInstallation and freezeShipmentInstallation(db,wo,serials,shipmentId,session). Freeze returns `{workOrderId,revision,contentHash}` for server-derived shipment source/movement/output-unit installation pointers. It accepts K1 COMPLETE or FROZEN only when current revision/hash/effective evidence matches the finalized installation snapshot. Lead calls after K1 freeze with freshly re-read WO. No renderer, tax or financial entitlement changes.

Acceptance includes ratios1/2, explicit losses/zero-good, same-WO competing parents, retired/lost identity reuse refusal, source version/corruption checks, stale/replay/revocation, rollback, hold/finalize/ship races, K1 correction invalidation, first-shipment freezing, scoped history and native UI. General manufactured graph/cycles and replacement remain open.
