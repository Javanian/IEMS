# @iems/domain-test-fixtures

Test data and consistency checks for IEMS manufacturing and repair workflows.

The fixtures describe expected business outcomes. Their tests check data relationships, decimal balances and scenario definitions in memory; they do not exercise HTTP endpoints, PostgreSQL locks or production authorization. Passing these tests does not establish that the application enforces the corresponding guards.

## Scope and Capabilities

The package has no runtime dependencies. Its scenarios cover:

1. **Scenario E01 (Manufacturing 10 Units End-to-End)**:
   - Customer Inquiry (`INQ-2026-03-0012`)
   - Quotation Revision 1 (preliminary, superseded) and Revision 2 (volume discount, accepted)
   - Customer Acceptance (`ACC-2026-0412`)
   - Native Sales Order (`SO-2026-0881`) and Shared Billing Entitlement (`ENT-SO-0881-01`)
   - Engineering Work Package (`PKG-SLP-250-R2`), BOM Revision B, and Routing Revision B
   - Demand Allocation & Two Work Orders:
     * `WO-2026-MFG-001` (6 units)
     * `WO-2026-MFG-002` (4 units)
   - Purchase Order (`PO-2026-PRC-0914`) and Inbound Goods Receipt (`GR-2026-0520`) with QA lot release
   - Material Issue Movements (`MOV-ISS-WO001`, `MOV-ISS-WO002`)
   - Execution sessions (labor and machine run hours with badge IDs)
   - Production Outputs & Serial Tracking (`SN-2026-SLP-001` through `SN-2026-SLP-010`)
   - Quality Inspection Orders and Releases (`QC-REL-001`, `QC-REL-002`)
   - Partial Shipment 1 (6 units) with Proof of Delivery (`POD-2026-0041`)
   - Delivery Invoice 1 (6 units: $73,500.00 net, $8,085.00 VAT, $81,585.00 gross)
   - Partial Shipment 2 (4 units) with Proof of Delivery (`POD-2026-0042`)
   - Delivery Invoice 2 (4 units: $49,000.00 net, $5,390.00 VAT, $54,390.00 gross)
   - Payment Allocations (`PAY-2026-0301`, `PAY-2026-0342`) settling all invoices to $0.00 balance

2. **Scenario E02 (Repair Customer Asset End-to-End)**:
   - Customer Asset Intake (`AST-CAT-793D-CYL-88412`, serial `793D-SUSP-B2199`, customer owned)
   - Repair Case Intake & Custody Event (`CASE-2026-RPR-0055`, `CUST-EVT-001`)
   - Diagnostic Authorization with fee cap ($1,200.00 USD)
   - Teardown Findings with 3 typed dispositions:
     * Component 1 (Cylinder Barrel): REUSE (bore glaze within hone limits)
     * Component 2 (Piston Rod): REPAIR (score marks: grind, hard-chrome plate, finish polish)
     * Component 3 (Rod Seal Kit): REPLACE (extruded polyurethane: replace with new OEM kit)
   - Quotation Revision 1 (budgetary estimate) and Revision 2 (teardown scope: $9,000.00 net)
   - Customer Scope Authorization (`AUTH-SCOPE-2026-055`) and Prepayment Deposit ($3,000.00 USD)
   - Repair Work Order (`WO-2026-RPR-0055`) consuming replacement parts from company stock
   - Assembly & Hydrostatic Test Run 1 (FAILS: pressure drop leak at wiper gland)
   - Non-Conformance Report (`NCR-2026-RPR-014`) and Rework Order (`RWK-2026-055-01`)
   - Hydrostatic Test Run 2 (PASSES: holds 350 bar for 30 minutes with 0.0 bar drop)
   - Final QC Inspection Release Certificate (`QC-REL-RPR-0055`)
   - Return Shipment (`SHP-2026-RPR-001`, mode `CUSTOMER_ASSET_RETURN`) & Proof of Delivery (`POD-2026-RPR-001`)
   - Custody transfer back to customer (`CUST-EVT-002`, customer asset ownership preserved)
   - Final Invoice ($9,990.00 gross), Deposit Application ($3,000.00 applied), and Balance Payment ($6,990.00)
   - Warranty Certificate Linkage (`WAR-2026-055`, 12 months / 2,500 hours)
   - **Rejection Variant (E02-REJ)**: Customer rejects quotation rev 2, repair work order cancelled, diagnostic fee invoice ($1,200.00 net + $132.00 VAT) paid, return-unrepaired shipment in crated condition.

3. **Negative Acceptance Test Fixtures**:
   - `E03`: Attempting to convert expired quote or superseded revision to Sales Order is rejected (422).
   - `E04`: Material shortage, expired equipment calibration, or unqualified operator halts work order release/execution.
   - `E05`: Concurrent stock reservations serialize; ledger balances never go negative.
   - `E06`: Duplicate Idempotency-Key replays return cached response with one business effect; payload mismatch rejected (422/409).
   - `E07`: Lost update 409 conflict prevents silent overwrites when aggregate version/ETag differs.
   - `E08`: Multi-tenant isolation prevents cross-plant resource reading, mutation, and attachment leaks.
   - `E12`: Over-shipment beyond ordered quantity and duplicate serial number dispatches are rejected.
   - `E13`: Shared billing entitlement prevents cross-mode double billing and duplicate deposit applications.

4. **Validation Engine and Fixed-Point Precision**:
   - String decimal arithmetic module (`src/decimal.js`) preventing IEEE-754 floating point inaccuracies.
   - Exact formatting: quantities use 4 decimal places (`0.0000`), monetary amounts use 2 decimal places (`0.00`).
   - Lineage, entity foreign key references, and mathematical reconciliation engine (`src/validation.js`).

## Running Tests

From the repository root:

```bash
npm test --prefix packages/domain-test-fixtures

# Print the fixture validation summary:
node packages/domain-test-fixtures/test/runner.js
```
