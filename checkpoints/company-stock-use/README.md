# Reproduce company stock use

Final published acceptance: [PR13 at9ad677a and its dependency on PR12](../review-five-findings/ACCEPTANCE-INDEX.md). The source-freeze and reproduction notes below are historical; [the current dependency review](../review-five-findings/DEPENDENCY-REVIEW-13-14.md) records an open P2 readiness finding.

This supplemental checkpoint follows accepted parent f4cf6fd. Its implementation and verification state is in [STATUS.md](STATUS.md); commands below reproduce the gates, while actual observed results are in [TEST-RESULTS.md](TEST-RESULTS.md). Contract and master-plan boundaries are in [CONTRACT.md](CONTRACT.md) and [MASTER-PLAN-MAP.md](MASTER-PLAN-MAP.md).

Use Node24.x, Python3 and an existing local Chrome. Run from repository root. Install all six existing lockfiles, without junctions or ignored source dependencies:

```powershell
$env:MONGOMS_DISABLE_POSTINSTALL = '1'
foreach ($package in @('packages/tenant-foundation','packages/customer-service','packages/document-rendering','apps/portfolio-api','apps/wa-demo-bridge','apps/web')) {
  npm --prefix $package ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "Install failed: $package" }
}
python checkpoints/review-five-findings/audit-publication.py
npm --prefix apps/portfolio-api run check
npm --prefix apps/web run test:portfolio
npm --prefix apps/web run build
```

Mongo tests/browser own disposable Mongo7.0.14 replicas. An existing compatible binary can be selected with MONGOMS_SYSTEM_BINARY; an existing Chrome with PORTFOLIO_CHROME_BINARY. No running user database, broker, PostgreSQL or provider is required. Keep at least2GiB free RAM before startup and one local heavy owner. Never stop user services or lower guards to fit a test.

Run independent actual HTTP/DB and controlled source-CAS probes:

```powershell
$env:IEMS_QA_EVIDENCE = Join-Path $env:TEMP ('iems-company-stock-' + [guid]::NewGuid().ToString('N'))
node --test --test-concurrency=1 checkpoints/company-stock-use/qa/company-stock-use.test.mjs
npm --prefix apps/portfolio-api test
```

Run the new native journey together with all prior accepted journeys. Company producer prerequisites are explicitly labeled actual HTTP setup; new consumer command submissions must be native UI and independently reconciled. Do not enable any diagnostic-only mode for full acceptance:

```powershell
foreach ($flag in @('PAGINATION','REPAIR','DOCUMENTS','WMS','ENGINEERING','LABOR','VAT','INQUIRY','LOT_SERIAL','GENEALOGY','SERIAL_CUSTODY','INSTALLATION','INTERNAL_PLANNING','CATALOG','CATALOG_QC','REVIEW_OPERATOR','INTERNAL_EXECUTION','REVIEW_E01','COMPANY_STOCK')) {
  Set-Item -Path "Env:PORTFOLIO_$flag" -Value '1'
}
$env:PORTFOLIO_REVIEW_DEBUG_ONLY = '0'
$env:PORTFOLIO_TEXT_DIAGNOSTIC_ONLY = '0'
$env:PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY = '0'
$env:PORTFOLIO_EVIDENCE_DIR = Join-Path $env:TEMP ('iems-company-browser-' + [guid]::NewGuid().ToString('N'))
npm --prefix apps/web run test:portfolio:browser
```

For focused native diagnosis only, set PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY=1 with the other two diagnostic flags0. It writes company-stock-debug-results.json with diagnosticOnly=true, fullAcceptance=false and prior-journey coverage ABSENT. This can verify the new workflow before a full run; it never substitutes for the complete19-flag regression above. Reset it to0 for acceptance.

The separate intentional module-failure/native-reload regression remains:

```powershell
$env:IEMS_QA_EVIDENCE = Join-Path $env:TEMP ('iems-module-recovery-' + [guid]::NewGuid().ToString('N'))
node checkpoints/review-five-findings/qa/module-fetch-recovery-browser.mjs
```

Interactive owned synthetic demo uses `npm --prefix apps/web run demo:review`. It prints a temporary URL/password and cleans only its marker-owned resources on Ctrl+C. Its initial fixture is original E01; the new manufactured-input scenario is a separate workflow, not silently added to or substituted for that canonical fixture. Do not publish temporary credentials. No production or external provider posting is included.
