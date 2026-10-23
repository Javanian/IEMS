# Wave4h publication handback (WIP)

No installs, Mongo, builds or browser runs were performed in this pass. Acquire the lead heavy-test token before executing commands below, one at a time. Use Node 24.x, npm and Python 3. No root installation or root lock change is needed.

From the publication worktree root in Git Bash:

```bash
export MONGOMS_DISABLE_POSTINSTALL=1
npm --prefix packages/tenant-foundation ci
npm --prefix packages/customer-service ci
npm --prefix packages/document-rendering ci
npm --prefix apps/portfolio-api ci
npm --prefix apps/wa-demo-bridge ci
npm --prefix apps/web ci
python checkpoints/wave4h/audit-publication.py
npm --prefix apps/portfolio-api run check
npm --prefix apps/web run test:portfolio
npm --prefix packages/tenant-foundation test
npm --prefix packages/customer-service test
npm --prefix packages/document-rendering test
node --test --test-concurrency=1 packages/document-rendering/test/wave4h-vat.test.mjs
node --test --test-concurrency=1 apps/portfolio-api/test/*.test.mjs
npm --prefix apps/web run build
PORTFOLIO_PAGINATION=1 PORTFOLIO_REPAIR=1 PORTFOLIO_DOCUMENTS=1 PORTFOLIO_WMS=1 PORTFOLIO_ENGINEERING=1 PORTFOLIO_LABOR=1 PORTFOLIO_VAT=1 npm --prefix apps/web run test:portfolio:browser
```

Set `PORTFOLIO_EVIDENCE_DIR` to a private directory outside the checkout to retain browser output at a known path. The default is a randomized directory under TMPDIR/OS temp, never publication docs. After browser completion:

```bash
npm --prefix apps/web run test:portfolio:raster -- "$PORTFOLIO_EVIDENCE_DIR"
```

Mongo harnesses use `MONGOMS_SYSTEM_BINARY` if supplied; otherwise mongodb-memory-server downloads MongoDB 7.0.14 on first test. A compatible binary/OS runtime or network access to MongoDB downloads is required. Do not point at a shared database: harnesses create their own replica set and randomized marked database. `MONGOMS_DISABLE_POSTINSTALL=1` only defers download until tests. Chrome must already be installed; override executable using `PORTFOLIO_CHROME_BINARY` (native absolute path on Windows). Linux defaults to google-chrome on PATH, macOS to the standard application path. API port 4313 must be free; web chooses a free dual-loopback port 4173..4272. Never kill another owner to free a port.

## Import/dependency disposition

The static audit covers portfolio API, all portfolio web tests/features and tenant-foundation/customer-service/document-rendering source scopes. Local relative import targets must exist. Browser Mongo imports intentionally resolve the separately locked portfolio-api node_modules; PDF parser/canvas imports resolve the separately locked document-rendering node_modules. These are install-order dependencies, not unpublished spike dependencies. Vite/React/router are in the existing locked web package. No additional browser package is needed: the harness drives installed Chrome over Node 24 WebSocket/CDP. Four missing Wave4f modules were reviewed individually, including their API-only synthetic fixtures and their sole shared browser-kit dependency.

No fixture/golden directories exist in the three package scopes. Existing test source embeds synthetic fixtures; none was bulk-copied. The two historical Wave4f JSON files already in checkpoint9f4ed18 are old command/hash metadata, not runtime dependencies or new verification evidence; they were not refreshed or used to claim acceptance. Golden PDF hashes embedded in existing tests remain untouched.

`native-smoke.mjs` now launches its own MongoMemoryReplSet instead of unpublished ops/job13, and checks the actual five synthetic seed identities. Execute only after token handback using `node apps/portfolio-api/scripts/native-smoke.mjs`.

Existing API full suite retains the historically obsolete unsupported-VAT-PDF assertion; business behavior/test expectations were not silently changed. Report any failure explicitly. This preparation is not a green-build claim. Original lead browser 81 exit 0 does not certify this worktree.

## Scope

Only portfolio mount pieces were selected from original router/main/vite. Legacy startup remains unchanged for non-portfolio paths. No kiosk route, startup redesign, legacy aliases, PWA policy or other legacy proxy edits were copied. API src, tax policy and renderer implementation remain checkpoint-identical. Original source hashes are in INTEGRATION-SOURCES.json; the browser entry has additional documented portability-only edits, while the corrected fulfillment module is byte-identical to original.

Manifest includes publication source plus inherited tenant-foundation/customer-service dependencies and integration metadata. It excludes itself to avoid a recursive hash, private evidence, logs, databases, caches and reports. Review all diffs before lead acceptance. No commit/push/PR actions are delegated here.
