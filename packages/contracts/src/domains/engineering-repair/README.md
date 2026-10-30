# Repair and quality contracts

Implementation handoff; independent acceptance is deferred to TPR-150/152.

## PLAT-013 warranty

Existing intake, diagnostic authorization, teardown, quote snapshot/decision,
deposit, execution, test/rework, QC, return, diagnostic/final invoice and settlement
contracts are preserved. New commands share the existing transaction, actor guard,
CAS, scoped idempotency, audit and outbox. All paths start `/api/repair/cases/:id`.

| Command | Additional body | Result |
| --- | --- | --- |
| `warranty` | days integer 1..3650, terms, evidence | One warranty on an accepted, QC released, returned case; UTC period begins at persisted custody return |
| `warranty-claim` | condition, evidence | Linked INTAKE case retaining customer, serial, currency and frozen warranty terms; parent response includes warrantyClaims with new case ID |
| `warranty-void` | evidence | Stops future claims; historical claims/terms preserved |

All commands require `expectedVersion` and `idempotencyKey`. Permissions are
`repair.warranty`, `repair.warranty-claim`, `repair.warranty-void` respectively;
generated roles include read plus their command. Replay reauthorizes and returns
the original result without creating another claim. Expired/void warranties fail
closed. Rejected repair scopes cannot receive warranty. Claims remain subject to
diagnosis and an approved scope; receipt alone does not authorize free work.
Historical returned cases without a recorded returnedAt cannot invent a warranty
start date. UTC business clock is used for new returns and expiry checks.

## PLAT-014 quality and maintenance

Mounted through the owned repair installer; no shared router/role manifest edits.
Quality/maintenance action arrays and roles are included in repair exports so the
existing app registration grants owner permissions and recognizes specialist roles.
UI entry points are `/portfolio/repair/cases?workspace=quality` and
`?workspace=maintenance`, linked from the repair navigation with read permissions.
The shared UI tokens, Field/Table/RecordShell and server resources are used.

Quality root `/api/repair/quality`:

- GET `/resources` (25 rows with cursor), GET `/resources/:type/:id`.
- POST `/resources/:type/:id/configure` label, disabled boolean.
- POST `.../hold` reasonCode; POST `.../release` holdId. Independent active holds
  require explicit individual releases. Bounded 100 hold-history entries.
- POST `.../calibrate` equipment certificate, validFrom, validUntil UTC ISO.
- POST `.../qualify` operator operation, active boolean, validFrom, validUntil.
  Operator must belong to this plant/tenant. Bounded 100 operation qualifications.
- All mutations require expectedVersion (0 for a new resource), evidence and
  idempotencyKey. Action permissions `quality.read/configure/hold/release/calibrate/qualify`.
- Resource types: REPAIR_CASE, WORK_ORDER, COMPANY_UNIT, RECEIPT, EQUIPMENT,
  OPERATOR. Types and scope form distinct deterministic gate identities; same
  UUID in a different tenant/plant/type has independent state. Business targets
  must exist when quality mutations are recorded. Equipment is registered here.

Maintenance root `/api/repair/maintenance/equipment/:id`:

- GET head, GET `/capacity?from=...&until=...`.
- POST `/schedule` from, until (canonical UTC whole minute), kind
  PREVENTIVE/CORRECTIVE/CALIBRATION. POST `/start`, `/complete`, `/cancel`
  with windowId. Mutations require expectedVersion, evidence, idempotencyKey.
- Registered equipment required. Cancel only before a planned window starts;
  complete records actual end rounded up to the minute. Overlapping windows
  count once. Active overdue work remains unavailable until completion.
- Disabled or held equipment has zero capacity. Capacity strings are exact whole
  minutes (MIN); interval <=366 days, history <=100 windows. No booking ledger is
  implied. Existing capacity/scheduling owner must conserve bookings separately.

### Transaction consumers (fulfillment/production owner)

`requireQualityGates(db, scopedFilter, targets, session, {at})` from quality.mjs
requires an active caller effect transaction. Each target has resourceType,
resourceId, optional expectedVersion, requireCalibration, operation. It rejects
holds, disabled state, expired/not-yet-valid calibration or qualification. It
fences even absent gate heads so a concurrent first hold cannot miss the use.
Returns resource/version pointers. Caller must authorize its operation, validate
the actual domain sources and supply every applicable target; an empty set does
not discover shipment sources. Include WORK_ORDER plus each COMPANY_UNIT/RECEIPT
and relevant equipment/operator for shipment. Preserve existing stock/genealogy
holds too. This helper is not stock authority and must run in the same transaction
as shipment/custody/result/audit/outbox, including replay source checks.

`maintenanceCapacity(db, scopedFilter, equipmentId, {from,until}, session,
{fence})` returns equipmentVersion/maintenanceVersion and exact available minutes.
`requireMaintenanceCapacity(..., {from,until,requiredMinutes,expectedVersion?},
session)` additionally requires current calibration covering the interval and
sufficient capacity; it fences equipment and maintenance heads. It does not
reserve capacity: caller scheduling authority must deduct existing bookings.

