# @iems/document-rendering

Bounded, local snapshot-to-PDF library. No API routes or browser integration are installed. This package does not provision RabbitMQ, enqueue delivery, send documents, or establish production readiness.

## Cumulative invoice rounding

Invoice-only `roundingPolicy: 'CUMULATIVE_HALF_UP'` accepts `CumulativeInvoiceSource` in the existing invoice overload. Each line requires its exact ledger `amount` and `rounding: { sourceId, lineIndex, beforeQuantity, afterQuantity, beforeAmount, afterAmount }`. sourceId identifies the originating sales order; lineIndex is its nonnegative safe integer line. Quantities are nonnegative decimal strings (six places max; before may be `0`), with `afterQuantity - beforeQuantity === line.quantity`. Each cumulative amount must equal HALF_UP(quantity * unitPrice) at the currency scale. The exact source line amount must equal `afterAmount - beforeAmount`; invoice total must equal the sum of these exact amounts. No independent reround of the invoice quantity. Provenance is copied, frozen and content-hashed, revalidated on render/issue/read. Same-source-line entries within an invoice must have contiguous quantity/amount boundaries and identical price/currency/UOM. Caller must load authentic immutable ledger provenance under its authorization fence: arithmetic validation cannot authenticate a database source.

Example second half of USD 0.01 item: quantity `0.5`, unitPrice `0.01`, amount `0.00`, rounding `{ sourceId: 'so-id', lineIndex: 0, beforeQuantity: '0.5', afterQuantity: '1', beforeAmount: '0.01', afterAmount: '0.01' }`. The first half is `0.01`; neither ledger amount is replaced. Existing `LINE_HALF_UP` retains strict independent per-line validation, including repair invoices. A repair invoice uses ordinary top-level invoice commercial fields with a positive quantity, fixed-scale price, correct amount/total and no customer/payment/internal fields; no new kind or invented fulfillment provenance is needed. Cumulative policy is rejected for quotes/purchase orders; provenance is rejected on LINE_HALF_UP, not silently ignored. Public issuer signatures and issue key remain unchanged.

## Versioned templates

Template v2 is the new default: `iems-commercial`, `pdfkit-0.17.2`, `a4-flow-v2`. It keeps bounded ASCII because no locally available font with redistribution/embedding license evidence has been found; Windows installed fonts alone are not permission to redistribute. v2 uses 12pt body type, repeated document/reference headers and `Page N of M` footers.

Additive fourth argument: `createSnapshot(kind, scope, source, { templateVersion: 1 | 2 })`; omitted selects v2. v1 remains valid/renderable for historical snapshots; its layout is unchanged. The issue-once key does not include template version. Issuing v2 against an already issued v1 source revision throws `ISSUE_CONFLICT`; read the existing issue or use a genuinely new approved source revision, never bump a revision just to bypass a conflict. Stored reads and idempotent replay validate snapshot hash, key, template and PDF hash. No API signature changes to issuer/read/render; no broker or cross-API transaction claim. Exact decimal strings and existing supported currencies/UOM/policies unchanged. Unicode remains fail-closed (`INVALID_TEXT_ASCII_REQUIRED`).

## Public API

ESM barrel `src/index.mjs`, public TypeScript declarations `src/index.d.ts`, package export `@iems/document-rendering`. Requires Node 24 and MongoDB replica-set transactions for issuance.

```js
import { createSnapshot, renderPdf, createIssuer } from '@iems/document-rendering';
const scope = { tenantId, legalEntityId, plantId }; // authorized server-side scope
const snapshot = createSnapshot('quote', scope, scopedQuoteRevision);
const pdf = await renderPdf(snapshot); // Buffer, no database required
const issuer = await createIssuer({ client, db });
const receipt = await issuer.issue(scope, snapshot);
const stored = await issuer.read(scope, receipt._id); // { record, pdf } or null
```

Callers must authorize the scope, load the source under that full scope in a consistent read, and select the approved immutable revision before calling. This library verifies scope equality; it is not an authorization system or a business-state approval gate. Never trust client-provided scope/snapshots. `createIssuer` creates two named collections/indexes in the supplied database; it deliberately does not manage connection credentials or production database ownership.

### Inputs / existing shape mapping

