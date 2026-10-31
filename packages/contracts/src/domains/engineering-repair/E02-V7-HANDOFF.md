# E02 v7 source handoff — runtime INCOMPLETE

Base `19561749dbac890a4adfe192f3424996ff86d21e` retains required `576a947d623ee12561d0a7819eb4bd3645021eba`. Only allocated domain, bounded delivery adapter, existing repair UI and owned helper/contracts changed. The prior clock/VAT failure is corrected in source; actual domain HTTP verification is currently blocked at startup by the existing source admission pin. No pin, registry, host constructor, receipt wrapper, canonical fixture, stock authority or other worktree is edited.

## Typed contract

- Intake optionally supplies `serviceProfile: REPAIR_SERVICE_V1`; new UI intake selects it. Server generates `assetId`, bound to the case/account/serial, never an inventory item. Omitted profile preserves legacy case behavior.
- `POST /api/repair/cases/:id/orders` takes existing expectedVersion/idempotencyKey/evidence. Accepted/rejected decision creates reciprocal `repairSalesOrders` REPAIR_SERVICE and `repairWorkOrders` REPAIR. Rejected orders are CANCELLED-before-release. Accepted start requires AUTHORIZED service WO; execute/test/rework/QC update its versioned activities, tests/reworks have actual UUIDs. Dispatch fulfills accepted service SO. New GET/list resources: `/api/repair/sales-orders[/:id]`, `/api/repair/work-orders[/:id]`. The case exposes typed IDs/hashes, and existing UI reads the actual records inline without new UI routes.
- Approved scope validates immutable quote approval equality, original currency/line/net/tax/gross and supported policy. Scope/decision expiry uses `businessNow`; audit timestamps remain recording time. Diagnostic fee is NET capped at1200, deriving132 VAT/1332 gross. FINAL copies9000/990/9990 and applies actual3000 deposit once; existing settle takes6990. Both existing BigInt fixture tax/rounding and NO_TAX remain supported. Fixture VAT is synthetic.
- Typed `return` takes shipmentMode (`CUSTOMER_ASSET_RETURN` or rejected `RETURN_UNREPAIRED`), carrier/reference/packaging/uom/evidence. It creates one `fulfillmentShipments` row and `repairReturnAuthorities` immutable proof, with `sourceKind: CUSTOMER_ASSET_RETURN`, real case/asset/serial/repair SO/WO/account/entity, quantity1 and exact scope UOM. No fake generic SO, manufactured WO or stock sources/movements. Persisted case custody means DISPATCHED; the existing delivery view derives confirmed RETURNED custody from real deliveryHeads/Confirmations/Events. Legacy return records stay legacy.
- Existing delivery `/confirmations` writes POD. Only delivery import/source()/view() and narrow generic returns() rejection changed. The adapter validates immutable shipment hash, scoped reciprocal case/service orders/QC or cancellation/asset/account/UOM, fences case/current quality, and returns the established shipment/serials/sourceHash contract. Generic customer-property stock return is explicitly unsupported.
- Typed warranty requires `profile: POD_CALENDAR_MONTHS_V1`, repairWorkOrderId/invoiceId/shipmentId/confirmationId/coverageMonths/operatingHoursLimit/terms/evidence. It validates completed accepted WO, actual FINAL invoice and confirmed POD for the same customer asset, fences current sources, and saves typed IDs plus immutable snapshots/hashes.12months/2500hours from June2 2026 11:00 yields June2 2027 23:59:59 UTC. Short-month anniversaries clamp. No hour reading is invented; claims check a supplied reading against coverage. Typed warranty claims preserve the asset/profile into new intake. Legacy days warranties remain available only to legacy cases.

Mongo initialization adds scoped unique case indexes on repairSalesOrders/repairWorkOrders, unique order/version on repairOrderRevisions, and unique case/shipment on repairReturnAuthorities. These are service/dispatch authority and history records, not balances or a second POD ledger. No user-data DDL execution.

## Required integration-owner actions (not worker-owned)

The attempted bounded owned Mongo/HTTP test failed in `initialize()` before any scenario request:

```text
SAAS_HOST_SOURCE_CHANGED (503)
verifyAdmissionSources packages/tenant-lifecycle/admission-registry.mjs:16
initialize apps/portfolio-api/src/app.mjs:84
startOwned apps/portfolio-api/test/support/owned-mongo.mjs:18
```

