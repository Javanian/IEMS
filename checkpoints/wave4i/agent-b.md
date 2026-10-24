# Wave4i Agent B: frontend preparation handback

Status: PREPARED, NOT FINAL-INTEGRATED. Provider HANDOFF.md was not present at the last check. Heavy token remains with A. No Mongo, Chrome, Vite daemon, renderer, full build or heavy acceptance was run by B.

## Implemented within B ownership
- Inquiry navigation/list/create/detail, full customer account traversal, exact source line strings, stable retained line IDs on draft revisions, read-only revisions/history, submit/review controls and commercial-only conversion form.
- Permission-aware native controls, submit lock, expectedVersion/idempotency keys and retained same-command retry after uncertain responses; conflict requires record refresh.
- Sourced quote commercial revision form excludes source re-entry; legacy direct quote form stays unchanged. Quote/SO line rendering and shipment/invoice metadata rendering include source inquiry navigation and explicit drawing-metadata-not-BOM wording.
- Added PORTFOLIO_INQUIRY browser branch after VAT, preserving all six existing switches, VAT and unconditional Wave4f journeys.
- Prepared real-harness inquiry journey: native multiline create/revise/stages, independent DB exact assertions, membership revocation/reload, offline then committed-response-loss conversion retry, commercial revision/approval/SO, genuine upstream manufacture, partial six-unit shipment/invoice and gross settlement, source links/reloads/width checks. This journey has NOT been executed.

## Files
Modified: apps/web/src/features/portfolio/{PortfolioWorkspace,CommercialWorkspace,FulfillmentWorkspace}.jsx; apps/web/test/portfolio-browser.mjs.
Created: apps/web/src/features/portfolio/{InquiryWorkspace,SourceLineage}.jsx; apps/web/src/features/portfolio/inquiry.mjs; apps/web/test/portfolio-wave4i-inquiry{.test,-browser}.mjs; this report.

## Light verification (Node v24.19.0, Windows Git Bash)
- Independent apps/web npm ci --ignore-scripts --no-audit --no-fund: exit 0, 612 packages; package lock unchanged. No borrowed node_modules. npm reported existing deprecated transitive packages (sourcemap-codec, source-map beta, glob).
- RED/GREEN observed for source projection, conversion price-only command, frozen sourced revision projection, and additive INQUIRY entry assertion.
- node --test --test-concurrency=1 test/portfolio-*.test.mjs: exit 0, 48 passed / 0 failed (44 previous + 4 Wave4i). Latest duration 1836 ms.
- node --check test/portfolio-wave4i-inquiry-browser.mjs and test/portfolio-browser.mjs: exit 0.
- esbuild transformSync JSX syntax-only: InquiryWorkspace, PortfolioWorkspace, CommercialWorkspace, SourceLineage, FulfillmentWorkspace all passed. No bundle/render/server launched.
- git diff --check: exit 0.

## Required provider handoff integration before readiness
Confirm exact inquiry read fields (stage, revisions, history entry actor/time/from/to), collection identity, conversion envelope and quote mapping; confirm provenance placement on quote/SO/shipment/invoice, source-preserving revision input allowlist, status codes and role grants. Current preparation uses contract-shaped flat per-line lineage; it must be reconciled against A HANDOFF, not treated as verified API integration. Conversion success currently reloads the authoritative inquiry instead of fabricating/navigating a returned quote.

Additional real acceptance still needed: stale writer conflicts, cross-scope and explicit denied mutation, replay audit/outbox/idempotency count conservation, keyboard activation/text zoom and source-frozen tamper. Backend remains responsible for transaction fences/rollback/concurrent conversion. All UI/browser claims remain unverified pending token, provider contract and actual run. The prior 81-check baseline is not claimed rerun.

## Handback-ready command (DO NOT RUN until explicit lead token)
From apps/web, with provider/rendering dependencies independently installed and provider HANDOFF integrated:

```bash
PORTFOLIO_PAGINATION=1 PORTFOLIO_REPAIR=1 PORTFOLIO_DOCUMENTS=1 PORTFOLIO_WMS=1 PORTFOLIO_ENGINEERING=1 PORTFOLIO_LABOR=1 PORTFOLIO_VAT=1 PORTFOLIO_INQUIRY=1 'C:/Program Files/nodejs/node.exe' test/portfolio-browser.mjs
```

No skip flags. Preserve default resolved evidence path; require all old check names plus Wave4i checks, zero console exceptions, marker-verified cleanup. Agent B owns no active processes to release.

## UI design and delivery gate
Reading: operational inquiry editor for portfolio staff, existing IEMS portfolio visual language, ENERGY 1 / RHYTHM 1 / MOTION 1. Existing shared fields/spacing/focus/touch targets are reused to avoid a second design system. Source fields and commercial fields are separated because submission freezes product intent. No new assets, animation, colors or financial arithmetic.
Static checks: actual links/routes and request handlers present; explicit loading/empty/error/denied/uncertain states; native inputs/selects/buttons; no fake fetch or fabricated persisted records. Dynamic delivery gate remains PENDING, not PASS: no click-through, contrast/render, responsive/zoom or browser acceptance is claimed while heavy execution is unauthorized. This is a preparation handback, not a shipped UI.
