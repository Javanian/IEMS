# Linked local portfolio demo

This launcher assembles the existing E01 manufacturing and E02 repair API
scenario runners in one disposable synthetic database, then reconciles the
private reporting projection and serves the existing portfolio UI. It creates
no subscription, external delivery, production data, bank transaction or cloud
resource. Independent browser and product acceptance belong to TPR-150/152.

Run from the repository root with Node 24 and the existing API/web dependencies
installed. Supply the already cached Mongo 7.0.14 executable; downloading a
binary at runtime is disabled. Choose a **new absolute output directory** for
each run. Existing directories are refused, so earlier evidence is retained.

```powershell
$env:MONGOMS_SYSTEM_BINARY = 'C:/Users/Admin/.cache/mongodb-binaries/mongod-x64-win32-7.0.14.exe'
$env:MONGOMS_RUNTIME_DOWNLOAD = 'false'
node ops/demo/portfolio.mjs --synthetic-owned --output 'D:/Project AI/GITHUB/IEMS-evidence/linked-demo-UNIQUE' --smoke
```

Omit `--smoke` for an interactive demo. The launcher prints actual order and
repair links plus an ephemeral synthetic login to the local operator console.
Do not copy that temporary password into evidence or issue comments. The smoke
command never prints it. UI HTML and authenticated proxy checks are basic
assembly checks; they do not establish rendered-browser or visual acceptance.

Walk through the E01 order's approved quotation, work orders, source materials,
genealogy, partial shipments, PODs and settled invoices. Follow the E02 accepted
case through scope revision 2, service SO/WO, deposit, actual spare consumption
and quarantine, failed test, rework, QC, customer-property dispatch/POD, VAT
invoice and warranty. The rejected case retains its cancelled work order,
diagnostic invoice/payment and unrepaired return POD. Runtime UUIDs map to the
unchanged original fixtures in `demo-manifest.json`.

The recorded actors, calibration, tests, payment references and POD evidence
are synthetic operator entries. They are not verified bank, carrier, hardware
or employee evidence. E02's supplemental heat/lot and calibration records,
parent-slot ring attribution and atomic diagnostic-invoice date mapping are
described in the owner handoff at
`packages/contracts/src/domains/engineering-repair/E02-V7-HANDOFF.md`.

The reporting stage uses the existing authenticated private runtime and writes
immutable extraction files under the same owned output directory. Its coverage
stays `INCOMPLETE` with `trustedZero=false`; Kafka, SQL and actual Parquet are
not configured. An unsupported or missing source fails the stage and the
command. A source error must be corrected by the data owner; do not remove a
scenario, skip a cohort or disable source verification to obtain a PASS.
The standalone private reporting CLI contract remains in
`ops/demo/reporting-runtime.md`.

`demo-manifest.json` records each completed stage, fixture hashes, runtime
identities, reporting coverage and cleanup. A failed command retains its FAIL
manifest and exits nonzero. The committed feature matrix and exact ancestry
ledger live in `checkpoints/iems-all-features/`; independent QA remains NOT_RUN
until a final immutable candidate is handed to its assigned reviewer.

Stop an interactive run with Ctrl+C. The launcher closes its Vite/HTTP servers,
drains reporting, verifies the exact database name and owned marker, drops only
that random `portfolio_test_` database and stops its own replica. Evidence files
remain. Restart with a new output directory for a fresh fixture; no reset
endpoint or user database connection is involved. If the marker or reporting
ownership changes, cleanup fails closed and preserves the database files. After
a crash, verify recorded process/marker ownership before any manual recovery;
never delete unrelated locks, databases or processes.

Current SaaS profile boundaries and remaining local caller/service/job contracts
are recorded in `ops/pilot/PLAT-038-V14-HANDOFF.md` and its coverage inventory. A demo run on an unenrolled
synthetic tenant does not prove those remaining enrolled workflows complete.