Repair start/execute/test/rework/QC/return and warranty receipt now check case
quality holds transactionally. Optional `test-plan` command (equipmentId,
operation, evidence; `repair.test-plan`) fixes controlled testing requirements
before QC. Every controlled test validates calibrated equipment and the testing
actor's qualification, stores version pointers and plan; QC rechecks current
authority for that recorded test actor. Existing cases without a declared plan
retain the prior operator-evidence contract; they are not relabeled calibrated.

Fulfillment/production call-site integration is outside TPR-142 file ownership:
CTO/TPR-143 must wire these exports into its effect transactions. Until then,
shipment enforcement of these new gate records is NOT_YET_WIRED; do not claim a
standalone quality register blocks an existing shipment handler automatically.

## Component authority boundary

### Canonical spare/replacement flow (plan v4)

All commands are POST `/api/repair/cases/:id/{command}` with expectedVersion,
idempotencyKey and evidence. Active IN_PROGRESS/REWORK, accepted frozen scope and
current case quality authority are required. Parent CAS and canonical source head
CAS share one actor-guarded Mongo transaction with domain events, result, audit
and outbox. One material authorization per component per initial/rework run;
maximum 100 materials/claims/removal records. New intake policy
CANONICAL_SPARES_V1 requires physical replacement/removal evidence before closing
execution/rework/QC/return. Legacy undeclared cases keep their prior evidence
contract; adopting spare materials opts into conservation. Rejected scope still
returns unrepaired with its diagnostic invoice.

| Command | Additional body | Effect |
| --- | --- | --- |
| spare-authorize | component, sourceKind CATALOG_RECEIPT/COMPANY_OUTPUT, itemId, itemVersion, itemRevision, quantity, uom | Freeze approved current item/owner/UOM/max quantity on accepted REPLACE scope; REPAIR scope also permits explicitly authorized spare use during failed-test REWORK |
| spare-reserve | materialLineId, sourceId, expectedStockVersion, quantity; catalog expectedReceiptVersion; serial catalog serials; company units [{companyUnitId,expectedUnitVersion}] | Use canonical stock reservation and exact availability/serial eligibility, preserve purchased lot/heat or manufactured frozen graph |
| spare-release | materialLineId, reservationId, expectedReservationVersion, expectedStockVersion; catalog expectedReceiptVersion | Release RESERVED quantity through original stock head, even if source held |
| spare-issue | same revision/identity fields as release | Canonical reservation becomes ISSUED with original issue ledger proof |
| spare-install | same as issue plus removedComponentId | Consume ISSUED stock and link installed replacement to a unique removed component and source proof |

Serialized authorization and reservation are exactly one unit for one physical
component. Lot material keeps exact decimal quantity. Source-specific fields from
another cohort fail closed. Company allocations require corresponding
company.stock.read/reserve/issue permission inside the transaction; all spare
actions require catalog.stock.read. Generated repairSpare* roles include those
grants; authorizer also has master.read. The normal repair action grants remain
separate. UI selects actual approved items and source/serial records, derives
source revisions, and preserves uncertain command/key for explicit retry.

### Proof and writer contract

Repair claims use explicit authorityKind REPAIR_CASE, caseId, materialLineId,
authorizationHash, authorizedCaseVersion and effectCaseVersion. They have no
executionId or customer-fulfillment schema/demandKind. REPAIR_CASE dispatch
preserves all canonical hash chains, version limits, serial occupancy and stock
totals. Default/explicit INTERNAL_EXECUTION claims use the original proof path;
unknown or mixed authority kinds fail closed. Existing historic hashes and
internal ledger meanings are unchanged. Repair unit views expose caseId and
authorityKind instead of an invented execution identity.

`validateRepairStockClaim(db, filter, claim, session)` verifies the current
repair case/event/hash, immutable authorization event/item/owner/UOM/cycle,
effect event/ref/version/hash, and exact active-claim budget. Canonical validators
also check every reservation history, immutable binding, issues/consumptions,
quantities and source identities. `validateRepairMovement` ties the original
canonical issue/consumption to typed repair authority. `saveRepairStockAuthority`
persists immutable case snapshots, previous snapshot hash and current event pointer
for every subsequent case mutation. These are domain authority records, not stock
balances. No second inventory ledger is introduced.

`repairSpareCommand` uses writeCatalogReservation/writeCompanyReservation plus
canonical catalog/company issue and consumption collections. The writer extension is immutable repair binding comparison in writeCompanyReservation; catalog writer is reused unchanged. The company trace call site dispatches typed repair reads through buildRepairCompanyTrace; legacy traces without repair claims still use the original implementation. Case and source quality holds, current item,
location, approval, stock hold and ancestry gates are rechecked/fenced. Spare
replay reauthorizes actor and source permissions and rechecks current active
sources before returning the original key result. A new body conflicts with the
key; an ambiguous result is reconciled with that same key, with no manual blind
resend loop. Mongo transaction retries have no external side effects.