CTO149 must integrate domain commits once, then TPR-148 admission changes sequentially, preserving both named hunks. TPR-148/149 regenerate source/schema/domain/admission registry and pins from the **actual final source**, including the four new collections and new `orders`/read routes. Never copy old hashes, disable the verifier or patch an in-memory import to run this smoke. Worker has deliberately left all pins unchanged.

Also wire the new typed source into existing replay boundaries, owned only by TPR-148:

1. `repair.mjs` tx prior-receipt branch currently rechecks domain sources only for `spare-*`. Sensitive typed service/order/return/warranty replay must load the **current scoped case** and call exported `recheckRepairServiceSources(db,filter,row,session)` from repair-return.mjs (and existing canonical repair stock-source recheck where applicable), before returning the stored result. It validates orders/holds/dispatch/POD and frozen warranty invoice/WO/POD proof; it does not create another receipt or charge. Keep cleanup/release behavior and old results/hashes intact. Invoice receipt IDs need resolution to case IDs through the existing scoped invoice, never caller-supplied mappings.
2. `delivery.mjs` confirmation prior-receipt branch's `typed` detection currently includes purchased/quoteCatalog orders only. Include actual persisted CUSTOMER_ASSET_RETURN/repair-return authority in the existing source/state/historical-event/view replay verification. Customer property has no generic salesOrderId. Preserve standard delivery receipt/state/quantity writers and source tamper rejection.

These are exact excluded wrapper hunks; no worker copy of the wrapper or temporary pin bypass was made. Current code must not be described as replay-complete until those integration changes are present and exercised.

## Runner and evidence

`runE02Prefix` assembles canonical intake through actual approved R2 scope. `runE02Flow(h,{setClock,onCheckpoint})` continues accepted deposit/service orders, real approved catalog seal-kit SET and backup-ring UN receipts, reserve/issue/install/removal quarantine, failed test/rework/retest/QC, actual dispatch/POD, FINAL/VAT/deposit/settlement/warranty, then an isolated rejected variant. It reuses companyOwnerFixture's qualified location/provisioning pattern; unrelated supplemental company source is explicitly labeled, never mapped to customer asset. Runtime IDs are generated and mapped in returned manifests, with actual source/material/claim/removal/test/rework/invoice/payment/warranty hashes/references. Original fixture byte SHA256 remains `6baee7beb75983827bd40f0064618af35b41e96ea6eba4ef3cb68dfdaba49d48`.

Limitations are explicit: a synthetic authenticated owner records fixture technician/inspector evidence; no verified personnel identity or independent QC is claimed. Calibration/qualification and missing backup-ring lot are supplemental synthetic evidence. Rework ring attribution uses the approved parent seal-kit component slot; the original kit stays consumed. The rejection invoice is atomic with its decision; original May16 invoice date is not presented as a separate persisted issuance transition. No carrier/bank/hardware verification.

On any domain rejection the prefix/accepted runner records an actual request/response gap; COMPLETE is assigned only after both API chains return successfully. Source assembly alone does not create a successful manifest. Full-chain test now requires actual completion and exact dates/totals/typed identities/conservation/replay; it no longer treats the old409 reproducer as success.

Checks in this worker: API syntax and node syntax PASS; pure VAT calculation PASS; POD calendar/transaction guard unit PASS1/1; web build PASS (existing bundle/Browserslist warnings); mechanical UI detector `[]`. Owned service-orders test had1unit PASS and1runtime FAIL (startup source pin), exit1. New full-chain HTTP test and rendered UI NOT_RUN after that same blocking condition; no repeated failing startup attempts. These are implementation checks, never independent final QA. Runtime used cached Mongo7.0.14, runtime download disabled, randomized marker-owned DB with guarded cleanup; no application credentials. No mongod remained after cleanup.

After actual pin/replay integration, resume owner142 in the same worktree on the supplied usable base and run:

```powershell
$env:MONGOMS_SYSTEM_BINARY='C:/Users/Admin/.cache/mongodb-binaries/mongod-x64-win32-7.0.14.exe'
$env:MONGOMS_RUNTIME_DOWNLOAD='false'
node --test --test-concurrency=1 packages/contracts/src/domains/engineering-repair/service-orders.test.mjs packages/contracts/src/domains/engineering-repair/pod-warranty.test.mjs apps/portfolio-api/test/review-e02-full-chain.test.mjs
```

Inspect actual accepted/rejected identities/hashes and denial/abort/source-hold/replay results; repair source defects within allocated hunks and repeat affected checks. E02 remains **INCOMPLETE**, with runtime correction/verification pending. Final independent QA remains TPR-150 then TPR-152 after immutable CTO149 integration. No push/deploy/production/data migration authority.
