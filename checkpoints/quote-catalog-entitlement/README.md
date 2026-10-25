# Catalog identity on commercial lines

This increment implements the P015 prerequisite identified by the company-unit trace checkpoint: an operator explicitly chooses an approved catalog item and revision for a commercial line, and the resulting identity remains verifiable through quotation approval, acceptance and native sales-order creation. Descriptions and drawing numbers do not establish catalog identity.

Starting point is `23d2023af37cc49a5550e1c090eab918decf1532`, branch `feat/company-stock-trace`, draft [PR14](https://github.com/Javanian/IEMS/pull/14). Its twelve checks passed on that exact head. Those checks do not accept the source in this new increment.

The original local master-plan sources remain unchanged. P015 covers native commercial order lines; P031 requires that entitlement before later company-stock allocation or dispatch. This increment does not authorize dispatch, change inventory balances, implement sales amendments or schedules, or complete the broader PostgreSQL migration. General genealogy writes and shipment freezing remain planned. F5 authorization contention remains blocked with its fences intact.

See CONTRACT.md for the actual wire and current versus historical authority rules, WORK-OWNERSHIP.md for integration boundaries, and TEST-RESULTS.md for observed results. Local and remote acceptance are recorded separately. Raw logs, screenshots, databases and evidence manifests remain external to Git.

Quotation PDF preparation validates the catalog source before the existing renderer maps the financial lines. That renderer omits catalog bindings. The PDF remains a financial quotation; the validated API and native sales-order snapshot carry the catalog identity evidence.

## Reproduction

Use Node24 and the six existing package lockfiles listed in `.github/workflows/portfolio-vat.yml`. Run each owned Mongo/browser gate separately; do not point these synthetic fixtures at a user database. Mongo7.0.14 is selected by the fixtures. An existing matching binary can be supplied through MONGOMS_SYSTEM_BINARY.

```text
npm --prefix apps/portfolio-api run check
node --test --test-concurrency=1 apps/portfolio-api/test/quote-catalog-entitlement.test.mjs apps/portfolio-api/test/commercial.test.mjs apps/portfolio-api/test/wave4i-inquiries.test.mjs
node --test --test-concurrency=1 checkpoints/quote-catalog-entitlement/qa/quote-catalog-entitlement.test.mjs
npm --prefix apps/portfolio-api test
npm --prefix apps/web run test:portfolio
npm --prefix apps/web run build
python checkpoints/review-five-findings/audit-publication.py
```

The normal browser command is `npm --prefix apps/web run test:portfolio:browser`, using all21 journey flags and all four diagnostic flags set to0 as shown in the workflow. Customer service remains included. PORTFOLIO_UI_ROOT must select this checkout's apps/web when explicitly supplied.

For a separate focused diagnosis, set PORTFOLIO_QUOTE_CATALOG_DIAGNOSTIC_ONLY=1 with the other diagnostic flags0. Its named debug result has fullAcceptance=false and does not establish the normal journeys. Preserve each attempt's evidence in a new external PORTFOLIO_EVIDENCE_DIR; do not reuse a failed attempt's directory or commit its logs and pixels.
