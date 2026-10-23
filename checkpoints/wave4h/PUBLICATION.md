# Reproducing the VAT preview

Use Node.js 24, npm, Python 3.11 or later, and an installed Chrome browser. Run from a clean checkout of feat/wave4h-vat-documents. The branch depends on customer-service preview PR #1; compare against that branch to review this increment.

Run the following commands sequentially from the repository root:

```sh
npm --prefix packages/tenant-foundation ci
npm --prefix packages/customer-service ci
npm --prefix packages/document-rendering ci
npm --prefix apps/portfolio-api ci
npm --prefix apps/wa-demo-bridge ci
npm --prefix apps/web ci
python checkpoints/wave4h/audit-publication.py
npm --prefix apps/portfolio-api run check
npm --prefix apps/portfolio-api test
npm --prefix packages/document-rendering run check
npm --prefix packages/document-rendering test
npm --prefix apps/web run test:portfolio
npm --prefix apps/web run build
```

API npm test runs all current test files except the explicitly preserved wave4g-tax.test.mjs. That historical file requires VAT PDF issuance to return 422 and is incompatible with the approved Wave4h behavior. Its expected failure can be reproduced with npm --prefix apps/portfolio-api run test:historical-wave4g. The active wave4h-vat-documents.test.mjs covers the canonical values, supported issuance, partial invoices, settlement and historical replay. No claim is made that the unfiltered historical wildcard suite passes.

Renderer npm test includes the historical and VAT tests and runs from the correct package directory. The public type-check command is npm run check, not npm run typecheck.

For the connected browser journey, set PORTFOLIO_PAGINATION, PORTFOLIO_REPAIR, PORTFOLIO_DOCUMENTS, PORTFOLIO_WMS, PORTFOLIO_ENGINEERING, PORTFOLIO_LABOR and PORTFOLIO_VAT to 1. Leave PORTFOLIO_SKIP_CS unset. Then run:

```sh
npm --prefix apps/web run test:portfolio:browser
```

Set PORTFOLIO_EVIDENCE_DIR to a private directory outside the checkout, or use the randomized OS-temp default. The raster command accepts that directory:

```sh
npm --prefix apps/web run test:portfolio:raster -- <evidence-directory>
```

Mongo harnesses launch their own disposable replica sets. MONGOMS_SYSTEM_BINARY selects an installed MongoDB 7.0.14 binary; otherwise the harness downloads it. MONGOMS_DISABLE_POSTINSTALL=1 defers download until tests. Never point the harness at a shared database. Install all six packages, including the bridge, before running the browser journey.

PORTFOLIO_CHROME_BINARY can override the Chrome executable. Windows defaults to the standard Program Files installation; Linux expects google-chrome on PATH. Port 4313 must be free; the web harness probes 4173 through 4272. Do not stop another user's process to free a port. No Docker or RabbitMQ service is required.

The manifest audit checks normalized source hashes and relative imports; it is not a complete package-resolution or security audit. Two historical command/hash metadata JSON files inherited from the first checkpoint remain provenance only, not runtime dependencies or fresh test evidence. New runtime evidence stays outside Git.

The dedicated Portfolio VAT acceptance workflow reproduces API, renderer, frontend, build and connected browser checks on Windows. It does not replace independent visual review of rendered PDFs or establish production readiness.
