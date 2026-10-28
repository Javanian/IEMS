# Browser transport diagnostics

The Portfolio browser entrypoint records bounded resource observations around the heading preflight and connected company trace journey. This instrumentation does not establish a cause for historical transport failures or change their assertions.

Install the existing lockfiles using the package list in `.github/workflows/portfolio-vat.yml`. Run the harness through its npm script: its working directory must be `apps/web` for the existing Tailwind configuration.

From the repository root, PowerShell:

```powershell
npm --prefix apps/web run test:portfolio
$env:PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY='1'
$env:PORTFOLIO_COMPANY_STOCK_TRACE='1'
$env:PORTFOLIO_EVIDENCE_DIR=Join-Path $env:TEMP ('iems-transport-A-'+[guid]::NewGuid())
npm --prefix apps/web run test:portfolio:browser
```

This runs heading24 followed by actual company-stock/trace API and native browser journeys against a marker-verified disposable database. The heading component fixture uses mocked HTTP. The diagnostic subset omits earlier business journeys and is not full acceptance. The existing browser selection and MongoDB prerequisites still apply.

For a controlled diagnostic B only, after A exits and its owned resources are checked:

```powershell
$env:PORTFOLIO_TRANSPORT_WITHOUT_PREFLIGHT='1'
$env:PORTFOLIO_EVIDENCE_DIR=Join-Path $env:TEMP ('iems-transport-B-'+[guid]::NewGuid())
npm --prefix apps/web run test:portfolio:browser
Remove-Item Env:PORTFOLIO_TRANSPORT_WITHOUT_PREFLIGHT
```

The B flag is rejected unless company-only trace diagnostic mode is active. Default acceptance retains the heading preflight and the existing full workflow configuration. B must never substitute for that configuration. Predetermine trial counts; do not repeat until green.

`transport-resource-telemetry.json` contains at most16 OS snapshots (each subprocess bounded to8s/1MiB),1024 recent events and256 pending trace identities. Serialized output is bounded to1MiB plus its newline. Windows counters include process creation identity/parentage, working set/private bytes/handles, host available/committed memory, TCP state counts and the read-only IPv4 dynamic port range/entry count. Other platforms explicitly report the OS sampler unavailable. Snapshot duration measures observer overhead; sampling can alter timing and does not capture continuous peaks.

CDP trace events record session/request/frame/loader identities, safe loopback paths and response/failure outcomes. Before-action records identify fresh-read selection/refresh phase; no headers, cookies, bodies or profile contents are added. Query strings and external URLs are excluded. Missing/expired identities and counters are unknown. PID creation order rejects stale parent/PID reuse; previously observed descendants remain attributable after their parent exits. The sampler observes and never terminates processes.

Parent exit and profile removal alone do not prove descendant/socket closure. Confirm recorded identities after the harness exits; distinguish shared Node workers and normal TIME_WAIT from leaks. One pass cannot establish that a historical resource failure was fixed. Dedicated order-planning browser coverage is separate and is not invoked by this instrumentation.