Every input needs `_id`, positive integer `version`, `tenantId`, `legalEntityId`, `plantId`. Extra source fields are not copied, preventing incidental identity/credential leakage. All printed text is bounded printable ASCII; unsupported Unicode is rejected rather than silently losing glyphs. A future template with an embedded licensed Unicode font needs a new template version.

- `quote`: source contains `snapshot: { lines, currency, total, taxPolicy, roundingPolicy }`. Existing commercial revision/approval content can be wrapped with the quote identity and revision as `version`. Revision selection remains caller responsibility.
- `purchaseOrder`: same `snapshot` shape from procurement order/approved content.
- `invoice`: `lines`, `currency`, `total`, `taxPolicy`, `roundingPolicy` at source top level. Fulfillment invoice line `amount` is validated when present. Payment/outstanding mutable fields are intentionally excluded.
- `shipment`: top-level `salesOrderId`, integer `lineIndex`, `quantity`, `uom`, `reference`. Shipment records have no financial amount: no invented currency/total or source-description join. Printed description is the source line index.

Line fields: `description`, `quantity`, `uom`, `unitPrice`, `currency`, optional `amount`. Quantity/price/total stay decimal strings, never IEEE floating point. Quantity has up to six places. Price/total fixed currency scales: USD/EUR/GBP/IDR 2, JPY 0, KWD 3. Positive quantities; nonnegative prices. Tax policy is limited to `NO_TAX`; rounding supports `LINE_HALF_UP` and the invoice-only `CUMULATIVE_HALF_UP` contract above. BigInt arithmetic independently recomputes each rounded line amount and total; mixed currencies, ambiguous UOM, totals mismatch, numbers, unsupported policies are rejected.

### Immutable content / issuance contract

`createSnapshot` copies only bounded document fields, recursively freezes the result, stamps schema/template version, and hashes canonical sorted-key JSON with SHA-256. Template v1 includes renderer version and layout identity. `renderPdf` revalidates content, hash, template and financial invariants. Fixed metadata timestamps make the same snapshot yield identical PDF bytes with the pinned renderer. Template edits require a new version.

Issue-once key is `(tenantId, legalEntityId, plantId, kind, sourceId, sourceVersion)`, **not** the template version: changing content or template for an issued revision conflicts instead of silently reissuing. A new source revision is required. A unique index plus MongoDB snapshot/majority transaction commits the issue record, immutable copied snapshot and PDF binary atomically. Duplicate-key races retry; the driver handles transient transactions/unknown commit retries. Repeating after lost response returns the durable original receipt/bytes. No external side effects occur inside the transaction. Read is full-scope filtered and validates stored PDF SHA-256. Direct database mutation is outside this trust boundary; restrict collection write access in integration.

Errors are thrown with stable messages (`SCOPE_MISMATCH`, `TOTAL_MISMATCH`, `LINE_AMOUNT_MISMATCH`, `ISSUE_CONFLICT`, `SNAPSHOT_INTEGRITY`, `ARTIFACT_INTEGRITY`, `INVALID_*`). This version does not provide HTTP status mapping.

## Reproduce verification

Requires Node 24. From this package directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run check
```

Tests enumerate seven explicit files sequentially. They cover exact financial values, cumulative invoice rounding, parsed PDF text and page bounds, concurrent issuance, scope rejection, tampered artifacts, transaction rollback, process termination and unknown-commit recovery.

The full recovery suite uses Windows PowerShell to verify the identity of owned child processes before terminating them. Run that suite on Windows; complete execution on other platforms has not been validated.

MongoDB tests launch a separate MongoDB 7.0.14 replica and download/cache the platform binary when needed. Set `MONGOMS_SYSTEM_BINARY` to an installed matching executable for offline runs. No sibling package or existing database is required. Tests verify owner markers before dropping their randomly named database and removing their runtime directory. A single-member replica does not establish high availability.

Generated PDFs, page images, test evidence and runtime files stay ignored. Tests generate their own synthetic documents; no production customer records are required.

## Limitations

The templates are generic printable documents, not approved legal or customer branding. The package does not provide PDF/A, digital signatures, tax compliance, tagged accessibility, delivery brokers or source authorization. Unicode requires a future version with an appropriately licensed embedded font; current inputs are restricted to printable ASCII. End-to-end application and production readiness require separate integration acceptance.
