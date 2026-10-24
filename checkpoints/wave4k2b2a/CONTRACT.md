# K2b2a inventory master and internal production planning

Frozen implementation contract 2026-10-25. Baseline cfb1b98; only worktree manufacturing-internal-planning. This increment creates master and planning evidence, NOT execution, finished outputs, stock availability, issue, manufactured installation or accounting valuation. No synthetic SO, customer account or acceptance. Existing runtime cohorts retain their contracts.

## Master authority

Items have immutable canonical code and content revisions `{description,uom,kind:PURCHASED|MANUFACTURED}`. Codes are uppercase ASCII `[A-Z][A-Z0-9_-]{0,39}`, scoped unique tenant+plant; lowercase is rejected, not silently normalized. UOM uses existing uppercase1..16 syntax. Description trimmed1..200. Create ->DRAFT revision1; `/revisions` appends immutable revision and resets DRAFT; `/approve` approves only current DRAFT revision; `/deactivate` enters terminal INACTIVE. No reactivation/code reuse. Only current APPROVED revision is eligible for fresh plan/engineering approval. New revisions/deactivation add live blockers to old plans without rewriting frozen history. Max100 revisions.

Company locations reference an actual existing warehouseBins UUID, with a separate unique code and independent qualification. Owner legal entity is derived from active authenticated selected plant INSIDE the committing guarded transaction; never caller authority. Create DRAFT ->QUALIFIED ->INACTIVE; INACTIVE is terminal and requalification unsupported in this slice. One profile per scoped bin, no code/bin rebinding or reuse. Raw bin ID/version/code/scope and separate qualification evidence must validate. Existing text locations/bin existence alone are not qualification or stock ownership proof. Item and location owners must match the current plant owner.

Every head version has a separate immutable authority event/snapshot/hash. Content revisions are separate immutable documents with hashes. Head status/version/references must agree with those records on read and use; head labels alone cannot establish approval. All source uses perform real master-document use-fence writes; location create/qualify/use writes the raw bin conflict document too. Deactivation/revision and source use therefore serialize. Qualified location is planning authority only, no available-stock figure.

## Internal planning

Separate internalProductionOrders, never manufacturingWorkOrders. Purpose INTERNAL_STOCK and schema INTERNAL_PLAN_V1 assigned server-side. Planning output requires real current APPROVED MANUFACTURED item revision, QUALIFIED company location and exact integral target quantity1..100. Order starts PLANNED; optional cancel enters terminal CANCELLED. No execution endpoint. No caller SO/account/owner/origin fields.

Engineering content revisions contain1..20 unique operations `{code,instruction}` and1..20 unique material ITEM_REQUIREMENT lines referencing current APPROVED item revisions, exact source UOM and positive decimal quantityPerUnit <=6 fraction digits. No direct stock/receipt/output references. Child item cannot equal output item; no general BOM cycle acceptance. Server assigns stable lineId per item across revisions and copies approved item snapshots. Required material quantity is exact target*ratio, rejecting inexact/overflow beyond existing18 integer/6 fraction quantity bounds. Immutable typed requirements are planning demand, not reserved/consumed stock.

Engineering states UNRECORDED ->DRAFT ->APPROVED_DEMAND; new revision resets DRAFT; `/revoke` enters REVOKED for current approved demand, preserving history. Max100 revisions. Order remains PLANNED. Approval revalidates exact captured master versions/current revisions/location and uses live fences. A master change never silently rebinds an old order or draft; show blockers and require a new order/draft where relevant. Reapproval/rebinding beyond a new engineering revision or new order is outside this slice.

APPROVED_DEMAND is approval before future execution release, not an execution RELEASED state. Always expose `execution:'NOT_IMPLEMENTED',canExecute:false`. `planningReady` indicates current approved planning dependencies and APPROVED_DEMAND only; separate from capabilities. Master lifecycle changes preserve old content/snapshots but readiness becomes false.

## Authorization and transactions

Actions: master.read, master.item.write, master.item.approve, master.item.deactivate, master.location.write, master.location.qualify, master.location.deactivate; internal.read, internal.plan, internal.engineering.write, internal.engineering.approve, internal.engineering.revoke, internal.cancel. Roles masterReader, masterItemWriter/Approver/Deactivator, masterLocationWriter/Qualifier/Deactivator and internalReader/Planner/Engineer/Approver/Revoker/Canceller grant read plus named action; owner gets all explicitly. No legacy role expansion. These capability boundaries are not separation of persons; one human may hold multiple roles.

