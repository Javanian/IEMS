# Wave4h document consumer handoff

VAT support: approved quote revisions and issued fulfillment invoices only, schemaVersion 2 / template iems-commercial v3. Routes, scopes, issue key `(scope,kind,sourceId,sourceVersion)`, PREPARED→READY and retrieval unchanged. Request no monetary fields: POST `/api/documents/issues` `{kind,sourceId,sourceVersion}`; GET `/api/documents/sources/:kind/:id?sourceVersion=N`; GET `/api/documents/issues/:id[/pdf]`.

Use explicit `netAmount`, `taxAmount`, `grossAmount`, currency. Quote R1 128000.00/14080.00/142080.00; R2 122500.00/13475.00/135975.00. Partial invoices 6/4: 73500.00/8085.00/81585.00 and 49000.00/5390.00/54390.00. No browser business arithmetic. Policy `FIXTURE_VAT_11_V1`, version 1, rate string `0.11`, fixture only, not statutory. Show revision and policy. Paid/Balance use existing `paidAmount`/`outstandingAmount` from invoice detail, not PDF pricing snapshot.

Source mapping: stored quote approvals[].snapshot → quote PDF; stored fulfillment invoice → invoice PDF. Stored `line.amount` is NET; VAT line explicit net/tax/gross retained. VAT PDF `total` is GROSS, with explicit net/tax/gross. **Baseline discrepancy:** Wave4g actual quote/SO VAT `total` is gross (README and original golden assert it); NO_TAX total remains net=gross. No upstream monetary code is changed here; consumers MUST use explicit fields, not reinterpret total. Invoice sourceVersion in PDF issue key stays 1 even after payment; salesOrderVersion preserves frozen SO sourceVersion separately, with quoteRevision, salesOrderId, shipmentId and cumulative rounding provenance.

NO_TAX schema1 templates1/2 and historical bytes unchanged. Unknown policy/version, malformed/inconsistent monetary/provenance values rejected before publication. Repair VAT remains unsupported (409 TAX_POLICY_UNSUPPORTED). VAT on unsupported purchaseOrder/shipment is rejected. Historical quote revisions remain individually issuable; no latest-revision substitution.

Status: contract published before implementation. Maintained Wave4h tests will assert supported PDFs; original Wave4g golden stays untouched and its old VAT-PDF-unsupported assertion is obsolete, not claimed green.
