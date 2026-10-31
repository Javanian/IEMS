# PLAT-038 v9 E02 receipt and registry prerequisite

Adopted142 source78e0ce89a4f88bab0dfd9c116be04b984933f351 by normal ancestry merge
into the existing pilot branch after A55ec65d and Ba87e593. No142 domain/source/
view/UI/test helper was edited. Repair replay resolves the current scoped case,
including scoped invoice.caseId for settlement, retains stock checks and invokes
recheckRepairServiceSources for typed cases. Delivery confirmation replay detects
persisted CUSTOMER_ASSET_RETURN/schema/authority evidence, rejects contradictory
or missing evidence, validates current source/state and historical event/view,
then reauthorizes admission with zero usage. Receipt identities and hashes remain.

Historical Mongo results encode absent generic salesOrderId as null for typed
customer property. The narrow replay view comparison accounts for that existing
null only, then returns the original saved result unchanged. The first142 HTTP
response currently omits this undefined field; owner142 must reconcile its view
projection for exact initial-response/replay equality. No historical receipt is
rewritten and no generic sales order is invented.

Actual mounted inventory400 routes: four new service-order GETs and one repair
orders POST. Unknown-route startup still fails; validator error carries an internal
frozen actualRoutes list for the owned capture launcher. Capture does not open an
accepted listener or disable source checks. Normal subsequent startup validates
all400 routes. Registry266 collections,104 domain sources/108 admission sources.
New repairSalesOrders, repairWorkOrders, repairOrderRevisions and
repairReturnAuthorities are BUSINESS authority/history from their actual sources;
new fields/modules coexist with v8 receipt/renderer contracts. Registry provenance
names data55766c6, admissiona87e593 and adopted14278e0ce89; actual normalized hashes
are authoritative. Final feature SHA is recorded in the Paperclip ledger.

Evidence: direct schema/admission verifiers and API syntax PASS; JSX parse of
lifecycle and adopted repair UI PASS. Service-orders/POD basics3/3 PASS. Initial
accepted-source fixture failed HTTP400 INVALID_MATERIAL_TRACE at
/catalog-procurement/receipts in receiveE02Spares, before hook replay. Owner142
must fix the fixture/domain mismatch within its scope. The source helper and
canonical fixture are preserved. Own rejection-return source fixture proves
receipt hooks independently: corrected6/6 PASS, current case hold/authority
revocation/deleted work order/tampered shipment or event rejected, stored results
unchanged and usage zero. Expanded quota/abort/export/affected suites are recorded
in final evidence. Initial failed source/BSON runs remain in evidence.

E02 accepted full chain remains INCOMPLETE, not PASS; original142 full-chain test
NOT_RUN after the concrete accepted-prefix failure. Its original fixture SHA256
6baee7beb75983827bd40f0064618af35b41e96ea6eba4ef3cb68dfdaba49d48 is unchanged.
Next142 adopts this usable SHA and runs/fixes its assigned service/POD/full-chain
suite and manifests. CTO149 integrates sequentially and reviews final pins;
independent150/152 stay last. FullQA/cloud/live/production NOT_RUN.

Remaining local contracts outside current bounded allocation:

| Paths/transaction | Existing authority and required next contract | Owner/action |
| --- | --- | --- |
| apps/web/src/features/portfolio/{PortfolioWorkspace,CommercialWorkspace,ProcurementWorkspace}.jsx and shared client/command helpers | Forms still omit v8 commandKey. Add one caller-held key per intended command, preserve body/key on uncertain retry, rotate only after confirmed/new intent. Never inject generic keys into typed/existing owner receipts. | CTO153 allocates exact shared UI/caller hunks. |
| apps/portfolio-api/src/{customer-service,automation,automation-transport}.mjs; packages/customer-service/index.mjs | Existing cs_idempotency/automation receipts have private/delegated actor/session/source/replay contracts. No broad exemption, actor substitution or fake request receipt. GET SLA scheduling is a write. | CTO153 decides exact receipt/principal/transaction coverage; current enrolled denial remains. |
| apps/portfolio-api/src/platform-runtime.mjs; packages/durable-jobs/{index,authorization}.mjs | Existing foundation job receipt and worker leases need explicit public ingress-to-same-session receipt admission and retry/system classification. Internal retries are not billable user commands. | CTO153 assigns bounded ingress contract. |
| scoped AI vector rebuild/cleanup; vendor dispatch/reconcile; external automation history | External/independently committed effects lack quiescence and same-session authority; current enrollment/unsupported gates remain. | Existing external/transport decision gates, no spend or invented evidence. |

V6 proposed A/B gaps are now implemented by approved v8; they are not pending
allocation. Full endpoint coverage/whole PLAT-038 remains incomplete. All prior
033/034/035/036 local handoffs preserved; real Databricks039 remains PLANNED.

Actual export corpus also exposed dynamic-source fields missed by generic inventory. Exact quote repairFence producer and service amount/evidence producers are now registered. Diagnostic invoice authorization is a specific business snapshot: only repairInvoices.authorization and repairKeys.result.authorization with exact DIAGNOSTIC_AUTHORIZED/OPERATOR_RECORDED fields, actor UUID/date/decimal cap are recognized. Bearer strings, extra secret fields and all other private paths still fail closed; no credential exception. Raw unknown/private-field failures are retained in evidence.

Final actual results: v9 graph/privacy plus existing port12/12PASS exit0; final v9 replay/quota/abort/actual graph archive-delete-restore proof8/8PASS exit0, exact digest parity and credentials retained. Earlier affected suite44PASS/2FAIL contained only export unknown-field failure and parent; exact schema/business snapshot correction then verified above. Independent E02 accepted runtime remains failed at material trace; no domain helper edit. Some fixture teardowns print ECONNRESET on exit0; recorded as warning. No process left. No full independent QA/cloud/live acceptance.
