# Review checkpoint reproduction

Use Node24.x and a local Chrome installation. Run from the repository root. Install the committed lockfiles in independent package directories; no working-tree junctions or ignored source files are required:

```powershell
$env:MONGOMS_DISABLE_POSTINSTALL = '1'
foreach ($package in @('packages/tenant-foundation', 'packages/customer-service', 'packages/document-rendering', 'apps/portfolio-api', 'apps/wa-demo-bridge', 'apps/web')) {
  npm --prefix $package ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "Install failed: $package" }
}
python checkpoints/review-five-findings/audit-publication.py
npm --prefix apps/portfolio-api run check
npm --prefix apps/portfolio-api test
npm --prefix apps/web run test:portfolio
npm --prefix apps/web run build
```

MongoMemoryServer starts an exclusively owned Mongo7.0.14 replica. Set `MONGOMS_SYSTEM_BINARY` to an existing compatible local binary to avoid downloading it. Browser tests use Chrome's platform default path; `PORTFOLIO_CHROME_BINARY` can select another installation. These commands do not require an existing application database, broker, PostgreSQL or provider account.

Start the interactive synthetic demo:

```powershell
npm --prefix apps/web run demo:review
```

The command creates a random marker-guarded database, runs original E01 through mounted authenticated APIs, and serves the actual UI on unused loopback ports. It prints the local URL and a temporary `alpha.owner` password. Keep that terminal open; use Ctrl+C to stop and delete only its owned database. Restart creates a fresh demo. Do not publish its temporary password. `npm --prefix apps/web run demo:review -- --smoke` verifies setup and cleanup without leaving the server running.

Ready records include the reconciled customer chain, ten shipped serials, shipment6/4, both recorded PODs, paid invoices and exact USD135975.00 settlement. Separate synthetic inquiry/quotation/held-receipt states support action and blocked-state review. The UI labels historical business replay explicitly. The clock does not alter authentication expiry or recording time. Receipt-backed engineering and issue/allocation event-time adapter limits are recorded in [CONTRACT.md](CONTRACT.md); this demo does not claim exact historical event-time parity or live machine/carrier evidence.

The separate typed catalog/internal-production browser journey runs reservation, abandonment, hold, issue, actual operations, consumption, per-output/loss attribution, output QC and company putaway. It does not create a customer order or substitute for original E01. Manufactured child-source graphs and replacement/rework flows beyond these accepted paths remain future gates; rejected outputs remain quarantined and unavailable. Company output stock has no customer shipment/allocation authority.

Run independent correctness probes:

```powershell
$env:IEMS_QA_EVIDENCE = Join-Path $env:TEMP 'iems-independent-evidence'
node --test --test-concurrency=1 checkpoints/review-five-findings/qa/authorization-ordering.test.mjs checkpoints/review-five-findings/qa/picker-search-authority.test.mjs checkpoints/review-five-findings/qa/internal-stock-execution.test.mjs checkpoints/review-five-findings/qa/delivery-evidence.test.mjs checkpoints/review-five-findings/qa/canonical-e01-review.test.mjs checkpoints/review-five-findings/qa/required-labor-proof.test.mjs
```

Connected browser reproduction, including prior regression journeys:

```powershell
foreach ($flag in @('PAGINATION','REPAIR','DOCUMENTS','WMS','ENGINEERING','LABOR','VAT','INQUIRY','LOT_SERIAL','GENEALOGY','SERIAL_CUSTODY','INSTALLATION','INTERNAL_PLANNING','CATALOG','CATALOG_QC','REVIEW_OPERATOR','INTERNAL_EXECUTION','REVIEW_E01')) {
  Set-Item -Path "Env:PORTFOLIO_$flag" -Value '1'
}
$env:PORTFOLIO_EVIDENCE_DIR = Join-Path $env:TEMP 'iems-review-browser-evidence'
$env:PORTFOLIO_REVIEW_DEBUG_ONLY = '0'
$env:PORTFOLIO_TEXT_DIAGNOSTIC_ONLY = '0'
npm --prefix apps/web run test:portfolio:browser
```

Use one owner for Mongo/full browser/full API/benchmark resources. Run the benchmark separately after reading [CONCURRENCY.md](CONCURRENCY.md); it has explicit resource guards and incomplete cells. Successful correctness probes do not close F5. [STATUS.md](STATUS.md), [TEST-RESULTS.md](TEST-RESULTS.md) and [LEAD-ACCEPTANCE.md](LEAD-ACCEPTANCE.md) distinguish executed gates from pending or blocked work.
