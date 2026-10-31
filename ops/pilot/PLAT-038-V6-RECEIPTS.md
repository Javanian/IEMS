# V6 existing receipt inventory (before hook edits)

All rows retain original input digests and owner receipt/results. Base576a947.
Default identity is tenantId/plantId/key; exceptions explicit below. Same-session
hook follows payload comparison, current source/permission checks and precedes
first business effect. Retained replay validators run before zero-charge admission.

| Namespace | Existing source wrapper | Digest producer / result | Replay/source authority |
| --- | --- | --- | --- |
| repairKeys | repair.mjs tx | SHA256 canonical({kind,id,bodyWithoutKey}); result | host repair action; spare catalog/company permissions and recheckRepairStockSources |
| internalPlanningKeys | internal-production.mjs mutation | stockHash({kind,resource,body}); result | planning action, active owner; existing source heads/revisions |
| internalExecutionKeys | internal-execution.mjs mutation | stockHash({kind,resource,body}); result | execution action and company source permission; context authority |
| stockHoldKeys | stock-holds.mjs command | SHA256 canonical({operation,subjectId,request}); status/body | existing hold action scope, receipt source ownership; custom IDEMPOTENCY_KEY_REUSED retained |
| inquiryKeys | inquiries.mjs create and revision/stage/convert | SHA256 JSON body for create; JSON({operation,id,body}) for changes; data | scoped account/inquiry and quote action |
| materialShortageKeys | material-shortages.mjs mutate | stockHash({operation,resource,bodyWithTrimmedReason}); result | procurement/manufacturing/catalog permissions; existing work-order demand rechecks on replay |
| catalogKeys | catalog-procurement.mjs mutation | stockHash({kind,resource,body}); result | catalog action and owner; existing source readers |
| catalogDispositionKeys | catalog-disposition.mjs mutation | stockHash({kind,resource,body}); result | disposition action and catalog context |
| purchasedFulfillmentKeys | purchased-fulfillment.mjs mutate | stockHash({kind,orderId,body}); result command proof | purchased actions/current graph/event/resultHash plus shipmentHash |
| deliveryKeys | delivery.mjs confirmations | stockHash({path,body}); result | delivery permission, existing typed source/state/historical event/result hash |
| fulfillmentReturnKeys | delivery.mjs returns | stockHash({shipmentId,body}); result | current source/delivery/return graph before lookup |
| workforceResults | workforce.mjs command | HMAC-SHA256(existing pepper,contentHash({path,body})); result | exact identity tenant/plant/actorId/key; actorId=scope.userId; existing subject/device/beforeReplay/consent policies |
| purchaseOrderAmendmentKeys | procurement.mjs amendments | SHA256 JSON([operation,params,input]); result | exact identity tenant/plant/cohort/key; cohort=LEGACY; current order/vendor |
| procurementRfqKeys | procurement.mjs rfq/response | SHA256 JSON([operation,id,body]); data | current request/vendor before replay |
| procurementPromiseKeys | procurement.mjs vendor-promise | SHA256 JSON([id,expectedVersion,vendorId,promisedAt,reference,reason]); data | current order/vendor and matching vendor before replay |
| procurementConversions | procurement.mjs convert | SHA256 JSON({requestId,expectedVersion}); orderId | current request and scoped source order result |
| quoteCatalogKeys | commercial.mjs typed create/change/convert | existing quoteCatalogPayloadHash; result/resultHash | existing quoteCatalogReplay validates result/quote/events/current binding/order |
| quoteConversions | commercial.mjs legacy convert | SHA256 JSON({quoteId,expectedVersion,revision}); orderId | scoped quote/current order; no new key/hash dimensions |
| companyStockKeys | company-stock.mjs hold/release | stockHash({action,companyReceiptId,body}); result | current company stock permission/context |

Nonreceipted local writes remain explicit: CRM transactions; legacy commercial
quote create/revision/approval/accept without typed receipt; procurement vendor/
request creation and unkeyed approve/issue/vendor confirmation; document issue
intent/render/two-phase publication has source-version identity but no stable
caller command receipt. Exact route/contract proposals will be published to153
once source inspection is complete. No new receipts or domain semantic change
is authorized by this inventory. Private service/automation and external adapters
remain bounded unsupported; they are separately classified, not silently accepted.

Current result:19 new namespaces,21 actual source-fixture wrapper cases, combined35/35 PASS. Original v5 namespaces retained. Scope remains incomplete:44 unsupported routes plus conditional legacy quote operations. Exact proposals are in PLAT-038-V6-LOCAL-GAPS.md. Current typed/legacy/local boundary support uses original receipt identities, hashes, returned results and retry policy. No new receipt authority created.