Manufactured sources freeze referenceType REPAIR before reservation, while the selected unit is AVAILABLE. First capture uses freezeManufacturedGraph; re-reservation/new repair references can reuse a retained canonical snapshot only after verifying its hash, tenant/plant, unit/output/serial/owner, producer identity and current attribution hash. Current source eligibility, stock/unit versions and holds are still validated/fenced. The original trace reader assumes internal-execution consumers, so reuse must not send a typed repair claim down that default path. That immutable snapshot
is retained even after release/removal and is not a claim that all retained
snapshots were installed. Actual installed lineage is the replacements array and
canonical CONSUMED claim. Rework removal checks the installed serial and captures
the previous replacement/source proof in repairReplacementRemovals; it does not
return the consumed source unit to stock. Original customer removals stay in
repairRemovedComponents, so existing unique keys and records need no migration.
Both custody cohorts share immutable repairComponentRevisions. QC freezes current
replacement lineage; all spare writes and further physical removal are closed
after QC/return. No source output, shipped genealogy or existing graph snapshot is
edited. A warranty claim creates a new linked case instead of reopening that graph.

Downstream TPR-143 must incorporate this commit before writing canonical company
or purchased stock. It must preserve REPAIR_CASE dispatch and the original proof
paths when adding its own authority kind. Keep legacy schema/hash behavior and
unknown-kind rejection. Gate integration remains exactly the PLAT-014 contract
above, inside real shipment transactions. No shared mount/manifest delta.

POST `/api/repair/cases/:id/component-remove` requires accepted scope and an
IN_PROGRESS/REWORK case; body component, serial (or identity mark), condition,
evidence, expectedVersion, idempotencyKey. Only the frozen REPLACE/SCRAP findings
authorize removal. Customer-owned component becomes QUARANTINED with stable ID,
case/customer/parent serial and scope revision lineage, in the same transaction
as case/result/audit/outbox. Duplicate removal of that slot is rejected.

POST `.../component-dispose` uses componentId, disposition RETURN_TO_CUSTOMER or
SCRAP, evidence, expectedVersion, idempotencyKey. Scrap requires frozen SCRAP
authority; replacement authorization alone cannot authorize scrapping customer
property. Both legacy case holds and new quality holds block these actions.
Separate `repair.component-remove` / `repair.component-dispose` permissions apply.
Case response includes current componentRemovals; immutable component revisions
retain original custody and disposition. UI forms are in the repair case.
No available stock or manufacturing execution is created for removed property.
Repeated removal is supported after a replacement is installed: its source claim, installed serial and immutable lineage are retained in a distinct customer custody record. A removed installed spare remains consumed in canonical company stock.

Manufacturing prerequisite tip 693a129f04038188b0d1f52bbef6b91a0d001708 was
fast-forwarded without conflict from accepted base 0ad4248. Its stock validators
require internal execution authority for issued/consumed claims. Plan v4 allocates bounded sequential REPAIR_CASE dispatch/proof in both validators and the company stock writer. The adapter now implements reserve, issue and installation through canonical stock; no repair is inserted as an internal execution.

### Required integration delta outside this issue ownership

The existing genealogy.mjs readManufacturedGraph function directly invokes the legacy buildCompanyUnitTrace. Its default consumer dispatch cannot read a unit with repair-use history. TPR-142 does not own genealogy.mjs and has not edited it. CTO/TPR-149 must replace that function's implementation with a delegate to exported readRepairManufacturedGraph from repair-stock.mjs, preserving its signature and caller options. No change to freezeManufacturedGraph writes or snapshot schema is needed:

```js
export async function readManufacturedGraph(db, filter, receiptId, unitId, session, options = {}) {
  const { readRepairManufacturedGraph } = await import('./repair-stock.mjs');
  return readRepairManufacturedGraph(db, filter, receiptId, unitId, session, options);
}
```

The adapter produces the identical MANUFACTURED_GRAPH_V1 snapshot/hash for unchanged ancestry; it preserves current source fences and uses the original trace path when there are no repair claims. Focused smoke compares its output hash with the retained pre-use snapshot after release/consume/rework removal. This is a concrete integration delta, not a completed source edit or a QA PASS for the unchanged legacy reader. TPR-143 must use this adapter until CTO applies the delegate, before dispatch/freezing units with repair history.

Company trace responses retain schema V1/V2 and add repairUsesVersion:1 and uses.repair containing typed case/component/cycle/installation/removal references. Repair UI renders that group. Existing company-stock UI still renders its original production categories; adding repair navigation there belongs to its owner. All existing internal-use categories are validated and retained in the repair-aware projection.
