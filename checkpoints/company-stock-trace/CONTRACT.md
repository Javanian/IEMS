# Company unit trace and reverse impact

Frozen wire, base `9ad677a`. This is a read-only P027/P029 precursor for the accepted V1-to-V2 company-stock cohort. K2B2-05/06 graph mutation, arbitrary-depth reuse, recall disposition and customer dispatch remain unimplemented. Existing V1/V2 plans, stock policies, quantities, permissions and commands are unchanged.

`GET /api/company-stock/receipts/:id/units/:unitId/trace` requires `company.stock.read`. Both IDs are actual UUIDs; unitId identifies an immutable `internalCompanyStockUnits` row belonging to the supplied company receipt. No request body or actor-supplied evidence is accepted. The endpoint reads a single snapshot transaction and performs no dependency, stock, key, audit, outbox or authorization-fence writes.

## Response

The ordinary response envelope is `{data: trace}`. Trace fields:

```text
schema: COMPANY_UNIT_TRACE_V1
companyReceiptId, companyUnitId, outputUnitId, serial, sourcePolicy
itemSnapshot, ownerLegalEntityId, locationSnapshot
current: {stockVersion,unitVersion,status,eligible,hold,blockers}
producer: {executionId,internalOrderId,schema,status,version,engineeringRevision,provenanceHash,qc}
ancestry: {basis: EXACT_OUTPUT_ATTRIBUTION,purchasedSources:[RawSource],companySources:[CompanyAncestor]}
holdPolicy: {basis: CONSERVATIVE_CONSUMED_BATCH,receiptIds:[raw receipt UUIDs],directHold}
uses: {reserved:[],issued:[],consumedUnattributed:[],outputs:[],losses:[],abandoned:[]}
completeness: {complete:true,oneGeneration:true,counts:{executions,companyReceipts,rawReceipts,outputUnits,useReservations}}
```

`RawSource` contains receiptId, quantity, uom, materialLineId, consumptionId, consumptionHash and originHash, with lotNumber/heatNumber when present and `serials` only for the exact serialized attribution subset. It does not substitute all received serials or the producer's total consumption for one output's actual allocation.

`CompanyAncestor` contains companyReceiptId, companyUnitId, outputUnitId, serial, quantity (`1`), producerExecutionId, provenanceHash and purchasedSources. Its exact selected upstream output's raw allocation is validated. A V2 terminal unit may be traced through this single upstream generation; this grants no further reuse.

Each use contains reservationId, reservationVersion, reservationStatus, materialLineId, reservationQuantity, selectedQuantity (`1`), consumer `{executionId,internalOrderId,schema,status,version,provenanceHash}`, and nullable issue/consumption pointers `{id,contentHash}`. Output uses additionally contain output `{outputUnitId,serial,status,qcDisposition,companyReceiptId,companyUnitId}`; QC disposition and company receipt/unit IDs are null until established. Loss uses additionally contain quantity (`1`). A consumed selected identity without a current output or process-loss allocation appears in consumedUnattributed. Abandoned claims appear only in abandoned, never in physical output ancestry. These states report evidence, not new dispatch or recall eligibility.

The hold-policy set is the conservative actually consumed producer-batch raw union, excluding abandoned raw history. It is intentionally distinct from exact selected-output raw attribution. Current held/withdrawn item or location states remain visible as blockers and do not erase historical trace. Downstream output status alone is not eligibility authority; stored output restrictions may be returned as an additional current restriction object.

## Proof and bounds

Validate immutable producer/demand/attribution/output/registry/company receipt proofs and every returned consumer execution, source, reservation, issue and consumption. Current projections must match immutable hashes and exact selected identities. Missing or orphan reverse authority fails closed. A valid live state must not be inferred from a source marker or an audit source-ID array alone.

Full-result caps are 100 use reservations, 32 distinct executions, 32 company receipts, 128 raw receipts, 2000 output identities and 512 KiB for the serialized JSON response envelope, measured with UTF-8 bytes. No pagination or silent truncation is allowed for this integrity result. Each new discovery query uses a remaining-budget overflow sentinel; existing bounded validators retain their constituent limits. These caps do not claim a measured total database-operation budget or production capacity. A bound failure returns no partial trace and changes no state.

Completeness counts describe the validated evidence footprint. In particular, rawReceipts can include abandoned audit sources validated for integrity. That count does not mean every counted receipt was consumed or entered the selected output. Exact ancestry and the consumed-batch hold set remain the separately identified fields above.

HTTP200 returns a complete supported trace, including historical evidence under current holds or master withdrawal. Invalid UUIDs return400; missing/foreign receipt, missing unit or receipt/unit mismatch returns404. Existing409 authority errors propagate, including COMPANY_STOCK_SOURCE_INVALID, INTERNAL_EXECUTION_SOURCE_INVALID and CATALOG_STOCK_SOURCE_INVALID. Any explicit trace cap returns409 TRACE_LIMIT_EXCEEDED. Unknown or malformed authority never falls back to a legacy source.

Acceptance requires native read-only selection/reload, exact serial subsets versus conservative hold sets, reservation/abandon/issue/consumed-unattributed/output/loss/QC/storage states, foreign scope and identity denial, corruption and orphan refusal, genuine over-bound evidence, deterministic bounded source queries, and byte-equal snapshots of all collections before/after reads. No GET rollback claim substitutes for the stronger fact that this endpoint never issues writes.