Mutations require body expectedVersion>=1, idempotencyKey existing8..100 pattern, reason trimmed3..500. Creation expectedVersion1. New shared scoped internalPlanningKeys hashes kind+resource+canonical full body; changed payload/kind/resource conflicts. Committing auth fences precede replay. Head/order/source writes, immutable revision/event, audit/outbox and key commit atomically; failed commands retain no domain effects. Exact authorized replay returns acknowledged response, even after dependencies change. Global32kb unchanged. Reads scoped snapshot transactions; standard UUID pagination max100, not chronological UUID order.

## Wire

Standard `{data}`. Item and location mutations return current head view; internal mutations return order view. Every mutation includes common expectedVersion/reason/idempotencyKey.

`/api/inventory-master/items` GET/POST; create adds `{code,description,uom,kind}`. GET `/:id`; POST `/:id/revisions` adds `{description,uom,kind}`; POST `/:id/approve` adds `{revision}`; POST `/:id/deactivate` common only. GET `/:id/revisions` metadata and `/:id/revisions/:revision` full immutable content; GET `/:id/events`.

`/api/inventory-master/locations` GET/POST; create adds `{code,binId}`. GET `/:id`; POST `/:id/qualify` or `/:id/deactivate` common only; GET `/:id/events`. No location content editing/requalify endpoint.

`/api/internal-production/orders` GET/POST; create adds `{itemId,itemRevision,expectedItemVersion,locationId,expectedLocationVersion,quantity}`. GET `/:id`; POST `/:id/cancel` common only. POST `/:id/engineering/revisions` adds `{operations,materials:[{itemId,itemRevision,expectedItemVersion,quantityPerUnit,uom}]}`; POST `/:id/engineering/approve` or `/revoke` adds `{revision}`. GET `/:id/engineering/revisions` metadata and `/:id/engineering/revisions/:revision`; GET `/:id/events`.

Item view:
```text
_id,tenantId,plantId,ownerLegalEntityId,version,code,status,currentRevision,
content:{description,uom,kind},contentHash,approval:null|{revision,contentHash,approvedBy,approvedAt},
authorityHash,blockers:[code]
```
Location view:
```text
_id,tenantId,plantId,ownerLegalEntityId,version,code,binId,
binSnapshot:{_id,version,code},status,qualification:null|{qualifiedBy,qualifiedAt},
authorityHash,blockers:[code]
```
Order view:
```text
_id,tenantId,plantId,ownerLegalEntityId,version,purpose:INTERNAL_STOCK,schema:INTERNAL_PLAN_V1,
status:PLANNED|CANCELLED,quantity,itemSnapshot:<item view frozen at create>,
locationSnapshot:<location view frozen at create>,
engineering:{status:UNRECORDED|DRAFT|APPROVED_DEMAND|REVOKED,currentRevision,
             contentHash:null|string,content:null|{operations,materials},
             approval:null|{revision,contentHash,approvedBy,approvedAt}},
authorityHash,blockers:[code],planningReady,execution:NOT_IMPLEMENTED,canExecute:false
```
Engineering materials expose `{lineId,sourceKind:ITEM_REQUIREMENT,itemId,itemRevision,itemVersion,itemSnapshot,quantityPerUnit,requiredQuantity,uom}`. Approved snapshots/hashes are server-derived, caller overrides refused. Revision metadata `{_id,revision,contentHash,recordedBy,recordedAt,reason}`; full records add immutable content and source identity. Events `{_id,subjectType:ITEM|LOCATION|ORDER,subjectId,version,kind,status,contentHash,reason,recordedBy,recordedAt,snapshot}`; exact event current head references checked. No unbounded embedded history arrays.

Errors400 INVALID_MASTER/INVALID_INTERNAL_PLAN plus existing unknown-field/version/key/pagination;403/404 scoped denial/concealment;409 VERSION_CONFLICT, REVISION_CONFLICT, STATE_CONFLICT, MASTER_CONFLICT, MASTER_SOURCE_INVALID, MASTER_NOT_APPROVED, LOCATION_NOT_QUALIFIED, INTERNAL_DEPENDENCY_CHANGED and IDEMPOTENCY_CONFLICT. Views expose live blocker codes ITEM_NOT_APPROVED/ITEM_CHANGED/LOCATION_NOT_QUALIFIED/LOCATION_CHANGED/MATERIAL_CHANGED/OWNER_MISMATCH/ORDER_CANCELLED/ENGINEERING_NOT_APPROVED. Corrupt authority fails closed instead of claiming readiness.

Acceptance: real master creation/approval/qualification, native internal planning and versioned engineering approval/revocation/cancel; source deactivation/revision races; owner derivation/scope; stale/replay/revocation; immutable history/hash/head corruption; exact quantities/UOM; rollback; and negative unchanged snapshots of all commercial/fulfillment/manufacturing stock/output collections. No execution/stock/manufactured graph acceptance implied.
