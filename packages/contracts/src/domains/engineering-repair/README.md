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
One removed slot per case is supported at this milestone; later replacement
lineage must supply actual issued source proof before further removal cycles.

Manufacturing prerequisite tip 693a129f04038188b0d1f52bbef6b91a0d001708 was
fast-forwarded without conflict from accepted base 0ad4248. Its stock validators
require internal execution authority for issued/consumed claims. Repair adapter
implementation requires the bounded CTO ownership amendment requested on TPR-142;
do not insert repair claims as internal executions or add another stock ledger.
