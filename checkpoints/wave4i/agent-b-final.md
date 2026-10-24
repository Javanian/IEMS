# Wave4i B final integration handback

Heavy token RELEASED. Editing stopped. Owner verification, not lead independent acceptance; no merge authorized.

## Outcome
- Final actual Chrome + fresh marked owned Mongo + unmodified createApp + Vite integration passed twice sequentially on final source: browser-15.log and browser-16.log, each exit 0, 88 checks (81 baseline + 7 inquiry), zero browser exceptions/console errors. Also final-source runs 13/14 passed 88. Names preserved and compared after normalizing runtime UUIDs, not merely counts.
- Light suite: 50/50 passed, zero failed/skipped, 1697.2432ms. Both browser entry syntax checks and git diff --check passed.
- Reconciled provider `_id`, nested `provenance`, history actorId/occurredAt/from/to, quote.write grants and commercial revision allowlist (no idempotencyKey there). Backend untouched.
- Inquiry multiline native create/revision retains exact decimal/UOM/drawing and stable IDs/old revision; real membership denied reload/recovery; genuine second writer stale409 and explicit refresh; keyboard Enter review with visible outline; frozen price-only conversion with offline retry and actual committed-response loss; one quote; commercial revision/approval/acceptance/SO source links and reload; genuine manufacturing feeds partial six-unit shipment/invoice/payment. Independent Mongo asserts source provenance and exact VAT 72000.00/7920.00/79920.00.
- Conversion replay conserves inquiryKeys/commercialAudit/commercialOutbox counts; changed same-key payload409 and revoked same-key replay403 leave effects unchanged.
- Sourced VAT invoice real native issue/download succeeds. PDF parser verifies source ID/net/tax/gross; downloaded bytes SHA256 equals stored metadata; repeated issue retains immutable metadata and one intent. No API bug found requiring provider changes.

## Commands
From apps/web, final sequential runs (no skip flags, PORTFOLIO_EVIDENCE_DIR unset):
```bash
TMPDIR='C:/Users/Admin/AppData/Local/hermes/cache/scratch' PORTFOLIO_PAGINATION=1 PORTFOLIO_REPAIR=1 PORTFOLIO_DOCUMENTS=1 PORTFOLIO_WMS=1 PORTFOLIO_ENGINEERING=1 PORTFOLIO_LABOR=1 PORTFOLIO_VAT=1 PORTFOLIO_INQUIRY=1 'C:/Program Files/nodejs/node.exe' test/portfolio-browser.mjs
'C:/Program Files/nodejs/node.exe' --test --test-concurrency=1 test/portfolio-*.test.mjs
'C:/Program Files/nodejs/node.exe' --check test/portfolio-wave4i-inquiry-browser.mjs
'C:/Program Files/nodejs/node.exe' --check test/portfolio-browser.mjs
git diff --check
```
Bridge missing declared package resolved using independent apps/wa-demo-bridge `npm ci --ignore-scripts --no-audit --no-fund` exit0; API/renderer/web dependencies already installed. No copied node_modules/root lock changes.

## Evidence
Raw logs, RED regressions, baseline diff/index, exact source hashes and check-name arrays: `C:/Users/Admin/AppData/Local/hermes/cache/scratch/wave4i-b-final/`.
Final default-path artifacts:
- `C:/Users/Admin/AppData/Local/hermes/cache/scratch/portfolio-evidence-c3b095c2-2206-40c3-b51d-42404f828532`
- `C:/Users/Admin/AppData/Local/hermes/cache/scratch/portfolio-evidence-a4bca052-2855-4d4f-a0ea-6f2263f35882`
Last sourced VAT invoice PDF hash `be7640abfdb4c7701c76c4bf8b661be031f7bfafa5340b426a274e9b84feedcc`, content hash `f32d3efe0ae50d900d98c302ff20388328ff2f34a5bdad143648c66c407dae45`.
Earlier harness default incorrectly inherited system TEMP because TMPDIR was absent; final two invocations explicitly set Hermes scratch. Earlier passing 13/14 artifacts copied into scratch archived-evidence-13/14; no evidence erased.

## Retained failures / limits
All browser-01..16 logs retained. 01 missing bridge dependency; 02 absent enabled inquiry field; 03 quote-grant mismatch; 06 malformed selector quoting; 07 prepared harness incorrectly expected creation stage-history row (actual history starts empty); 08 unsupported revision idempotencyKey. Fixed UI/harness only with observed RED (provenance/grant/render regression tests and real browser failures).
Unrelated retained failures, not suppressed: 04 inspector login blank-context timeout; 05 dynamic-import network failure on labor reload; 09 WMS readiness timeout; 11 engineering geometry false; 12 manufacturing offline recovery timeout. Final four unchanged-source runs passed, bounded repeatability only, not a flake-free claim. Known Windows Mongo teardown ECONNRESET and stale Browserslist warning remain in some logs.
No inquiry-specific cross-tenant browser, 200% text resize, complete Tab traversal, source tamper browser or concurrent-conversion race was added; existing baseline checks and provider tests cover their respective boundaries, not new blanket claims. Keyboard focus/Enter review and three invoice widths 375/768/1280 are bounded checks, not accessibility certification. Full E01 remains PARTIAL.

## Files / hashes
Modified only B UI/harness plus this report this session:
- src/features/portfolio/inquiry.mjs `5c19c687deea580a47cbdef4c7201e10d8f5056f3b34d7c1cc9d9f0eb6cd686c`
- InquiryWorkspace.jsx `2be3b3a93fc57fa65ce5b07e48b5284afd906c85528121aed17efa073353959e`
- SourceLineage.jsx `9108e89eafd3e559dba8d5a0c458e3ee60259e18758a30d9d6e077ee0483d33a`
- CommercialWorkspace.jsx `998144b11201ae815437e6130c76e0035eafeae3a2456110744e11c960e910a0`
- test/portfolio-wave4i-inquiry-browser.mjs `9963a6f402397207444d4bd031b780735409747b31dcd6b78bbc0d76a77db5d7`
- test/portfolio-wave4i-inquiry.test.mjs `1aada3afbb0fe8505bc8b66e30f293bc49b3f9cf97c735c0dccd9b51c94fdf22`
Entry retained `73d42fdda9f86fba89b0ceb27ef6e4cdac64d3abdc44762268d286b5ff999f24`.
Index unchanged compared with saved baseline. No API/renderer/golden/sharedPG/daemon/privateWA/git operation edits. Harness marker-verifies DB before drop; final Win32_Process query found no mongod or portfolio-profile Chrome. Owned Vite/API closed in finally.

## UI delivery gate
Design read retained: operational inquiry editor for portfolio staff, existing IEMS portfolio language, ENERGY1/RHYTHM1/MOTION1; existing fields/spacing/focus, no new colors/assets/animation. Source/commercial separation serves frozen customer intent.
Functional PASS: actual create/revise/refresh/review/convert/retry/source navigation/commercial revision/fulfillment/PDF issue/download controls exercised with persisted effects. Responsive PASS limited to three measured invoice widths and baseline width/text gates. Honest-state PASS: real denied/conflict/offline/uncertain recovery, no fake fetch or invented persisted data. Whole-interface contrast/all-controls/a11y certification NOT CLAIMED. Independent coordinator acceptance remains required.
